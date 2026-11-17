"""Inspection records: capture, list, score and record verdicts.

Captured images, score rows and heatmaps are immutable evidence. A verdict is a
new label object; earlier ones stay. Nothing here deletes anything.
"""

import logging
from datetime import UTC, date, datetime, timedelta

from app.config import settings
from app.repo import anomaly_engine, b2_store, heatmap
from app.repo.b2_upload import generate_presigned_upload
from app.service import keys, lines, scoring, state
from app.service.errors import InspectionError, conflict, not_found
from app.types.inspection import (
    CapturePartRequest,
    InspectionPage,
    InspectionRecord,
    PartStatus,
    PresignCaptureRequest,
    PresignCaptureResponse,
    VerdictRequest,
)

logger = logging.getLogger(__name__)


def _ensure_new_serial(line_id: str, serial: str) -> None:
    if b2_store.head(keys.part_index(line_id, serial)) is not None:
        raise conflict(f"Serial '{serial}' was already captured on line '{line_id}'")


def presign_capture(line_id: str, req: PresignCaptureRequest) -> PresignCaptureResponse:
    lines.get_line(line_id)
    keys.check_serial(req.serial)
    if req.size_bytes > settings.capture_max_bytes:
        raise InspectionError("Image is too large", 413)
    _ensure_new_serial(line_id, req.serial)
    today = datetime.now(UTC).date().isoformat()
    image_key = keys.image(line_id, today, req.serial)
    expires_in = settings.presign_upload_expiry_seconds
    url = generate_presigned_upload(image_key, req.content_type, req.size_bytes, expires_in)
    return PresignCaptureResponse(
        upload_url=url,
        image_key=image_key,
        capture_date=date.fromisoformat(today),
        content_type=req.content_type,
        headers={"Content-Type": req.content_type},
        expires_in=expires_in,
    )


def _check_capture_key(line_id: str, req: CapturePartRequest) -> str:
    parsed = keys.parse_image(req.image_key)
    if parsed is None or parsed[0] != line_id or parsed[2] != req.serial:
        raise InspectionError("image_key does not match the key the presign step returned")
    capture_date = parsed[1]
    today = datetime.now(UTC).date()
    if date.fromisoformat(capture_date) not in (today, today - timedelta(days=1)):
        raise InspectionError("image_key is not from a current presign")
    return capture_date


def capture_part(line_id: str, req: CapturePartRequest) -> InspectionRecord:
    """Register a part the browser uploaded by presigned PUT, then score it."""
    line = lines.get_line(line_id)
    keys.check_serial(req.serial)
    capture_date = _check_capture_key(line_id, req)
    _ensure_new_serial(line_id, req.serial)
    meta = b2_store.head(req.image_key)
    if meta is None:
        raise not_found("The uploaded image was not found in B2; upload it first")
    if meta["size"] > settings.capture_max_bytes:
        raise InspectionError("Image is too large", 413)
    try:
        png, converted = heatmap.to_png(b2_store.get_bytes(req.image_key))
    except heatmap.BadImage as e:
        raise InspectionError(str(e), 415) from None
    etag = meta["etag"]
    if converted or meta["content_type"] != "image/png":
        # JPEG captures are stored as PNG under the same key, once, before
        # the part is registered; from here on the image never changes.
        etag = b2_store.put_bytes(req.image_key, png, "image/png")
    part = {
        "serial": req.serial,
        "line_id": line_id,
        "capture_date": capture_date,
        "image_key": req.image_key,
        "captured_at": datetime.now(UTC).isoformat(),
        "reference": req.reference.value if req.reference else None,
        "etag": etag,
        "original_content_type": meta["content_type"],
    }
    b2_store.put_json(keys.part_index(line_id, req.serial), part)
    rows: list[dict] = []
    if req.score_now and line.active_model_version:
        try:
            rows = scoring.score_parts(line_id, [part], line.active_model_version)
        except InspectionError as e:
            logger.warning("Captured %s unscored: %s", req.serial, e.detail)
        except anomaly_engine.EngineUnavailable:
            logger.warning("Captured %s unscored: ML extra not installed", req.serial)
    # The serial is new (checked above), so it has no verdicts and no scores
    # but the ones just written: build the record from them instead of
    # re-listing and re-reading the whole line after every capture.
    st = state.LineState(line_id=line_id, parts={req.serial: part})
    if rows:
        st.scores[req.serial] = rows
    return state.build_record(st, req.serial)


def get_record(line_id: str, serial: str) -> InspectionRecord:
    lines.get_line(line_id)
    st = state.load_line_state(line_id)
    state.require_part(st, serial)
    return state.build_record(st, serial)


def list_parts(
    line_id: str,
    capture_date: str | None = None,
    status: PartStatus | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> InspectionPage:
    lines.get_line(line_id)
    if capture_date:
        keys.check_date(capture_date)
    st = state.load_line_state(line_id)
    serials = [
        serial
        for serial, part in st.parts.items()
        if (capture_date is None or part["capture_date"] == capture_date)
        and (status is None or state.part_status(st, serial) == status)
    ]
    serials.sort(key=lambda s: st.parts[s]["captured_at"], reverse=True)
    try:
        offset = max(int(cursor or 0), 0)
    except ValueError:
        raise InspectionError("Invalid cursor") from None
    page = serials[offset : offset + limit]
    next_offset = offset + limit
    return InspectionPage(
        items=[state.build_record(st, serial) for serial in page],
        next_cursor=str(next_offset) if next_offset < len(serials) else None,
    )


def score_part(line_id: str, serial: str, model_version: str | None) -> InspectionRecord:
    line = lines.get_line(line_id)
    version = model_version or line.active_model_version
    if not version:
        raise conflict(f"Line '{line_id}' has no active model yet; train one first")
    st = state.load_line_state(line_id, with_labels=False)
    part = state.require_part(st, serial)
    scoring.score_parts(line_id, [part], version)
    return get_record(line_id, serial)


def record_verdict(line_id: str, serial: str, req: VerdictRequest) -> InspectionRecord:
    lines.get_line(line_id)
    st = state.load_line_state(line_id)
    state.require_part(st, serial)
    latest = state.latest_score(st, serial)
    score_ref = (
        f"{latest['scored_at'].isoformat()}@{latest['model_version']}" if latest else None
    )
    now = datetime.now(UTC)
    b2_store.put_json(
        keys.label(line_id, serial, now),
        {
            "serial": serial,
            "line_id": line_id,
            "verdict": req.verdict.value,
            "operator": req.operator.strip(),
            "note": (req.note or "").strip() or None,
            "score_ref": score_ref,
            "recorded_at": now.isoformat(),
        },
    )
    return get_record(line_id, serial)
