from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.types.base import ResponseModel

LINE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]{1,40}$"
# A PatchCore run needs 2 normal training images plus 1 held-out normal that
# sets the threshold; held-out images only ever come from known-good references.
MIN_TRAIN_IMAGES = 2
MIN_NORMAL_REFERENCES = MIN_TRAIN_IMAGES + 1


class Line(ResponseModel):
    """An inspection line: the container for parts, scores, labels and models."""

    line_id: str
    name: str
    description: str | None = None
    active_model_version: str | None = Field(
        default=None,
        description="Model version that scores new captures; changes only via /activate.",
    )
    created_at: datetime
    updated_at: datetime


class CreateLineRequest(BaseModel):
    line_id: str = Field(pattern=LINE_ID_PATTERN, description="Slug, e.g. line-01.")
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class UpdateLineRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class ScoreSummary(ResponseModel):
    """Latest score per scored part on a line."""

    scored_count: int
    above_threshold_count: int
    min_score: float | None = None
    max_score: float | None = None
    mean_score: float | None = None
    threshold: float | None = Field(
        default=None, description="Threshold of the active model version, when one is ready."
    )
    recent_scores: list[float] = Field(
        description="Latest score of up to 500 parts, for the distribution chart."
    )


class LineDetail(Line):
    part_count: int
    unscored_count: int
    in_review_count: int
    passed_count: int
    failed_count: int
    model_count: int
    normal_reference_count: int = Field(
        description="Known-good reference images without a verdict: the pool the "
        "held-out threshold image comes from."
    )
    min_normal_references: int = Field(
        default=MIN_NORMAL_REFERENCES,
        description="Known-good references a first training run needs.",
    )
    scores: ScoreSummary


class ScoreJobStatus(StrEnum):
    idle = "idle"
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


class ScoreJob(ResponseModel):
    """Server-side run that scores every unscored part of a line.

    It runs in the API process, so leaving or reloading the page does not stop it.
    """

    line_id: str
    status: ScoreJobStatus
    model_version: str | None = None
    total: int | None = Field(default=None, description="Parts to score; null until counted.")
    scored: int = 0
    failed: int = 0
    error: str | None = Field(default=None, description="Last per-part error, if any.")
    started_at: datetime | None = None
    finished_at: datetime | None = None
