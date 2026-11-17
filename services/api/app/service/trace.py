"""Trace: from a part serial back to all of its evidence."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

from app.repo import b2_store
from app.service import keys, lines, model_versions, state
from app.service.errors import InspectionError
from app.types.inspection import PartTrace, ScoreEntry, TraceMatch, Verdict, VerdictEntry

MAX_MATCHES = 50


def get_trace(line_id: str, serial: str) -> PartTrace:
    lines.get_line(line_id)
    st = state.load_line_state(line_id)
    state.require_part(st, serial)
    base = state.build_record(st, serial)
    rows = st.scores.get(serial, [])
    scores = [
        ScoreEntry(
            score=row["score"],
            threshold=row["threshold"],
            above_threshold=row["above_threshold"],
            model_version=row["model_version"],
            backbone=row["backbone"] or "",
            anomalib_version=row["anomalib_version"] or "",
            heatmap_key=row["heatmap_key"],
            heatmap_url=b2_store.view_url(row["heatmap_key"]),
            scored_at=row["scored_at"],
        )
        for row in reversed(rows)
    ]
    verdicts = [
        VerdictEntry(
            verdict=Verdict(entry["verdict"]),
            operator=entry["operator"],
            note=entry.get("note"),
            score_ref=entry.get("score_ref"),
            recorded_at=datetime.fromisoformat(entry["recorded_at"]),
        )
        for entry in reversed(st.labels.get(serial, []))
    ]
    model = None
    if base.model_version:
        try:
            model = model_versions.get_version(line_id, base.model_version)
        except InspectionError:
            model = None
    return PartTrace(
        **base.model_dump(),
        scores=scores,
        verdicts=verdicts,
        model=model,
        parquet_keys=st.score_keys.get(serial, []),
    )


def search(serial: str, line_id: str | None = None) -> list[TraceMatch]:
    """Parts whose serial starts with ``serial``, across lines (or one line)."""
    query = serial.strip()
    if not query:
        raise InspectionError("Enter a serial to search for")
    keys.check_serial(query)
    line_ids = [lines.get_line(line_id).line_id] if line_id else [
        line.line_id for line in lines.list_lines()
    ]
    # Probe every line's part index in parallel: a miss used to cost one
    # sequential listing per line before "No part found" could show.
    with ThreadPoolExecutor(max_workers=max(1, min(8, len(line_ids)))) as pool:
        probes = list(
            pool.map(
                lambda lid: b2_store.list_page(keys.parts_prefix(lid) + query, max_keys=MAX_MATCHES)[0],
                line_ids,
            )
        )
    matches: list[TraceMatch] = []
    for lid, found in zip(line_ids, probes, strict=True):
        if not found:
            continue
        st = state.load_line_state(lid)
        for obj in found:
            hit = keys.serial_from_part_index(obj["key"])
            if hit and hit in st.parts:
                matches.append(
                    TraceMatch(
                        line_id=lid,
                        serial=hit,
                        capture_date=date.fromisoformat(st.parts[hit]["capture_date"]),
                        status=state.part_status(st, hit),
                    )
                )
        if len(matches) >= MAX_MATCHES:
            break
    return matches[:MAX_MATCHES]
