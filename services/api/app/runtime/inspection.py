# Handlers are sync `def` on purpose: every call is blocking boto3 (and, for
# scoring, PyTorch), so Starlette runs them in its threadpool.
#
# There is deliberately NO delete route for inspection records: the archive
# exists so a quality question years later can be answered from the original
# image, score and model (see docs/SECURITY.md).
from fastapi import APIRouter, Query

from app.runtime.errors import call
from app.service import inspection, review, trace
from app.types.inspection import (
    CapturePartRequest,
    InspectionPage,
    InspectionRecord,
    PartStatus,
    PartTrace,
    PresignCaptureRequest,
    PresignCaptureResponse,
    ReviewItem,
    ScorePartRequest,
    TraceMatch,
    VerdictRequest,
)

router = APIRouter()


@router.post("/lines/{line_id}/parts/presign", response_model=PresignCaptureResponse)
def presign_capture(line_id: str, req: PresignCaptureRequest):
    """Presigned PUT for a part image straight to its line/date key. 409 on a used serial."""
    return call(inspection.presign_capture, line_id, req)


@router.post("/lines/{line_id}/parts", response_model=InspectionRecord)
def capture_part(line_id: str, req: CapturePartRequest):
    """Register an uploaded part image and score it with the line's active model."""
    return call(inspection.capture_part, line_id, req)


@router.get("/lines/{line_id}/parts", response_model=InspectionPage)
def list_parts(
    line_id: str,
    date: str | None = Query(default=None, description="Capture date YYYY-MM-DD."),
    status: PartStatus | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
):
    """Parts on a line, newest capture first."""
    return call(inspection.list_parts, line_id, date, status, limit, cursor)


@router.get("/lines/{line_id}/parts/{serial}", response_model=PartTrace)
def get_part(line_id: str, serial: str):
    """The full record: image, heatmaps, score history, verdict history, model."""
    return call(trace.get_trace, line_id, serial)


@router.post("/lines/{line_id}/parts/{serial}/score", response_model=InspectionRecord)
def score_part(line_id: str, serial: str, req: ScorePartRequest):
    """Score or re-score a part. 503 without the ML extra; 409 without a ready model."""
    return call(inspection.score_part, line_id, serial, req.model_version)


@router.put("/lines/{line_id}/parts/{serial}/verdict", response_model=InspectionRecord)
def record_verdict(line_id: str, serial: str, req: VerdictRequest):
    """Append an operator verdict; earlier verdicts stay in the history."""
    return call(inspection.record_verdict, line_id, serial, req)


@router.get("/review-queue", response_model=list[ReviewItem])
def review_queue(
    line_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
):
    """Parts above threshold with no verdict yet, oldest first."""
    return call(review.review_queue, line_id, limit)


@router.get("/trace", response_model=list[TraceMatch])
def trace_search(serial: str, line_id: str | None = None):
    """Find parts by serial (prefix match) across lines."""
    return call(trace.search, serial, line_id)
