# Build plan: `anomalib-defect-inspection-archive`

Scaffolded from the `backblaze-b2-samples/vibe-coding-starter-kit` repository at
commit `e0884f877f3a92034ba915625f2d5f7104e4635e`. The starter kit is the ceiling:
strip what this app does not need rather than rebuild. Published repository name:
`anomalib-b2-inspection-archive` (local directory `anomalib-defect-inspection-archive`).

## 1. Purpose

A **visual inspection archive** for camera-based part inspection lines. Each
inspected part image lands in Backblaze B2 under its line and date; **Anomalib
PatchCore** scores it locally and writes an anomaly heatmap plus a score row (serial,
score, threshold, model version) to a Parquet table; parts above the threshold enter
a review queue where an operator records a pass or fail verdict; adjudicated images
build the next training set, from which a new model version is trained **from images
read from B2** and stored beside its metrics. Any part serial returns its full
record: image, heatmap, score, verdict and the model version that scored it. It is
for ML and manufacturing-software engineers who need an inspection pipeline whose
results can be traced and explained long after the fact, and who want a permanent,
growing image archive on object storage. B2 is the only storage layer, accessed
through the S3-compatible API with a custom user agent and the standard `B2_*` env
vars; the anomaly model runs on local open source software, so there is **no second
API key**. A GPU is optional, never required.

Out of scope (do not build, do not claim): real camera or PLC integration, any
line-rate or throughput claim, other anomaly libraries, MVTec AD or MVTec AD 2 (not
used, not offered as options), deleting inspection records, and any statement of
compliance with a specific quality standard.

## 2. Architecture delta from vibe-coding-starter-kit

Backend layering (`types -> config -> repo -> service -> runtime`), the generated API
and doc seams, the shadcn UI kit and every mechanical gate (`pnpm verify`,
`check:agent-docs`, `gen:check`, structure tests) are kept and respected.

**KEEP (as-is)**
- UI kit `apps/web/src/components/ui/`, design tokens in `globals.css`, the `/design`
  page, layout shell (sidebar, header, command palette, health banner).
- **Bucket Explorer**: `/files`, `apps/web/src/app/files/`, `components/files/`, the
  full-bucket `list_objects_v2` listing and its `/files*` and `/files-by-key/*`
  endpoints. Non-negotiable keep. It stays the generic full-bucket view.
- **Upload** route `/upload`, `components/upload/` and the presigned-PUT flow,
  repurposed as **Capture** (see ADD), not replaced.
- **Settings** (`/settings`, `settings-form.tsx`, danger zone).
- Backend `repo/b2_client.py` (the single boto3 client factory), `repo/b2_object.py`,
  `repo/b2_upload.py`, `repo/list_cache.py`, `repo/counter.py`, `runtime/health.py`,
  `runtime/metrics.py`, `runtime/ratelimit.py`, the file and upload services.
- Railway infra, generators (`gen:docs`, `gen:api`, `contract:export`), CI, agent doc
  shims (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, copilot instructions).

**TRIM (remove from starter)**
- **Vercel deployment**: remove root `vercel.json`, `apps/web/vercel.json`,
  `services/api/vercel.json`, `services/api/index.py`, `test_vercel_entrypoint.py`,
  `infra/vercel/` and the Vercel button. Rationale: PatchCore training and scoring
  run PyTorch with a pretrained CNN backbone and a model checkpoint, which neither fit
  nor finish inside a serverless function. `deployment_targets` becomes
  `["railway"]`; the primary use is local.
- Dashboard default cards, upload chart and recent-uploads table: rewritten (ADD).
- `docs/features/metadata-extraction.md`: delete as a standalone feature doc
  (off-theme); the generic detail endpoint stays, documented in the Bucket Explorer
  doc.
- Upload accept-list entries for non-image types: Capture accepts PNG and JPEG only
  (JPEG is converted to PNG server-side so the stored key is always `<serial>.png`).

**ADD (new for this app)**
- **Lines** (`/lines`, `/lines/[lineId]`): a line is the container (id, display
  name, description, active model version). Detail shows today's parts, score
  distribution, active model, links to review queue, models and archive.
- **Capture** (rewritten `/upload`): choose a line (Select) and a serial, drop an
  image; the browser uploads by presigned PUT straight to
  `lines/<line-id>/<date>/images/<serial>.png`, then calls the register endpoint,
  which scores the part with the line's active model. A line with no model yet
  stores the image and leaves it `unscored` until a model exists.
- **Inspection records** (the primary entity, see section 4): part list per line
  with status filter, and the **Trace** page (`/trace`, `/trace/[lineId]/[serial]`)
  with a serial search box, image and heatmap side by side, score history (every
  scoring, each with its model version and threshold), verdict history, and links to
  the model version's metrics.
- **Review Queue** (`/review`): parts whose latest score is above the threshold and
  that have no verdict yet, oldest first, filterable by line. Each item opens a
  verdict panel (image, heatmap, score) with a pass/fail form.
- **Models** (`/lines/[lineId]/models`, `/lines/[lineId]/models/[version]`): list of
  model versions with metrics, training-set size and status; "Train new version"
  form; "Activate" action; detail shows metrics, the training-set manifest (keys and
  ETags of every image used) and the threshold.
- **Inspection Archive** (`/archive`): the **sample-specific asset explorer**, scoped
  to the `lines/` prefix: browse line -> date -> images and heatmaps as a paired
  grid, plus each line's `scores/`, `labels/` and `models/` folders. Distinct from
  the kept full-bucket explorer.
- Rewritten **Dashboard**: parts inspected, parts above threshold, review backlog,
  verdict counts, model versions, archive bytes by kind (images, heatmaps, scores,
  labels, models), parts per day chart, recent above-threshold parts.
- Backend `repo/anomaly_engine.py` (may be split into `repo/anomaly_train.py` and
  `repo/anomaly_infer.py` to respect the 300-line limit): the **only** place
  `torch`, `anomalib`, `lightning` and `timm` are imported, and **lazily**, so the
  core API and `pnpm verify` run without ML deps. When ML deps are missing, scoring
  and training endpoints return a clear 503 with the install command, and the UI
  shows it; capture still stores the image (status `unscored`).
- Backend `repo/local_cache.py`: fills a local cache directory (`INSPECTION_CACHE_DIR`,
  default `services/api/.cache/inspection/`, gitignored) from B2 with the kit's
  boto3 client (`get_object`), keyed by object key + ETag. **Anomalib reads training
  and scoring images only from this cache**, never from a download of its own, so
  every B2 request carries the custom user agent. The cache is disposable: deleting
  it changes nothing in B2.
- Backend `repo/parquet_scores.py` (pyarrow): score rows are appended as new Parquet
  part files (object storage is immutable, so "append" means one new file per
  scoring call, never a rewrite); reads list and concatenate the line's part files.
- Backend `repo/heatmap.py` (Pillow + numpy): render the anomaly map as a colour
  overlay PNG at the stored image size.
- `service/keys.py`: the **only** place the B2 key layout is built.
- `types/lines.py`, `types/inspection.py`, `types/models.py`, `service/lines.py`,
  `service/inspection.py` (capture, score, verdict, trace), `service/review.py`,
  `service/training.py`, `service/train_runner.py` (one background worker thread,
  FIFO, one training job at a time, status persisted in the model version record so
  a restart marks an unfinished job `interrupted`, never stuck `training`),
  `runtime/lines.py`, `runtime/inspection.py`, `runtime/models.py`,
  `runtime/archive.py`, `runtime/stats.py`.
- `services/api/requirements-ml.txt` (optional ML deps, section 4) and
  `pnpm setup:ml`. A root **`Makefile`** with `make test` and `make demo` (section 7).
- `scripts/visa_subset.py`: downloads the VisA archive from its official source,
  extracts only the chosen categories' members into a local cache, and verifies the
  split CSV. No dataset images are committed.

**B2 key layout** (everything under one app prefix, `lines/`; built only in
`service/keys.py`):
```
lines/<line-id>/line.json                                   Line record (name, description, active model)
lines/<line-id>/<date>/images/<serial>.png                  captured part image (never overwritten, never deleted)
lines/<line-id>/<date>/heatmaps/<serial>.<model-version>.png heatmap per scoring (one per model version)
lines/<line-id>/scores/date=<date>/<utc-ts>-<uuid>.parquet  appended score rows (immutable part files)
lines/<line-id>/labels/<serial>/<utc-ts>.json               verdict history (latest wins, earlier kept)
lines/<line-id>/parts/<serial>.json                         serial index: date, image key, captured_at
lines/<line-id>/models/<version>/model.ckpt                 trained PatchCore checkpoint
lines/<line-id>/models/<version>/metrics.json               evaluation metrics and threshold
lines/<line-id>/models/<version>/training-set.json          manifest: every training/eval key + ETag + label
lines/<line-id>/models/<version>/version.json               ModelVersion record (config, status, timestamps)
```
`<date>` is the capture date `YYYY-MM-DD` (UTC). `<version>` is `v<N>` (`v1`, `v2`,
...). `ALLOWED_KEY_PREFIX` = `lines/`. Serials are unique per line; capturing an
existing serial on the same line is a 409. Heatmaps are keyed by model version so
re-scoring with a new model keeps the earlier heatmap (traceability, by design).

**Score Parquet schema**: `line_id` (string), `serial` (string), `capture_date`
(date), `image_key` (string), `heatmap_key` (string), `score` (float64, the image
anomaly score), `threshold` (float64), `above_threshold` (bool), `model_version`
(string), `backbone` (string), `anomalib_version` (string), `scored_at` (timestamp
UTC). Readers tolerate added columns.

**Label JSON**: `serial`, `line_id`, `verdict` (`pass`|`fail`), `operator`, `note`,
`score_ref` (the scored_at + model_version the operator reviewed), `recorded_at`.

**Tension noted**: none with the bucket explorer; it stays as the full-bucket view
and the Inspection Archive is the scoped view.

## 3. B2 surface (S3-compatible only, no b2-native)

All operations go through boto3 in `repo/`, every client built by the kit's
`b2_client.py` with `Config(user_agent_extra="b2ai-anomalib-inspection-archive",
request_checksum_calculation="when_required",
response_checksum_validation="when_required")`. The endpoint is derived from
`B2_REGION`. No b2-native API anywhere; Anomalib never fetches from B2 itself.

| Operation | Why |
|---|---|
| presigned PUT | the browser (Capture) uploads a part image straight to its line/date key |
| put_object | heatmaps, score Parquet part files, labels, part index, line and model records, checkpoints, metrics, training-set manifests; also the self-test's simulated line upload |
| head_object | verify a captured upload; ETags for the training-set manifest; `/health` probe |
| get_object | fill the local cache for training and scoring; read records, Parquet files, checkpoints |
| list_objects_v2 | lines, parts, Parquet part files, labels, model versions, archive browse, full-bucket explorer, dashboard bytes |
| presigned GET | image, heatmap, Parquet and checkpoint links for the review page, trace page and archive |
| delete_object | kept only for the generic Bucket Explorer; **no inspection endpoint deletes anything** |

**API endpoints (recorded once here; routers and Pydantic models implement it,
`pnpm contract:export` + `pnpm gen:api` derive the web seam):**

| Path | Method | Request model | Response model |
|---|---|---|---|
| `/lines` | GET | none | `list[Line]` |
| `/lines` | POST | `CreateLineRequest` | `Line` |
| `/lines/{line_id}` | GET | none | `LineDetail` |
| `/lines/{line_id}` | PATCH | `UpdateLineRequest` | `Line` |
| `/lines/{line_id}/parts/presign` | POST | `PresignCaptureRequest` | `PresignCaptureResponse` |
| `/lines/{line_id}/parts` | POST | `CapturePartRequest` | `InspectionRecord` |
| `/lines/{line_id}/parts` | GET (`?date`, `?status`, `?limit`, `?cursor`) | none | `InspectionPage` |
| `/lines/{line_id}/parts/{serial}` | GET | none | `PartTrace` |
| `/lines/{line_id}/parts/{serial}/score` | POST | `ScorePartRequest` | `InspectionRecord` |
| `/lines/{line_id}/parts/{serial}/verdict` | PUT | `VerdictRequest` | `InspectionRecord` |
| `/review-queue` | GET (`?line_id`, `?limit`) | none | `list[ReviewItem]` |
| `/trace` | GET (`?serial`, `?line_id`) | none | `list[TraceMatch]` |
| `/lines/{line_id}/models` | GET | none | `list[ModelVersion]` |
| `/lines/{line_id}/models` | POST | `TrainModelRequest` | `ModelVersion` (status `queued` or `training`) |
| `/lines/{line_id}/models/{version}` | GET | none | `ModelVersionDetail` |
| `/lines/{line_id}/models/{version}/activate` | POST | none | `Line` |
| `/archive` | GET (`?line_id`, `?date`, `?kind`, `?cursor`) | none | `ArchivePage` |
| `/inspection/stats` | GET | none | `InspectionStats` |
| `/engine` | GET | none | `EngineStatus` |

Kept unchanged: `/files*`, `/files-by-key/*`, `/files/stats*`, `/upload/presign`,
`/upload/verify`, `/health`, `/metrics`.

**Pydantic models**:
- Enums: `PartStatus` = `unscored`, `below_threshold`, `in_review`, `passed`,
  `failed`. `Verdict` = `pass`, `fail`. `ModelStatus` = `queued`, `training`,
  `ready`, `failed`, `interrupted`. `ImageSize` = `256` (default), `224`.
  `CoresetRatio` = `0.01`, `0.05`, `0.1` (default `0.1` for the small demo set).
  `TrainingSource` = `reference_and_adjudicated` (default), `reference_only`.
  `ArchiveKind` = `images`, `heatmaps`, `scores`, `labels`, `models`.
- `Line`: line_id, name, description|None, active_model_version|None, created_at,
  updated_at. `CreateLineRequest`: line_id (slug pattern `^[a-z0-9][a-z0-9-]{1,40}$`),
  name, description?. `UpdateLineRequest`: name?, description?. (The active model
  changes only through `/activate`.)
- `LineDetail`: `Line` + part_count, in_review_count, verdict counts, model_count,
  latest scores summary.
- `PresignCaptureRequest`: serial (pattern `^[A-Za-z0-9._-]{1,64}$`), content_type
  (`image/png`|`image/jpeg`). `PresignCaptureResponse`: upload_url, image_key,
  capture_date, expires_in.
- `CapturePartRequest`: serial, image_key (must equal the key the presign produced),
  score_now (default true).
- `InspectionRecord`: line_id, serial, capture_date, image_key, status, score|None,
  threshold|None, model_version|None, heatmap_key|None, verdict|None, scored_at|None,
  plus presigned `image_url`, `heatmap_url|None`.
- `InspectionPage`: items + next_cursor.
- `ScorePartRequest`: model_version? (default the line's active version).
- `VerdictRequest`: verdict (`Verdict`), operator (1..64 chars), note? (<= 500).
  Recording a verdict appends a new label object; the earlier ones are kept.
- `ScoreEntry`: score, threshold, above_threshold, model_version, backbone,
  heatmap_key, heatmap_url, scored_at. `VerdictEntry`: verdict, operator, note,
  score_ref, recorded_at.
- `PartTrace`: `InspectionRecord` + `scores: list[ScoreEntry]`,
  `verdicts: list[VerdictEntry]`, `model: ModelVersion|None` (the version behind the
  latest score), `parquet_keys` (the part files the rows came from).
- `ReviewItem`: `InspectionRecord` (status `in_review`).
- `TraceMatch`: line_id, serial, capture_date, status.
- `TrainModelRequest`: source (`TrainingSource`), image_size (`ImageSize`),
  coreset_ratio (`CoresetRatio`), note?. Backbone is fixed (section 4), shown
  read-only.
- `ModelVersion`: line_id, version, status, backbone, image_size, coreset_ratio,
  train_image_count, eval_image_count, threshold|None, metrics summary
  (image_auroc|None, image_f1|None), parent_version|None, created_at, started_at|None,
  finished_at|None, error|None, anomalib_version.
- `ModelVersionDetail`: `ModelVersion` + full metrics + training-set manifest
  (key, etag, role `train`|`eval`, label `normal`|`anomalous`, source
  `reference`|`verdict`) + presigned checkpoint and metrics URLs.
- `ArchivePage`: items (key, kind, size, last_modified, presigned url) + next_cursor.
- `InspectionStats`: parts_inspected, above_threshold, review_backlog, passed,
  failed, model_versions, bytes_by_kind, parts_per_day, recent_above_threshold.
- `EngineStatus`: ml_available, anomalib_version|None, torch_version|None, device,
  backbone, install_hint|None.
- `primary_entity.schema` = `InspectionRecord`.

## 4. Key features

**External API provider: none.** Anomaly detection with Anomalib PatchCore is the
sample's whole point and it is on-device open source software, so no external
provider is used and the workload is `deployment: local`. Cost per full demo run:
**$0** for compute (no external API); B2 storage and transactions only. No provider
key.

Per-feature deployment:
- **Scoring and Retraining**: `deployment: local`. Engine: **Anomalib** (Apache-2.0),
  pinned to an exact current 2.x release in `requirements-ml.txt` (the implementation confirms
  the newest release that installs on Python 3.12 on macOS arm64 and Linux x86_64 CPU,
  and records it); model **PatchCore**. Device: defaults to CPU and auto-detects a
  GPU at runtime, first available of **CUDA -> Apple MPS -> CPU**; override with
  `INSPECTION_DEVICE=auto|cpu|cuda|mps`. PatchCore's nearest-neighbour search may hit
  ops with weak MPS support: set `PYTORCH_ENABLE_MPS_FALLBACK=1`, and if MPS still
  fails the engine falls back to CPU and logs it. `make test` forces `cpu` to prove
  the CPU path. Heavy deps (`torch`, `torchvision`, `anomalib`, `lightning`, `timm`)
  live in `services/api/requirements-ml.txt`, lazy-imported in `repo/`, **not** in
  `requirements.lock`, so `pnpm verify` and CI stay light.
- **Backbone (license caution)**: PatchCore uses an ImageNet-pretrained backbone. The
  implementation selects one whose **published weights license permits commercial use**, by
  reading its Hugging Face model card at build time. Preferred: `wide_resnet50_2`
  with the timm weights `timm/wide_resnet50_2.tv2_in1k` (model card license
  BSD-3-Clause); fallback: `resnet18` with `timm/resnet18.a1_in1k` (model card
  license Apache-2.0), which is also lighter on CPU. Layers `layer2` + `layer3`. The
  README records backbone, weights tag, source URL and license, and the engine pins
  the exact weights tag so Anomalib cannot silently pick different weights. Weights
  download anonymously from the public Hub (no token).
- **Threshold and metrics**: each training run evaluates on an eval split read from
  B2 (held-out reference normals plus anomalous images: VisA anomalies for `v1`, and
  `fail` verdicts for later versions). Threshold = the F1-maximising threshold on
  that split (Anomalib's adaptive threshold); if the split has no anomalous images,
  the 99th percentile of held-out normal scores, recorded with its method. Metrics:
  image AUROC, image F1 at threshold, counts. Stored in `metrics.json` and the
  `ModelVersion` record. Scores and thresholds are reported in the same (raw) units.
- **Capture, Lines, Review Queue, Trace, Archive, Dashboard, Bucket Explorer,
  Settings**: no external deps (pyarrow and Pillow are core deps).

**Training data flow (the "must not change")**: training lists the line's reference
images and adjudicated images in B2, records each key + ETag in
`training-set.json`, fills the local cache from B2 through the kit's boto3 client,
points Anomalib's `Folder` datamodule at the cache, trains, then writes the
checkpoint, metrics and manifest back to B2. Adjudicated `pass` parts join the
normal training images; adjudicated `fail` parts join the eval split as anomalous
(PatchCore trains on normal images only). Reference images are the line's first
captures marked as reference by the seed step (`lines/<line-id>/<date>/images/`
plus a `reference: true` flag in the part index). Every inspected image and heatmap
stays in B2 with the model version that scored it.

**Demo data**: **VisA** (Visual Anomaly dataset, CC BY 4.0), downloaded from its
official source (the archive linked from the `amazon-science/spot-diff` repository,
with the split CSV from that repository). `scripts/visa_subset.py` streams the
archive once, extracts only the selected categories (default `candle`; the
self-test may add `capsules`), downscales to at most 512 px on the long side, and
caches locally. README records source URL, license, citation and attribution.
MVTec datasets are not used and not offered.

Feature bullets (seed the README and `docs/features/*.md`): Capture and Scoring,
Review Queue, Retraining and Model Versions, Trace, Inspection Archive, Lines,
Dashboard, Bucket Explorer, Settings.

**Primary entity: `InspectionRecord`** (one inspected part). Lifecycle verbs:
- **create**: Capture (`/upload`, also "Capture part" on a line's page).
- **read**: part list per line, Review Queue, Trace page.
- **edit**: record or change the operator verdict (Review Queue and Trace page). The
  image, score rows and heatmaps are immutable evidence; a changed verdict appends a
  new label and the history stays visible.
- **run**: score / re-score a part with the active or a chosen model version (Trace
  page "Re-score", line page "Score unscored parts").
- **delete**: **omitted** from the UI and the API. Justification: the archive exists
  so a quality claim years later can be answered from the original image, score and
  model; a user-facing delete would break that traceability, and deleting inspection
  records is explicitly out of scope. (The generic Bucket Explorer keeps its delete
  for arbitrary objects, unchanged from the kit.)

Supporting entities: `Line` gets create / read / edit in the UI (no delete, same
traceability reason); `ModelVersion` gets create (train) / read / run-equivalent
(activate); no delete or edit (a model version's config defines what its scores
mean).

**Form UX conventions** (in-repo exemplar:
`apps/web/src/components/settings/settings-form.tsx`):
- Selectors, never free text, for finite-value fields on create and edit forms:
  line -> `Select` of existing lines; content type inferred from the file;
  verdict -> `RadioGroup` (Pass / Fail); training source -> `RadioGroup`; image size
  -> segmented control (256 / 224); coreset ratio -> `Select` (0.01 / 0.05 / 0.1);
  model version to re-score with -> `Select` of `ready` versions.
- Create-form safe defaults as placeholder / `FormDescription` guidance only, never
  an autofill button: line id e.g. `line-01`, line name e.g. "Line 1, candle
  station"; serial e.g. `CNDL-000123`; training source "Reference and adjudicated",
  image size 256, coreset ratio 0.1 (described as "fastest on CPU for a small
  set"); verdict operator e.g. your initials.
- Edit forms open pre-filled: line edit (name, description); verdict form pre-selects
  the latest verdict when changing one.

## 5. Doc transforms

- **New** feature docs: `docs/features/capture-and-scoring.md`,
  `docs/features/review-queue.md`, `docs/features/retraining.md`,
  `docs/features/trace.md`, `docs/features/inspection-archive.md`,
  `docs/features/lines.md`.
- **Rewrite**: `docs/features/dashboard.md`, `docs/features/file-upload.md` (becomes
  Capture's upload mechanics or is folded into `capture-and-scoring.md` and deleted),
  `docs/features/file-browser.md` (Bucket Explorer, plus the generic detail
  endpoint).
- **Keep**: `docs/features/settings.md`, `docs/features/_template.md`.
- **Delete**: `docs/features/metadata-extraction.md`.
- **Update by hand**: `PRODUCT.md`, `docs/SECURITY.md` (presigned URL expiry, no
  inspection delete path, serial and line-id validation against key injection),
  `docs/RELIABILITY.md` (training queue, restart behaviour, immutable Parquet
  appends), `docs/verification.md` and `docs/dev-workflows.md` (`pnpm setup:ml`,
  `make test`, `make demo`), README sections for VisA attribution, backbone license,
  Anomalib version and the CPU note (no speed claims).
- `ARCHITECTURE.md`, `README.md`, `AGENTS.md`, `docs/app-workflows.md` and the
  Railway runbook generated regions come from `pnpm gen:docs`; never hand-edited.

**Declared identity: `docs/exec-plans/sample.json`** (authority: the kit's
`scripts/gen/sample.schema.json`). The implementation writes it first, before running
`pnpm gen:docs`, with exactly these values:

```json
{
  "$schema": "../../scripts/gen/sample.schema.json",
  "schema_version": 1,
  "name": "Anomalib Defect Inspection Archive",
  "slug": "anomalib-defect-inspection-archive",
  "package_scope": "@anomalib-defect-inspection-archive",
  "purpose": "An inspection-line archive that stores every part image in Backblaze B2, scores it with Anomalib PatchCore, keeps the heatmap and score with the model version behind it, routes high scores to operator review, and retrains new model versions from adjudicated images read back from B2.",
  "tagline": "Keep every inspected image, heatmap and model version in Backblaze B2, and trace any part back to the evidence.",
  "primary_entity": { "schema": "InspectionRecord", "singular": "inspection record", "plural": "inspection records" },
  "features": [
    { "title": "Capture and Scoring", "route": "/upload", "doc": "docs/features/capture-and-scoring.md", "summary": "store each part image in B2 and score it with Anomalib PatchCore", "workflow_heading": "Capture and Score a Part" },
    { "title": "Review Queue", "route": "/review", "doc": "docs/features/review-queue.md", "summary": "operators record pass or fail on parts above the threshold", "workflow_heading": "Review Flagged Parts" },
    { "title": "Retraining and Model Versions", "route": "/lines", "doc": "docs/features/retraining.md", "summary": "train a new model version from adjudicated images read from B2, stored with its metrics", "workflow_heading": "Retrain the Model" },
    { "title": "Trace", "route": "/trace", "doc": "docs/features/trace.md", "summary": "a part serial returns its image, heatmap, score, verdict and model version", "workflow_heading": "Trace a Part" },
    { "title": "Inspection Archive", "route": "/archive", "doc": "docs/features/inspection-archive.md", "summary": "browse images, heatmaps, scores, labels and models by line and date" },
    { "title": "Lines", "route": "/lines", "doc": "docs/features/lines.md", "summary": "create inspection lines and choose the active model version", "workflow_heading": "Set Up a Line" },
    { "title": "Dashboard", "route": "/", "doc": "docs/features/dashboard.md", "summary": "parts inspected, review backlog, verdicts and archive growth", "workflow_heading": "View Dashboard" },
    { "title": "Bucket Explorer", "route": "/files", "doc": "docs/features/file-browser.md", "summary": "browse, preview and download any object in the bucket", "workflow_heading": "Browse the Bucket" },
    { "title": "Settings", "route": "/settings", "doc": "docs/features/settings.md", "summary": "theme plus labelled demo preference fields", "workflow_heading": "Change Preferences" }
  ],
  "b2_surface": [
    { "operation": "presigned PUT", "why": "the browser uploads a captured part image straight to its line and date key" },
    { "operation": "put_object", "why": "write heatmaps, Parquet score files, verdict labels, model checkpoints, metrics and training-set manifests" },
    { "operation": "head_object", "why": "verify a capture, record ETags in the training-set manifest, and the /health probe" },
    { "operation": "get_object", "why": "fill the local cache Anomalib trains and scores from, and read records and Parquet files" },
    { "operation": "list_objects_v2", "why": "lines, parts, score files, labels, model versions, the archive and the full-bucket explorer" },
    { "operation": "presigned GET", "why": "image, heatmap, Parquet and checkpoint links for review, trace and archive" },
    { "operation": "delete_object", "why": "the generic Bucket Explorer only; no inspection record is ever deleted" }
  ],
  "b2_key_prefix": "lines/",
  "stack": {
    "web": "Next.js 16, React 19, Tailwind v4, shadcn/ui, TanStack Query, Recharts",
    "api": "FastAPI, Python 3.12+, boto3, Pydantic v2, pyarrow, Pillow, Anomalib PatchCore (PyTorch, optional ML extra)",
    "storage": "Backblaze B2 (S3-compatible API)",
    "package_manager": "pnpm workspaces"
  },
  "deployment_targets": ["railway"],
  "env_vars": [
    { "name": "B2_APPLICATION_KEY_ID", "required": true, "secret": true, "note": "B2 application key ID (**keyID** in the B2 console)" },
    { "name": "B2_APPLICATION_KEY", "required": true, "secret": true, "note": "B2 application key (**applicationKey**), shown once at creation" },
    { "name": "B2_BUCKET_NAME", "required": true, "secret": false, "note": "bucket unique name (**Bucket Unique Name** in the B2 console)" },
    { "name": "B2_REGION", "required": true, "secret": false, "note": "the region inside the bucket's **Endpoint** (`s3.<region>.backblazeb2.com`); the S3 endpoint is derived from it" },
    { "name": "B2_PUBLIC_URL_BASE", "required": false, "secret": false, "note": "public object base URL, when the bucket is public" },
    { "name": "NEXT_PUBLIC_API_URL", "required": false, "secret": false, "note": "separate-origin deploys only; Next.js inlines it at build time" },
    { "name": "INSPECTION_DEVICE", "required": false, "secret": false, "note": "auto (default: CUDA, then Apple MPS, then CPU), cpu, cuda or mps" },
    { "name": "INSPECTION_CACHE_DIR", "required": false, "secret": false, "note": "local cache Anomalib reads images from, filled from B2 (default services/api/.cache/inspection)" }
  ],
  "attribution_token": "b2ai-anomalib-inspection-archive",
  "repo": { "org": "backblaze-b2-samples", "name": "anomalib-b2-inspection-archive" },
  "screenshots": []
}
```

If the generator or a check rejects a value (for example the slug derivation), fix
the manifest minimally and record the deviation.

## 6. Rename table

| From (`vibe-coding-starter-kit`) | To |
|---|---|
| Display name `Vibe Coding Starter Kit` | `Anomalib Defect Inspection Archive` |
| slug `vibe-coding-starter-kit` | `anomalib-defect-inspection-archive` |
| snake form `vibe_coding_starter_kit` (if any) | `anomalib_defect_inspection_archive` |
| package scope `@vibe-coding-starter-kit` (`/web`, `/shared`) and root `package.json` name | `@anomalib-defect-inspection-archive`, `anomalib-defect-inspection-archive` |
| attribution token `b2ai-oss-start` (S3 `user_agent_extra` and every `utm_content`) | `b2ai-anomalib-inspection-archive` |
| `APP_NAME` / `APP_DESCRIPTION` in `apps/web/src/lib/app-config.ts` | `Anomalib Defect Inspection Archive` / "Visual inspection archive with Anomalib and Backblaze B2" |
| FastAPI `API_TITLE` (derived from `APP_NAME`) | `Anomalib Defect Inspection Archive` |
| `localStorage` namespace and CORS rule id (derived from slug) | `anomalib-defect-inspection-archive` |
| repo `org/name`, clone URL, deploy links | `backblaze-b2-samples/anomalib-b2-inspection-archive` |
| image tags, workflow slugs, Railway service names | `anomalib-defect-inspection-archive*` |
| UTM content tag | `b2ai-anomalib-inspection-archive` |
| Title-case prose in docs | `Anomalib Defect Inspection Archive` |

## 7. Verification expectation

- **Credential-free gate**: `pnpm run setup` then `pnpm verify` (no ML deps, no B2).
  The build adds unit tests for `service/keys.py` (layout, serial and line-id
  validation, no path traversal), Parquet append and read (new part file per call,
  schema), label history (latest wins, earlier kept), review-queue selection,
  part-status derivation, training-set manifest assembly (pass -> train normal, fail
  -> eval anomalous), model-version state transitions (including `interrupted` on
  restart), the 503-without-ML path, the 409 on duplicate serial, the absence of any
  inspection delete route, and a test that every boto3 client carries
  `user_agent_extra="b2ai-anomalib-inspection-archive"` and both checksum settings
  `when_required`.
- **`make test`** (needs `.env` with a B2 test bucket and `pnpm setup:ml`; CPU
  forced): downloads the VisA subset (one or two categories), uploads it to B2 as a
  simulated inspection line under a run-unique line id (`selftest-<utc-ts>`), creates
  the line through the API, trains model `v1` on CPU from reference images read from
  B2, captures and scores new parts (normal and anomalous) through the API, asserts
  heatmaps and Parquet score files exist in B2 with the model version, asserts parts
  above threshold appear in the review queue, records operator verdicts through the
  API, trains `v2` from the adjudicated set (asserting `training-set.json` lists the
  adjudicated keys with ETags read from B2), activates it, and asserts
  `GET /lines/{line}/parts/{serial}` and `/trace?serial=` return image, heatmap,
  score, verdict and model version. It does not delete what it wrote (inspection
  records are never deleted); the README says to point it at a test bucket.
  Implemented as an opt-in live pytest (`live_tests/test_inspection_flow.py`,
  marker `live`) driven by the FastAPI app, plus the root `Makefile` target.
- **`make demo`**: the same flow against the running dev servers (`pnpm dev`,
  `pnpm wait-ready`), leaving a line with flagged parts in review, then opens
  `/review` in the browser.
- B2 standards checked with `/b2-doctor`: S3 API by default, the custom user agent on
  every client, `B2_*` names, endpoint derived from `B2_REGION`, `B2_PUBLIC_URL_BASE`
  commented in `.env.example`.
- The implementation must actually run `pnpm verify` and, if the ML deps install, a real
  CPU PatchCore train + score on a handful of VisA images (the Anomalib pin is only
  recorded after this works); `make test` runs if `.env` has B2 credentials. Any
  check that could not run is reported as not run, never as passed.

## 8. Deviations recorded during the build

- The root `package.json` name is `anomalib-inspection-archive`, so the
  attribution token `b2ai-anomalib-inspection-archive` equals `b2ai-<package name>`
  as the UTM convention expects. The workspace scope stays
  `@anomalib-defect-inspection-archive`.
- `scripts/gen-docs.mjs` writes infra runbooks only for the declared
  `deployment_targets`, and `scripts/gen-api.mjs` emits enum and literal types, so
  the generators work with `infra/vercel/` removed and with enum-typed models.
- API additions: `CapturePartRequest.reference` (normal or anomalous), exposed in
  Capture as a "Reference part?" selector, so reference images are seeded through
  the API and `service/training.py` can build the reference set from them;
  `PresignCaptureRequest.size_bytes`, signed into the PUT as in the kit's upload;
  `ArchivePage.dates` and `ArchivePage.date` for browsing by date; `source`,
  `note` and `threshold_method` on `ModelVersion`.
- A line's first ready model version is activated automatically; later versions
  need "Activate".
- Checkpoint uploads use a second boto3 client from the same factory (same user
  agent and checksum settings) with a longer read timeout, because checkpoints are
  several MB.
- Checkpoints store the PatchCore memory bank as float16, and evaluation uses the
  same rounding, so the stored threshold matches the stored model.
- The live self-test uses coreset ratio 0.01 and a smaller image set to keep the
  run short; the UI default stays 0.1.
- Pinned versions after a real CPU fit and score on VisA `candle` images (Python
  3.12, macOS arm64): `anomalib==2.7.0`, torch 2.15.0, torchvision 0.29.2,
  lightning 2.6.6, timm 1.0.31. Backbone weights: `timm/wide_resnet50_2.tv2_in1k`
  (BSD-3-Clause per its model card). Linux x86_64 and GPU paths were not run.
