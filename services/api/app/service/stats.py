"""Dashboard aggregates across every inspection line.

One paginated listing of ``lines/`` answers everything: line ids, model
versions, bytes by kind, captures per day, and the part/score/label keys of
each line. Those objects are write-once, so ``b2_store.get_immutable`` reads
each from B2 only the first time; after that a dashboard load costs the one
listing. Progress (lines done of total) is kept for the dashboard's wait.
"""

import logging
from collections import Counter
from datetime import UTC, datetime, timedelta
from threading import Lock, Thread

from app.repo import b2_store
from app.service import keys, state
from app.types.inspection import (
    ArchiveKind,
    DailyPartCount,
    InspectionRecord,
    InspectionStats,
    PartStatus,
    StatsProgress,
)

logger = logging.getLogger(__name__)

PARTS_PER_DAY_WINDOW = 14
RECENT_LIMIT = 8

# Single flight: a request arriving while the startup warm-up (or another
# request) is reading lines waits for it, then answers from warm caches,
# instead of reading every object a second time in parallel.
_compute_lock = Lock()
_progress_lock = Lock()
_progress = StatsProgress(running=False, lines_done=0, lines_total=0)


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


def _set_progress(**changes) -> None:
    global _progress
    with _progress_lock:
        _progress = _progress.model_copy(update=changes)


def progress() -> StatsProgress:
    with _progress_lock:
        return _progress.model_copy()


def inspection_stats() -> InspectionStats:
    with _compute_lock:
        return _compute()


def _compute() -> InspectionStats:
    objects = b2_store.list_all(keys.ROOT)
    line_ids = sorted({line for o in objects if (line := keys.line_of_record(o["key"]))})
    _set_progress(running=True, lines_done=0, lines_total=len(line_ids))
    status_counts: Counter[PartStatus] = Counter()
    above: list[tuple] = []
    parts = 0
    try:
        for done, line_id in enumerate(line_ids, start=1):
            st = state.load_line_state(line_id, listing=objects)
            parts += len(st.parts)
            for serial in st.parts:
                status_counts[state.part_status(st, serial)] += 1
                latest = state.latest_score(st, serial)
                if latest and latest["above_threshold"]:
                    above.append((latest["scored_at"], serial, st))
            _set_progress(lines_done=done)
    finally:
        _set_progress(running=False)
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


def _warm() -> None:
    try:
        inspection_stats()
    except Exception as e:  # a warm-up failure only means the first view pays
        logger.warning("Dashboard stats warm-up failed: %s", e)


def warm_in_background() -> None:
    """Read every line's write-once objects once, off the startup path."""
    Thread(target=_warm, name="stats-warm-up", daemon=True).start()
