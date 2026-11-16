from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from app.types.base import ResponseModel


class ModelStatus(StrEnum):
    queued = "queued"
    training = "training"
    ready = "ready"
    failed = "failed"
    interrupted = "interrupted"


class TrainingSource(StrEnum):
    reference_and_adjudicated = "reference_and_adjudicated"
    reference_only = "reference_only"


ImageSize = Literal[256, 224]
CoresetRatio = Literal[0.01, 0.05, 0.1]


class TrainModelRequest(BaseModel):
    source: TrainingSource = TrainingSource.reference_and_adjudicated
    image_size: ImageSize = 256
    coreset_ratio: CoresetRatio = 0.1
    note: str | None = Field(default=None, max_length=500)


class ModelVersion(ResponseModel):
    """One trained (or training) PatchCore model version of a line."""

    line_id: str
    version: str
    status: ModelStatus
    backbone: str
    image_size: int
    coreset_ratio: float
    source: TrainingSource
    note: str | None = None
    train_image_count: int
    eval_image_count: int
    threshold: float | None = None
    threshold_method: str | None = Field(
        default=None, description="f1_max on a split with anomalies, else p99_normal."
    )
    image_auroc: float | None = None
    image_f1: float | None = None
    parent_version: str | None = Field(
        default=None, description="Line's active version when this one was trained."
    )
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    anomalib_version: str | None = None


class TrainingSetEntry(ResponseModel):
    key: str
    etag: str
    serial: str
    role: Literal["train", "eval"]
    label: Literal["normal", "anomalous"]
    source: Literal["reference", "verdict"]


class ModelVersionDetail(ModelVersion):
    metrics: dict[str, float | int | str | None] = Field(
        description="Full metrics.json: AUROC, F1, threshold, counts."
    )
    training_set: list[TrainingSetEntry]
    checkpoint_url: str | None = None
    metrics_url: str | None = None
