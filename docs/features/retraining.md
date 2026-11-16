<!-- last_verified: 2026-11-16 -->
# Feature: Retraining and Model Versions

## Purpose
Train a new PatchCore model version from images read back from B2 (reference images plus operator-adjudicated parts) and store it beside its metrics, threshold and a manifest of every image used, so any score can be explained by the model that produced it.

## Used By
- UI: `/lines/{lineId}/models` (versions table, "Train new version" form, Activate), `/lines/{lineId}/models/{version}`
- API: `GET/POST /lines/{line_id}/models`, `GET /lines/{line_id}/models/{version}`, `POST /lines/{line_id}/models/{version}/activate`, `GET /engine`

## Core Functions
- `apps/web/src/components/inspection/train-form.tsx`: source `RadioGroup`, image size segmented control (256 / 224), coreset ratio `Select` (0.01 / 0.05 / 0.1), note
- `services/api/app/service/training.py`: `assemble_training_set()`, `start_training()`, `run_training()`
- `services/api/app/service/train_runner.py`: one FIFO worker thread, one job at a time
- `services/api/app/service/model_versions.py`: `reconcile()`, `activate()`, `detail()`
- `services/api/app/service/metrics_calc.py`: `auroc()`, `f1_max_threshold()`, `evaluate()`
- `services/api/app/repo/anomaly_train.py`: `train_patchcore()` (Folder datamodule + Engine)
- `services/api/app/repo/anomaly_engine.py`: device auto-detect, pinned backbone weights, `status()`

## Inputs
- `TrainModelRequest`: `source` (`reference_and_adjudicated` default, or `reference_only`), `image_size` (256 default, or 224), `coreset_ratio` (0.1 default, 0.05, 0.01), `note`

## Outputs
- `lines/<line>/models/v<N>/training-set.json`: every image key with its B2 ETag, role (`train` | `eval`), label (`normal` | `anomalous`), source (`reference` | `verdict`)
- `lines/<line>/models/v<N>/version.json`: the `ModelVersion` record (config, status, timestamps, threshold, metrics summary)
- `lines/<line>/models/v<N>/model.ckpt`: the PatchCore memory bank (float16) plus its config
- `lines/<line>/models/v<N>/metrics.json`: threshold and method, image AUROC, image F1, eval counts, eval scores, device, Anomalib and torch versions

## Flow
- Assembly: reference normals train, except every 5th by serial (at least one) which is held out; reference anomalies evaluate. With adjudicated images, a part's latest verdict decides: `pass` joins the normal training images, `fail` joins the eval split as anomalous (PatchCore trains on normal images only). At least 2 training and 1 held-out normal image are required (400 otherwise)
- Each image is `head_object`ed for its ETag, the manifest and a `queued` record are written, and the job is queued
- The job marks the record `training`, fills the local cache from B2 by key + ETag, links the cached files into `train/good`, `test/good`, `test/defect`, and runs Anomalib's `Folder` datamodule and `Engine.fit` with PatchCore (`wide_resnet50_2.tv2_in1k`, layers `layer2` + `layer3`)
- Eval: every held-out image is scored; the threshold is the F1-maximising cut-off when the split has anomalies (`f1_max`), else the 99th percentile of held-out normal scores (`p99_normal`). Scores and thresholds are raw PatchCore units
- The checkpoint, metrics and final `ready` record are written to B2. A line's first ready version is activated automatically; later ones need "Activate"
- Device: CUDA, then Apple MPS, then CPU (`INSPECTION_DEVICE` overrides); a fit that fails on MPS is retried on CPU

## Edge Cases
- ML extra missing: `POST .../models` answers 503 with the install hint; the form is disabled and the engine notice is shown
- API restart mid-job: a `queued`/`training` record no live job owns reads as `interrupted` (and is saved that way), never stuck
- Training fails: status `failed` with the error text
- Activating a version that is not `ready`: 409

## UX States
- Versions table polls every 5 seconds while a version is queued or training
- Detail page: configuration, metrics, downloadable checkpoint and metrics, manifest table linking each serial to Trace

## Verification
- Test files: `services/api/tests/test_inspection_logic.py` (training-set assembly, metrics), `services/api/tests/test_inspection_api.py` (manifest with ETags, interrupted on restart, activate guard, 503), `services/api/live_tests/test_inspection_flow.py` (real v1 and v2 on CPU)
- Focused verify command: `pnpm test:api`; real training: `make test`
- Default pre-PR verify command: `pnpm verify`

## Related Docs
- [Review Queue](review-queue.md), [Trace](trace.md)
- [RELIABILITY.md](../RELIABILITY.md)
