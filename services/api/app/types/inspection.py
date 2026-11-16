from datetime import date, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from app.types.base import ResponseModel
from app.types.models import ModelVersion

SERIAL_PATTERN = r"^[A-Za-z0-9._-]{1,64}$"


class PartStatus(StrEnum):
    unscored = "unscored"
    below_threshold = "below_threshold"
    in_review = "in_review"
    passed = "passed"
    failed = "failed"


class Verdict(StrEnum):
    pass_ = "pass"
    fail = "fail"


class ReferenceLabel(StrEnum):
    normal = "normal"
    anomalous = "anomalous"


class ArchiveKind(StrEnum):
    images = "images"
    heatmaps = "heatmaps"
    scores = "scores"
    labels = "labels"
    models = "models"


class PresignCaptureRequest(BaseModel):
    serial: str = Field(pattern=SERIAL_PATTERN, description="Part serial, e.g. CNDL-000123.")
    content_type: Literal["image/png", "image/jpeg"]
    size_bytes: int = Field(gt=0, description="Signed into the URL; B2 rejects any other size.")


class PresignCaptureResponse(ResponseModel):
    upload_url: str
    image_key: str
    capture_date: date
    content_type: str
    headers: dict[str, str] = Field(description="Send verbatim with the PUT; signed into the URL.")
    expires_in: int


class CapturePartRequest(BaseModel):
    serial: str = Field(pattern=SERIAL_PATTERN)
    image_key: str = Field(description="Must equal the key the presign step returned.")
    score_now: bool = True
    reference: ReferenceLabel | None = Field(
        default=None,
        description="Mark the part as a reference image (normal or anomalous) for training.",
    )


class InspectionRecord(ResponseModel):
    """One inspected part: the primary entity."""

    line_id: str
    serial: str
    capture_date: date
    captured_at: datetime
    image_key: str
    status: PartStatus
    reference: ReferenceLabel | None = None
    score: float | None = None
    threshold: float | None = None
    model_version: str | None = None
    heatmap_key: str | None = None
    verdict: Verdict | None = None
    scored_at: datetime | None = None
    image_url: str
    heatmap_url: str | None = None


class InspectionPage(ResponseModel):
    items: list[InspectionRecord]
    next_cursor: str | None = None


class ScorePartRequest(BaseModel):
    model_version: str | None = Field(
        default=None, description="Defaults to the line's active model version."
    )


class VerdictRequest(BaseModel):
    verdict: Verdict
    operator: str = Field(min_length=1, max_length=64)
    note: str | None = Field(default=None, max_length=500)


class ScoreEntry(ResponseModel):
    score: float
    threshold: float
    above_threshold: bool
    model_version: str
    backbone: str
    anomalib_version: str
    heatmap_key: str
    heatmap_url: str
    scored_at: datetime


class VerdictEntry(ResponseModel):
    verdict: Verdict
    operator: str
    note: str | None = None
    score_ref: str | None = Field(
        default=None, description="'<scored_at>@<model_version>' the operator reviewed."
    )
    recorded_at: datetime


class PartTrace(InspectionRecord):
    scores: list[ScoreEntry]
    verdicts: list[VerdictEntry]
    model: ModelVersion | None = None
    parquet_keys: list[str]


class ReviewItem(InspectionRecord):
    """An InspectionRecord in status in_review."""


class TraceMatch(ResponseModel):
    line_id: str
    serial: str
    capture_date: date
    status: PartStatus


class ArchiveItem(ResponseModel):
    key: str
    kind: ArchiveKind
    size: int
    last_modified: datetime
    url: str


class ArchivePage(ResponseModel):
    items: list[ArchiveItem]
    next_cursor: str | None = None
    dates: list[str] = Field(description="Capture dates that exist for the line, newest first.")
    date: str | None = Field(default=None, description="Capture date the items belong to.")


class DailyPartCount(ResponseModel):
    date: str
    count: int


class InspectionStats(ResponseModel):
    parts_inspected: int
    above_threshold: int
    review_backlog: int
    passed: int
    failed: int
    model_versions: int
    bytes_by_kind: dict[str, int]
    parts_per_day: list[DailyPartCount]
    recent_above_threshold: list[InspectionRecord]


class EngineStatus(ResponseModel):
    ml_available: bool
    anomalib_version: str | None = None
    torch_version: str | None = None
    device: str
    backbone: str
    weights: str
    install_hint: str | None = None
