"""Review queue: parts whose latest score is above threshold and have no verdict."""

from app.service import lines, state
from app.types.inspection import PartStatus, ReviewItem


def select_for_review(st: state.LineState) -> list[str]:
    """Serials in review on one line, oldest capture first."""
    serials = [s for s in st.parts if state.part_status(st, s) == PartStatus.in_review]
    return sorted(serials, key=lambda s: (st.parts[s]["captured_at"], s))


def review_queue(line_id: str | None = None, limit: int = 100) -> list[ReviewItem]:
    line_ids = [lines.get_line(line_id).line_id] if line_id else [
        line.line_id for line in lines.list_lines()
    ]
    candidates: list[tuple[str, str, state.LineState]] = []
    for lid in line_ids:
        st = state.load_line_state(lid)
        for serial in select_for_review(st):
            candidates.append((st.parts[serial]["captured_at"], serial, st))
    candidates.sort(key=lambda item: (item[0], item[1]))
    return [
        state.build_record(st, serial, ReviewItem) for _, serial, st in candidates[:limit]
    ]
