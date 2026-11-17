"""Model version records: read, list, reconcile after a restart, activate."""

from datetime import UTC, datetime

from app.repo import b2_store
from app.service import keys, lines, train_runner
from app.service.errors import InspectionError, conflict, not_found
from app.types.lines import Line, LineDetail
from app.types.models import ModelStatus, ModelVersion, ModelVersionDetail, TrainingSetEntry

UNFINISHED = (ModelStatus.queued, ModelStatus.training)
INTERRUPTED_MESSAGE = "The API restarted before this training job finished; train again."


def job_id(line_id: str, version: str) -> str:
    return f"{line_id}/{version}"


def save(record: ModelVersion) -> None:
    key = keys.model_file(record.line_id, record.version, "version.json")
    # `active` belongs to the line record; storing it here would go stale.
    b2_store.put_json(key, record.model_dump(mode="json", exclude={"active"}))


def reconcile(record: ModelVersion) -> ModelVersion:
    """A `queued`/`training` record no live job owns becomes `interrupted`."""
    if record.status in UNFINISHED and not train_runner.is_tracked(
        job_id(record.line_id, record.version)
    ):
        record.status = ModelStatus.interrupted
        record.error = INTERRUPTED_MESSAGE
        record.stage = None
        record.finished_at = datetime.now(UTC)
        save(record)
    return record


def get_version(line_id: str, version: str) -> ModelVersion:
    keys.check_version(version)
    try:
        raw = b2_store.get_json(keys.model_file(line_id, version, "version.json"))
    except b2_store.ObjectNotFound:
        raise not_found(f"Model version '{version}' not found on line '{line_id}'") from None
    return reconcile(ModelVersion.model_validate(raw))


def version_numbers(line_id: str) -> list[int]:
    out = []
    for prefix in b2_store.list_prefixes(keys.models_prefix(line_id)):
        version = keys.version_from_prefix(prefix)
        if version:
            out.append(int(version[1:]))
    return sorted(out)


def list_versions(line_id: str) -> list[ModelVersion]:
    """Newest first, each marked `active` from the same read of the line."""
    active = lines.get_line(line_id).active_model_version
    out = []
    for number in version_numbers(line_id):
        try:
            out.append(get_version(line_id, f"v{number}"))
        except InspectionError as e:
            if e.status_code != 404:  # a version folder still being written
                raise
    for record in out:
        record.active = record.version == active
    return sorted(out, key=lambda record: int(record.version[1:]), reverse=True)


def require_ready(line_id: str, version: str) -> ModelVersion:
    record = get_version(line_id, version)
    if record.status != ModelStatus.ready or record.threshold is None:
        raise conflict(f"Model version '{version}' is {record.status.value}, not ready")
    return record


def activate(line_id: str, version: str) -> Line:
    require_ready(line_id, version)
    return lines.set_active_model(line_id, version)


def active_threshold(line: Line) -> float | None:
    if not line.active_model_version:
        return None
    try:
        return get_version(line.line_id, line.active_model_version).threshold
    except InspectionError:
        return None


def detail(line_id: str, version: str) -> ModelVersionDetail:
    record = get_version(line_id, version)
    try:
        manifest = b2_store.get_json(keys.model_file(line_id, version, "training-set.json"))
    except b2_store.ObjectNotFound:
        manifest = {"entries": []}
    metrics_key = keys.model_file(line_id, version, "metrics.json")
    ckpt_key = keys.model_file(line_id, version, "model.ckpt")
    metrics: dict = {}
    if record.status == ModelStatus.ready:
        try:
            metrics = b2_store.get_json(metrics_key)
        except b2_store.ObjectNotFound:
            metrics = {}
    ready = record.status == ModelStatus.ready
    record.active = lines.get_line(line_id).active_model_version == version
    return ModelVersionDetail(
        **record.model_dump(),
        metrics={k: v for k, v in metrics.items() if isinstance(v, (int, float, str)) or v is None},
        training_set=[TrainingSetEntry.model_validate(e) for e in manifest.get("entries", [])],
        checkpoint_url=b2_store.view_url(ckpt_key) if ready else None,
        metrics_url=b2_store.view_url(metrics_key) if ready else None,
    )


def line_detail(line_id: str) -> LineDetail:
    line = lines.get_line(line_id)
    return lines.line_detail(
        line_id,
        model_count=len(version_numbers(line_id)),
        active_threshold=active_threshold(line),
    )
