"""Inspection lines: create, read, edit and the active model pointer.

A line is ``lines/<line-id>/line.json``. There is no delete: a line holds the
evidence behind every inspection result recorded on it.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Lock

from app.repo import b2_store
from app.service import keys, state
from app.service.errors import InspectionError, conflict, not_found
from app.types.inspection import PartStatus
from app.types.lines import CreateLineRequest, Line, LineDetail, ScoreSummary, UpdateLineRequest

_write_lock = Lock()


def _now() -> datetime:
    return datetime.now(UTC)


def get_line(line_id: str) -> Line:
    keys.check_line_id(line_id)
    try:
        return Line.model_validate(b2_store.get_json(keys.line_record(line_id)))
    except b2_store.ObjectNotFound:
        raise not_found(f"Line '{line_id}' not found") from None


def _line_or_none(line_id: str) -> Line | None:
    try:
        return get_line(line_id)
    except keys.InvalidKeyPart:
        return None
    except InspectionError as e:  # a folder without line.json is not a line
        if e.status_code != 404:
            raise
        return None


def list_lines() -> list[Line]:
    line_ids = [prefix[len(keys.ROOT) :].rstrip("/") for prefix in b2_store.list_prefixes(keys.ROOT)]
    if not line_ids:
        return []
    # One GET per line, in parallel: read one by one they cost a round trip each
    # on every page that lists lines (and on every Trace search).
    with ThreadPoolExecutor(max_workers=min(8, len(line_ids))) as pool:
        found = [line for line in pool.map(_line_or_none, line_ids) if line is not None]
    return sorted(found, key=lambda line: line.line_id)


def create_line(req: CreateLineRequest) -> Line:
    with _write_lock:
        if b2_store.head(keys.line_record(req.line_id)) is not None:
            raise conflict(f"Line '{req.line_id}' already exists")
        now = _now()
        line = Line(
            line_id=req.line_id,
            name=req.name.strip(),
            description=(req.description or "").strip() or None,
            active_model_version=None,
            created_at=now,
            updated_at=now,
        )
        b2_store.put_json(keys.line_record(line.line_id), line.model_dump(mode="json"))
    return line


def update_line(line_id: str, req: UpdateLineRequest) -> Line:
    with _write_lock:
        line = get_line(line_id)
        changes = req.model_dump(exclude_unset=True)
        if changes.get("name"):
            line.name = changes["name"].strip()
        if "description" in changes:
            line.description = (changes["description"] or "").strip() or None
        line.updated_at = _now()
        b2_store.put_json(keys.line_record(line_id), line.model_dump(mode="json"))
    return line


def set_active_model(line_id: str, version: str | None) -> Line:
    with _write_lock:
        line = get_line(line_id)
        line.active_model_version = version
        line.updated_at = _now()
        b2_store.put_json(keys.line_record(line_id), line.model_dump(mode="json"))
    return line


def summarize_scores(st: state.LineState, threshold: float | None) -> ScoreSummary:
    latest = [rows[-1] for rows in st.scores.values() if rows]
    latest.sort(key=lambda row: row["scored_at"], reverse=True)
    values = [float(row["score"]) for row in latest]
    return ScoreSummary(
        scored_count=len(values),
        above_threshold_count=sum(1 for row in latest if row["above_threshold"]),
        min_score=min(values) if values else None,
        max_score=max(values) if values else None,
        mean_score=sum(values) / len(values) if values else None,
        threshold=threshold,
        recent_scores=values[:500],
    )


def line_detail(line_id: str, model_count: int, active_threshold: float | None) -> LineDetail:
    line = get_line(line_id)
    st = state.load_line_state(line_id)
    counts = {status: 0 for status in PartStatus}
    for serial in st.parts:
        counts[state.part_status(st, serial)] += 1
    normal_references = sum(
        1
        for serial, part in st.parts.items()
        if part.get("reference") == "normal" and not st.labels.get(serial)
    )
    return LineDetail(
        **line.model_dump(),
        part_count=len(st.parts),
        unscored_count=counts[PartStatus.unscored],
        in_review_count=counts[PartStatus.in_review],
        passed_count=counts[PartStatus.passed],
        failed_count=counts[PartStatus.failed],
        model_count=model_count,
        normal_reference_count=normal_references,
        scores=summarize_scores(st, active_threshold),
    )
