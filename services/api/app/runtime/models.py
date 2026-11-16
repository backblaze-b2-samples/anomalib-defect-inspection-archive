# Handlers are sync `def` on purpose (blocking boto3), see runtime/lines.py.
from fastapi import APIRouter

from app.repo import anomaly_engine
from app.runtime.errors import call
from app.service import model_versions, training
from app.types.inspection import EngineStatus
from app.types.lines import Line
from app.types.models import ModelVersion, ModelVersionDetail, TrainModelRequest

router = APIRouter()


@router.get("/lines/{line_id}/models", response_model=list[ModelVersion])
def list_models(line_id: str):
    """Model versions of a line, newest first."""
    return call(model_versions.list_versions, line_id)


@router.post("/lines/{line_id}/models", response_model=ModelVersion)
def train_model(line_id: str, req: TrainModelRequest):
    """Queue a training run on images read from B2. 503 without the ML extra."""
    return call(training.start_training, line_id, req)


@router.get("/lines/{line_id}/models/{version}", response_model=ModelVersionDetail)
def get_model(line_id: str, version: str):
    """Metrics, threshold and the training-set manifest (keys + ETags)."""
    return call(model_versions.detail, line_id, version)


@router.post("/lines/{line_id}/models/{version}/activate", response_model=Line)
def activate_model(line_id: str, version: str):
    """Make a ready version the one that scores new captures."""
    return call(model_versions.activate, line_id, version)


@router.get("/engine", response_model=EngineStatus)
def engine_status():
    """Whether the anomaly engine is installed, and the device it would use."""
    return EngineStatus(**anomaly_engine.status())
