"""Inspection Archive: browse the lines/ prefix by line, date and kind.

Distinct from the full-bucket Bucket Explorer (/files): this view only ever
lists keys under one line's prefix and labels each with its kind.
"""

from app.repo import b2_store
from app.service import keys, lines
from app.service.errors import InspectionError
from app.types.inspection import ArchiveItem, ArchiveKind, ArchivePage

PAGE_SIZE = 60


def capture_dates(line_id: str) -> list[str]:
    dates = [
        d
        for d in (keys.date_from_prefix(p) for p in b2_store.list_prefixes(keys.line_prefix(line_id)))
        if d
    ]
    return sorted(dates, reverse=True)


def browse(
    line_id: str | None,
    capture_date: str | None,
    kind: ArchiveKind,
    cursor: str | None,
) -> ArchivePage:
    if line_id is None:
        all_lines = lines.list_lines()
        if not all_lines:
            return ArchivePage(items=[], next_cursor=None, dates=[], date=None)
        line_id = all_lines[0].line_id
    lines.get_line(line_id)
    dates = capture_dates(line_id)
    dated = kind in (ArchiveKind.images, ArchiveKind.heatmaps)
    if dated:
        capture_date = capture_date or (dates[0] if dates else None)
        if capture_date is None:
            return ArchivePage(items=[], next_cursor=None, dates=dates, date=None)
    else:
        capture_date = None
    try:
        prefix = keys.archive_prefix(line_id, kind, capture_date)
    except keys.InvalidKeyPart as e:
        raise InspectionError(str(e)) from None
    objects, _, next_token = b2_store.list_page(prefix, token=cursor, max_keys=PAGE_SIZE)
    items = [
        ArchiveItem(
            key=obj["key"],
            kind=kind,
            size=obj["size"],
            last_modified=obj["last_modified"],
            url=b2_store.view_url(obj["key"]),
        )
        for obj in objects
    ]
    return ArchivePage(items=items, next_cursor=next_token, dates=dates, date=capture_date)
