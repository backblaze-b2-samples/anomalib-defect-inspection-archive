# Handlers are sync `def` on purpose (blocking boto3), see runtime/lines.py.
from fastapi import APIRouter, Query

from app.runtime.errors import call
from app.service import archive
from app.types.inspection import ArchiveKind, ArchivePage

router = APIRouter()


@router.get("/archive", response_model=ArchivePage)
def browse_archive(
    line_id: str | None = None,
    date: str | None = Query(default=None, description="Capture date; images/heatmaps only."),
    kind: ArchiveKind = ArchiveKind.images,
    cursor: str | None = None,
):
    """Browse one line's images, heatmaps, scores, labels or models."""
    return call(archive.browse, line_id, date, kind, cursor)
