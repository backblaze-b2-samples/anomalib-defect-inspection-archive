"""Train new PatchCore model versions from images read back from B2.

Flow (the part that must not change): list the line's reference and
adjudicated images in B2, record each key + ETag in training-set.json, fill the
local cache from B2 through the app's boto3 client, point Anomalib's Folder
datamodule at the cache, train, evaluate on the held-out split, then write the
checkpoint, metrics and manifest back to B2 beside the version record.
"""

import json
import logging
from datetime import UTC, datetime
from threading import Lock

from app.repo import anomaly_engine, b2_store, local_cache
from app.repo.anomaly_train import train_patchcore
from app.service import keys, lines, metrics_calc, model_versions, state, train_runner
from app.service.errors import InspectionError, unavailable
from app.types.models import ModelStatus, ModelVersion, TrainingSource, TrainModelRequest

logger = logging.getLogger(__name__)

MIN_TRAIN_IMAGES = 2
HOLDOUT_EVERY = 5  # every 5th reference normal (by serial) is held out for eval
_start_lock = Lock()


def assemble_training_set(st: state.LineState, source: TrainingSource) -> list[dict]:
    """Entries (without ETags) for a training run.

    Reference normals train, except every 5th (by serial) which is held out for
    eval; reference anomalies are eval-only. With adjudicated images, a part's
    latest verdict decides: `pass` joins the normal TRAINING images, `fail`
    joins the eval split as anomalous (PatchCore trains on normal images only).
    """
    use_verdicts = source == TrainingSource.reference_and_adjudicated
    reference_normals, entries = [], []
    for serial in sorted(st.parts):
        part = st.parts[serial]
        verdict = state.latest_verdict(st, serial) if use_verdicts else None
        if verdict is not None:
            anomalous = verdict["verdict"] == "fail"
            entries.append(
                {
                    "serial": serial,
                    "key": part["image_key"],
                    "role": "eval" if anomalous else "train",
                    "label": "anomalous" if anomalous else "normal",
                    "source": "verdict",
                }
            )
        elif part.get("reference") == "anomalous":
            entries.append(
                {"serial": serial, "key": part["image_key"], "role": "eval",
                 "label": "anomalous", "source": "reference"}
            )
        elif part.get("reference") == "normal":
            reference_normals.append((serial, part["image_key"]))
    held_out = {i for i in range(len(reference_normals)) if i % HOLDOUT_EVERY == HOLDOUT_EVERY - 1}
    if not held_out and len(reference_normals) >= MIN_TRAIN_IMAGES + 1:
        held_out = {len(reference_normals) - 1}
    for i, (serial, key) in enumerate(reference_normals):
        entries.append(
            {"serial": serial, "key": key, "role": "eval" if i in held_out else "train",
             "label": "normal", "source": "reference"}
        )
    return sorted(entries, key=lambda e: (e["role"], e["label"], e["serial"]))


def _check_trainable(entries: list[dict]) -> None:
    train = sum(1 for e in entries if e["role"] == "train")
    eval_normals = sum(1 for e in entries if e["role"] == "eval" and e["label"] == "normal")
    if train < MIN_TRAIN_IMAGES or eval_normals < 1:
        raise InspectionError(
            f"Not enough normal images: {train} for training (need {MIN_TRAIN_IMAGES}) and "
            f"{eval_normals} held out (need 1). Capture more parts marked as normal "
            "references, or record pass verdicts.",
            400,
        )


def start_training(line_id: str, req: TrainModelRequest) -> ModelVersion:
    """Validate, write the manifest and a `queued` record, enqueue the job."""
    line = lines.get_line(line_id)
    if not anomaly_engine.ml_installed():
        raise unavailable(anomaly_engine.INSTALL_HINT)
    with _start_lock:
        entries = assemble_training_set(state.load_line_state(line_id), req.source)
        _check_trainable(entries)
        for entry in entries:
            meta = b2_store.head(entry["key"])
            if meta is None:
                raise InspectionError(f"Image '{entry['key']}' is missing from B2", 409)
            entry["etag"] = meta["etag"]
        numbers = model_versions.version_numbers(line_id)
        version = f"v{(numbers[-1] if numbers else 0) + 1}"
        record = ModelVersion(
            line_id=line_id,
            version=version,
            status=ModelStatus.queued,
            backbone=anomaly_engine.BACKBONE,
            image_size=req.image_size,
            coreset_ratio=req.coreset_ratio,
            source=req.source,
            note=req.note,
            train_image_count=sum(1 for e in entries if e["role"] == "train"),
            eval_image_count=sum(1 for e in entries if e["role"] == "eval"),
            parent_version=line.active_model_version,
            created_at=datetime.now(UTC),
            anomalib_version=anomaly_engine.anomalib_version(),
        )
        manifest = {
            "line_id": line_id,
            "version": version,
            "weights": anomaly_engine.WEIGHTS,
            "source": req.source.value,
            "entries": entries,
        }
        b2_store.put_json(keys.model_file(line_id, version, "training-set.json"), manifest)
        # Track the job BEFORE the record says `queued`, so a concurrent read
        # can never mistake a fresh job for one interrupted by a restart; and
        # enqueue it only AFTER, so the worker always finds the record.
        job = model_versions.job_id(line_id, version)
        train_runner.track(job)
        model_versions.save(record)
        train_runner.submit(job, lambda: run_training(line_id, version))
    return record


def _prepare_run_dir(line_id: str, version: str, entries: list[dict]):
    run_dir = local_cache.workdir(line_id, version)
    eval_paths: list[tuple[dict, object]] = []
    for entry in entries:
        cached = local_cache.fetch(entry["key"], entry["etag"])
        name = f"{entry['serial']}.png"
        if entry["role"] == "train":
            local_cache.link_into(cached, run_dir / "train" / "good", name)
            continue
        folder = "defect" if entry["label"] == "anomalous" else "good"
        eval_paths.append((entry, local_cache.link_into(cached, run_dir / "test" / folder, name)))
    return run_dir, eval_paths


def run_training(line_id: str, version: str) -> None:
    """The job body: runs on the train-runner thread."""
    key_of = lambda name: keys.model_file(line_id, version, name)  # noqa: E731
    record = model_versions.get_version(line_id, version)
    record.status = ModelStatus.training
    record.started_at = datetime.now(UTC)
    model_versions.save(record)
    try:
        manifest = b2_store.get_json(key_of("training-set.json"))
        run_dir, eval_paths = _prepare_run_dir(line_id, version, manifest["entries"])
        scorer = train_patchcore(run_dir, record.image_size, record.coreset_ratio)
        labels = [1 if e["label"] == "anomalous" else 0 for e, _ in eval_paths]
        scores = [scorer.score(path)[0] for _, path in eval_paths]
        metrics = metrics_calc.evaluate(labels, scores)
        metrics.update(
            {
                "train_image_count": record.train_image_count,
                "eval_image_count": record.eval_image_count,
                "weights": anomaly_engine.WEIGHTS,
                "image_size": record.image_size,
                "coreset_ratio": record.coreset_ratio,
                "device": scorer.device,
                "anomalib_version": anomaly_engine.anomalib_version(),
                "torch_version": anomaly_engine.torch_version(),
                "eval_scores": json.dumps([round(s, 6) for s in scores]),
            }
        )
        checkpoint = run_dir / "model.ckpt"
        scorer.save_checkpoint(checkpoint, {"line_id": line_id, "version": version,
                                            "threshold": metrics["threshold"]})
        b2_store.put_bytes(
            key_of("model.ckpt"), checkpoint.read_bytes(), "application/octet-stream", bulk=True
        )
        b2_store.put_json(key_of("metrics.json"), metrics)
        record.status = ModelStatus.ready
        record.threshold = metrics["threshold"]
        record.threshold_method = metrics["threshold_method"]
        record.image_auroc = metrics["image_auroc"]
        record.image_f1 = metrics["image_f1"]
        record.anomalib_version = metrics["anomalib_version"]
    except anomaly_engine.EngineUnavailable as e:
        record.status, record.error = ModelStatus.failed, str(e)
    except Exception as e:
        logger.exception("Training %s/%s failed", line_id, version)
        record.status, record.error = ModelStatus.failed, f"{type(e).__name__}: {e}"[:500]
    record.finished_at = datetime.now(UTC)
    model_versions.save(record)
    if record.status == ModelStatus.ready and lines.get_line(line_id).active_model_version is None:
        lines.set_active_model(line_id, version)  # a line's first model goes live
