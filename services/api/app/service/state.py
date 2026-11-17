"""Read a line's inspection state from B2 and derive part records from it.

B2 is the only store. A part's state is the union of three write-once object
families: its part index (``parts/<serial>.json``), its score rows (Parquet part
files under ``scores/``) and its verdict history (``labels/<serial>/``). Nothing
is ever updated in place, so status is always derived, never stored.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime

from app.repo import b2_store, parquet_scores
from app.service import keys
from app.service.errors import not_found
from app.types.inspection import InspectionRecord, PartStatus, Verdict

_POOL_SIZE = 8


@dataclass
class LineState:
    line_id: str
    parts: dict[str, dict] = field(default_factory=dict)
    scores: dict[str, list[dict]] = field(default_factory=dict)
    score_keys: dict[str, list[str]] = field(default_factory=dict)
    labels: dict[str, list[dict]] = field(default_factory=dict)


def _read_all(keys_to_read: list[str]) -> list[bytes]:
    if not keys_to_read:
        return []
    with ThreadPoolExecutor(max_workers=_POOL_SIZE) as pool:
        return list(pool.map(b2_store.get_immutable, keys_to_read))


def _parse_time(value) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(str(value))


def _keys_under(prefix: str, listing: list[dict] | None) -> list[str]:
    if listing is None:
        return [o["key"] for o in b2_store.list_all(prefix)]
    return [o["key"] for o in listing if o["key"].startswith(prefix)]


def load_line_state(
    line_id: str, *, with_labels: bool = True, listing: list[dict] | None = None
) -> LineState:
    """Read a line's parts, scores and labels.

    ``listing`` is an already-read listing that covers the line (the dashboard
    lists ``lines/`` once for every line); without it the three families are
    listed here.
    """
    state = LineState(line_id=line_id)
    part_keys = _keys_under(keys.parts_prefix(line_id), listing)
    score_keys = sorted(_keys_under(keys.scores_prefix(line_id), listing))
    label_keys = _keys_under(keys.labels_prefix(line_id), listing) if with_labels else []
    blobs = _read_all(part_keys + score_keys + label_keys)
    part_blobs = blobs[: len(part_keys)]
    score_blobs = blobs[len(part_keys) : len(part_keys) + len(score_keys)]
    label_blobs = blobs[len(part_keys) + len(score_keys) :]

    for blob in part_blobs:
        record = json.loads(blob)
        state.parts[record["serial"]] = record
    for key, blob in zip(score_keys, score_blobs, strict=True):
        for row in parquet_scores.decode_rows(blob):
            state.scores.setdefault(row["serial"], []).append(row)
            state.score_keys.setdefault(row["serial"], [])
            if key not in state.score_keys[row["serial"]]:
                state.score_keys[row["serial"]].append(key)
    for rows in state.scores.values():
        rows.sort(key=lambda r: r["scored_at"])
    for blob in label_blobs:
        entry = json.loads(blob)
        state.labels.setdefault(entry["serial"], []).append(entry)
    for entries in state.labels.values():
        entries.sort(key=lambda e: _parse_time(e["recorded_at"]))
    return state


def derive_status(
    scores: list[dict], labels: list[dict], reference: str | None = None
) -> PartStatus:
    """Latest verdict wins; else the latest score against its own threshold.

    A scored reference image is already labelled (known-good or known-defective
    at capture), so it reads as `reference` and never enters the review queue,
    whatever its score; the score itself stays on the record and in the trace.
    """
    if labels:
        return PartStatus.passed if labels[-1]["verdict"] == "pass" else PartStatus.failed
    if not scores:
        return PartStatus.unscored
    if reference:
        return PartStatus.reference
    latest = scores[-1]
    return PartStatus.in_review if latest["above_threshold"] else PartStatus.below_threshold


def part_status(state: LineState, serial: str) -> PartStatus:
    return derive_status(
        state.scores.get(serial, []),
        state.labels.get(serial, []),
        state.parts.get(serial, {}).get("reference"),
    )


def latest_score(state: LineState, serial: str) -> dict | None:
    rows = state.scores.get(serial)
    return rows[-1] if rows else None


def latest_verdict(state: LineState, serial: str) -> dict | None:
    entries = state.labels.get(serial)
    return entries[-1] if entries else None


def require_part(state: LineState, serial: str) -> dict:
    keys.check_serial(serial)
    part = state.parts.get(serial)
    if part is None:
        raise not_found(f"Part '{serial}' not found on line '{state.line_id}'")
    return part


def build_record(state: LineState, serial: str, record_cls=InspectionRecord):
    part = state.parts[serial]
    score = latest_score(state, serial)
    verdict = latest_verdict(state, serial)
    heatmap_key = score["heatmap_key"] if score else None
    return record_cls(
        line_id=state.line_id,
        serial=serial,
        capture_date=date.fromisoformat(part["capture_date"]),
        captured_at=_parse_time(part["captured_at"]),
        image_key=part["image_key"],
        status=part_status(state, serial),
        reference=part.get("reference"),
        score=score["score"] if score else None,
        threshold=score["threshold"] if score else None,
        model_version=score["model_version"] if score else None,
        heatmap_key=heatmap_key,
        verdict=Verdict(verdict["verdict"]) if verdict else None,
        scored_at=score["scored_at"] if score else None,
        image_url=b2_store.view_url(part["image_key"]),
        heatmap_url=b2_store.view_url(heatmap_key) if heatmap_key else None,
    )


def all_records(state: LineState, record_cls=InspectionRecord) -> list:
    return [build_record(state, serial, record_cls) for serial in state.parts]
