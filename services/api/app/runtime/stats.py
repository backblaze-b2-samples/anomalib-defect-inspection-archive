# Handlers are sync `def` on purpose (blocking boto3), see runtime/lines.py.
from fastapi import APIRouter

from app.runtime.errors import call
from app.service import stats
from app.types.inspection import InspectionStats, StatsProgress

router = APIRouter()


@router.get("/inspection/stats", response_model=InspectionStats)
def inspection_stats():
    """Dashboard aggregates across every line."""
    return call(stats.inspection_stats)


@router.get("/inspection/stats/progress", response_model=StatsProgress)
def inspection_stats_progress():
    """Lines processed so far by the running (or last) stats computation."""
    return call(stats.progress)
