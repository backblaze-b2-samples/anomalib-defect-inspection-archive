"""Dashboard aggregates across every inspection line."""

from collections import Counter
from datetime import UTC, datetime, timedelta

from app.repo import b2_store
from app.service import keys, lines, state
from app.types.inspection import (
    ArchiveKind,
    DailyPartCount,
    InspectionRecord,
    InspectionStats,
    PartStatus,
)

PARTS_PER_DAY_WINDOW = 14
RECENT_LIMIT = 8


def bytes_by_kind(objects: list[dict]) -> dict[str, int]:
    totals = {kind.value: 0 for kind in ArchiveKind}
    for obj in objects:
        kind = keys.kind_of(obj["key"])
        if kind is not None:
            totals[kind.value] += obj["size"]
    return totals


def parts_per_day(objects: list[dict], today=None) -> list[DailyPartCount]:
    today = today or datetime.now(UTC).date()
    counts: Counter[str] = Counter()
    for obj in objects:
        parsed = keys.parse_image(obj["key"])
        if parsed:
            counts[parsed[1]] += 1
    days = [today - timedelta(days=n) for n in range(PARTS_PER_DAY_WINDOW - 1, -1, -1)]
    return [DailyPartCount(date=d.isoformat(), count=counts.get(d.isoformat(), 0)) for d in days]


def inspection_stats() -> InspectionStats:
    objects = b2_store.list_all(keys.ROOT)
    status_counts: Counter[PartStatus] = Counter()
    above: list[tuple] = []
    parts = 0
    for line in lines.list_lines():
        st = state.load_line_state(line.line_id)
        parts += len(st.parts)
        for serial in st.parts:
            status_counts[state.part_status(st, serial)] += 1
            latest = state.latest_score(st, serial)
            if latest and latest["above_threshold"]:
                above.append((latest["scored_at"], serial, st))
    above.sort(key=lambda item: item[0], reverse=True)
    recent: list[InspectionRecord] = [
        state.build_record(st, serial) for _, serial, st in above[:RECENT_LIMIT]
    ]
    return InspectionStats(
        parts_inspected=parts,
        above_threshold=len(above),
        review_backlog=status_counts[PartStatus.in_review],
        passed=status_counts[PartStatus.passed],
        failed=status_counts[PartStatus.failed],
        model_versions=sum(1 for o in objects if o["key"].endswith("/version.json")),
        bytes_by_kind=bytes_by_kind(objects),
        parts_per_day=parts_per_day(objects),
        recent_above_threshold=recent,
    )
