<!-- last_verified: 2026-11-16 -->
# Architecture

## Components

<!-- gen:begin arch-components -->
An inspection-line archive that stores every part image in Backblaze B2, scores it with Anomalib PatchCore, keeps the heatmap and score with the model version behind it, routes high scores to operator review, and retrains new model versions from adjudicated images read back from B2.

- **apps/web/** — Next.js 16, React 19, Tailwind v4, shadcn/ui, TanStack Query, Recharts
  - Capture and Scoring (`/upload`) — store each part image in B2 and score it with Anomalib PatchCore
  - Review Queue (`/review`) — operators record pass or fail on parts above the threshold
  - Retraining and Model Versions (`/lines`) — train a new model version from adjudicated images read from B2, stored with its metrics
  - Trace (`/trace`) — a part serial returns its image, heatmap, score, verdict and model version
  - Inspection Archive (`/archive`) — browse images, heatmaps, scores, labels and models by line and date
  - Lines (`/lines`) — create inspection lines and choose the active model version
  - Dashboard (`/`) — parts inspected, review backlog, verdicts and archive growth
  - Bucket Explorer (`/files`) — browse, preview and download any object in the bucket
  - Settings (`/settings`) — theme plus labelled demo preference fields
- **services/api/** — FastAPI, Python 3.12+, boto3, Pydantic v2, pyarrow, Pillow, Anomalib PatchCore (PyTorch, optional ML extra)
  - REST API for every operation the frontend consumes, exported to `docs/api/openapi.json`
  - Backblaze B2 (S3-compatible API) access isolated in the `repo/` layer
  - Structured JSON logging with request tracing, plus `/health` and Prometheus `/metrics`
- **packages/shared/** — TypeScript types generated from the API contract by `pnpm gen:api`, consumed by `apps/web/` as a workspace dependency (pnpm workspaces)
<!-- gen:end arch-components -->

## Backend Layering

The API follows a strict layered architecture:

```
types/     Pydantic models — no logic, no imports from other layers
  |
config/    Settings (pydantic-settings) — depends only on types
  |
repo/      Data access and engines (boto3, pyarrow, Pillow, Anomalib) — no business logic
  |
service/   Business logic — calls repo, returns types
  |
runtime/   FastAPI routes — calls service, never repo directly
```

### Layering Rules

1. Dependencies flow downward only: `types` -> `config` -> `repo` -> `service` -> `runtime`
2. No backward imports (e.g., service must not import from runtime)
3. `boto3` only allowed in `repo/` layer; `pyarrow` only in `repo/parquet_scores.py`; the ML
   stack (`torch`, `torchvision`, `anomalib`, `lightning`, `timm`) only in `repo/anomaly_*.py`
   and only inside functions, so the API imports without it
4. All boundary data uses Pydantic models (no raw dicts across layers)
5. Authored Python files under `services/api/app/` stay under 300 lines

### Directory Structure

<!-- gen:begin arch-directory -->
```
services/api/
  main.py                  App entrypoint, middleware, router registration
  app/
    types/                 Pydantic models, and the response-model base
    config/                Settings loaded from environment
    repo/                  B2 S3 client (data access layer)
    service/               Business logic
    runtime/               FastAPI route handlers
  scripts/                 Operational scripts (OpenAPI export, bucket CORS)
  tests/                   pytest tests (structural + integration)
```
<!-- gen:end arch-directory -->

## Boundary Invariants

- **No external SDK leakage**: `boto3` is only imported in `app/repo/`. All other layers interact with B2 through the repo interface (`b2_client.py` builds the one client; `b2_store.py` adds put/get/head/list primitives for the inspection data).
- **Optional ML extra, contained**: Anomalib PatchCore runs in `repo/anomaly_engine.py` (availability, device, pinned backbone weights), `repo/anomaly_train.py` (Folder datamodule + Engine) and `repo/anomaly_infer.py` (scorer, checkpoint load). Without `requirements-ml.txt` the API still boots; scoring and training answer 503 with the install command. `tests/test_structure.py` asserts both the containment and that `import main` does not import torch.
- **Anomalib never touches B2**: every image and checkpoint it reads comes from `repo/local_cache.py`, which fills a local directory from B2 through the app's boto3 client, keyed by object key + ETag. So every B2 request carries the custom user agent, and the cache can be deleted at any time.
- **One key layout**: `service/keys.py` is the only place B2 keys under `lines/` are built, and it validates line ids, serials, versions and dates first.
- **No raw dicts at boundaries**: All data crossing layer boundaries uses typed Pydantic models.
- **No cross-layer mutable state**: Configuration is read-only after init, and no mutable state is shared *between* layers. Intra-layer caches/counters (the listing cache in `repo/list_cache.py`, the B2 connectivity cache in `repo/b2_client.py`, the write-once object memo in `repo/b2_store.py`, the resident scorers in `repo/anomaly_infer.py`, the download counter in `repo/counter.py`, the training queue in `service/train_runner.py`, the rate-limit and metrics state in `runtime/`) are module-local and guarded by a lock. Two background threads exist: the listing cache's stale-while-revalidate refresh, and the single training worker.
- **Validated inputs**: All HTTP inputs validated by FastAPI/Pydantic. File keys reject empty and path-traversal patterns; optional prefix confinement via `ALLOWED_KEY_PREFIX` (off by default; `lines/` confines the by-key routes to this app's data).

## Inspection Data Model

B2 is the only store. An inspection record is not one object but the union of write-once objects under its line, and its status is derived on every read, never stored:

```
lines/<line-id>/line.json                                    Line (name, description, active model)
lines/<line-id>/<date>/images/<serial>.png                   captured image (never overwritten after capture)
lines/<line-id>/<date>/heatmaps/<serial>.<version>.png       heatmap per scoring, one per model version
lines/<line-id>/scores/date=<date>/<utc-ts>-<uuid>.parquet   score rows, one new part file per scoring call
lines/<line-id>/labels/<serial>/<utc-ts>.json                verdict history (latest wins, earlier kept)
lines/<line-id>/parts/<serial>.json                          part index: date, image key, ETag, reference label
lines/<line-id>/models/<version>/version.json                ModelVersion record
lines/<line-id>/models/<version>/training-set.json           every training/eval key + ETag + label
lines/<line-id>/models/<version>/model.ckpt                  PatchCore memory bank + config
lines/<line-id>/models/<version>/metrics.json                threshold, AUROC, F1, counts
```

Status: the latest verdict wins (`passed` / `failed`); otherwise the latest score against its own threshold (`in_review` at or above, `below_threshold` under); otherwise `unscored`. Score Parquet columns: `line_id`, `serial`, `capture_date`, `image_key`, `heatmap_key`, `score`, `threshold`, `above_threshold`, `model_version`, `backbone`, `anomalib_version`, `scored_at`; readers tolerate added columns. Because part index, labels and score files never change once written, `b2_store.get_immutable()` memoizes them in memory; listings are always fresh.

## Deployment

- **Local dev (primary)** — `pnpm dev` runs both services via `concurrently`
  - Web: `localhost:3000`
  - API: `localhost:8000`
  - Scoring and training run in the API process: `pnpm setup:ml` installs the ML extra into `services/api/.venv`. Device is CUDA, then Apple MPS, then CPU (`INSPECTION_DEVICE` overrides); a GPU is optional.
- **Railway** — two services from the same repository: `web` builds from the
  repository root because it consumes `packages/shared`; `api` builds from
  `services/api`. Each service's versioned config sits at its own root —
  `railway.json` and `services/api/railway.json`. The default API image installs
  only the core requirements, so a Railway API serves capture, review, trace and
  the archive and answers 503 for scoring and training until the ML extra is
  added to its build (CPU torch on a service with enough memory). The
  human-approved staging/production contract lives in
  [infra/railway/README.md](infra/railway/README.md).
- **No Vercel target** — PatchCore training and scoring load PyTorch, a
  pretrained CNN backbone and a model checkpoint, which neither fit nor finish
  inside a serverless function, so the starter kit's Vercel deployment was removed.

External provisioning and deployment remain explicit user-approved actions.

## Data Stores

<!-- gen:begin arch-data-stores -->
- **Backblaze B2 (S3-compatible API)** — the only data store; there is no application database
  - Every object this app writes lives under the `lines/` key prefix of one bucket
  - Listing, per-key metadata and presigned URLs all come from the S3 surface below
  - The primary entity is `InspectionRecord`; one inspection record is one object
<!-- gen:end arch-data-stores -->

## External Services

<!-- gen:begin arch-external-services -->
- **Backblaze B2 (S3-compatible API)** — reached only through `services/api/app/repo/`, using:
  - `presigned PUT` — the browser uploads a captured part image straight to its line and date key
  - `put_object` — write heatmaps, Parquet score files, verdict labels, model checkpoints, metrics and training-set manifests
  - `head_object` — verify a capture, record ETags in the training-set manifest, and the /health probe
  - `get_object` — fill the local cache Anomalib trains and scores from, and read records and Parquet files
  - `list_objects_v2` — lines, parts, score files, labels, model versions, the archive and the full-bucket explorer
  - `presigned GET` — image, heatmap, Parquet and checkpoint links for review, trace and archive
  - `delete_object` — the generic Bucket Explorer only; no inspection record is ever deleted
<!-- gen:end arch-external-services -->

## Trust Boundaries

See [docs/SECURITY.md](docs/SECURITY.md) for full security documentation.

- **Frontend -> API** — CORS-restricted to configured origins. `CORSMiddleware` is registered LAST in `main.py` (outermost) so it wraps **every** response, including uncaught-exception 500s. See [docs/RELIABILITY.md](docs/RELIABILITY.md#error-handling). A per-IP rate-limit middleware sits inner to CORS; see [docs/SECURITY.md](docs/SECURITY.md#rate-limiting).
- **API -> B2** — authenticated via application keys, signature v4, custom user agent `b2ai-anomalib-inspection-archive`
- **Client -> B2** — presigned PUT for captures (key, size and type signed), presigned GET (inline, 15-minute expiry) for images, heatmaps, Parquet and checkpoints
- **API -> Hugging Face Hub** — the first training or scoring run downloads the public backbone weights anonymously (no token)

## Data Flows

- **Capture**: Browser -> `POST /lines/{line}/parts/presign` (API checks line + unused serial, signs a PUT for `lines/<line>/<date>/images/<serial>.png`) -> Browser PUTs bytes **directly to B2** -> `POST /lines/{line}/parts` (API reads the image back, validates, converts JPEG to PNG, writes the part index) -> scoring
- **Score**: API fetches the checkpoint and image from B2 into the local cache -> PatchCore (raw score + anomaly map) -> heatmap PNG `put_object` -> one new Parquet part file `put_object`
- **Review**: `GET /review-queue` derives in-review parts from scores and labels -> `PUT .../verdict` appends a label object
- **Train**: `POST /lines/{line}/models` lists reference + adjudicated parts, heads each image for its ETag, writes `training-set.json` and a `queued` record -> the training worker fills the cache from B2, runs Anomalib `Folder` + `Engine.fit`, scores the eval split, writes `model.ckpt`, `metrics.json` and the `ready` record
- **Trace**: `GET /trace?serial=` lists `parts/<serial-prefix>` per line -> `GET /lines/{line}/parts/{serial}` joins part index, every score row, every label and the model record
- **Bucket Explorer** (unchanged from the kit): list, download, preview and delete any object through `/files*`

## Observability

- Structured JSON logging on all requests with `request_id`
- Request timing middleware (logs duration per request; also the catch-all that converts uncaught exceptions to a typed JSON 500)
- `/metrics` endpoint (Prometheus format: request count, latency, upload count)
- Training and scoring log the device, memory-bank size and the Parquet key written
- `/health` endpoint (B2 connectivity check)

## API Contract

<!-- gen:begin arch-api-contract -->
- Checked-in OpenAPI artifact: `docs/api/openapi.json`
- Export / check: `pnpm contract:export` / `pnpm contract:check`
- Generate the client seam from it: `pnpm gen:api` (drift gate: `pnpm gen:check`)
- FastAPI freshness test: `services/api/tests/test_openapi_contract.py`
- Frontend route drift test: `apps/web/src/lib/api-contract.test.ts`

The FastAPI routers and Pydantic models are the single source of truth. The
frontend's `API_CLIENT_ROUTES` registry, the `qk` query-key factory and the
shared TypeScript types are **generated** from the exported artifact by
`pnpm gen:api`, so the client cannot drift from the backend — there is no
hand-written copy left to disagree. The two contract tests are kept as a
belt-and-braces check that the generated files and the committed artifact are
still in step.

| Route | Returns | Generated client route |
| --- | --- | --- |
| `DELETE /files-by-key` | `DeleteFileResponse` | `fileByKeyDelete` |
| `DELETE /files/{key}` | `DeleteFileResponse` | `legacyFileDelete` |
| `GET /archive` | `ArchivePage` | `archive` |
| `GET /engine` | `EngineStatus` | `engine` |
| `GET /files` | `FileMetadata[]` | `files` |
| `GET /files-by-key/detail` | `FileMetadataDetail` | `fileByKeyDetail` |
| `GET /files-by-key/download` | `FileUrlResponse` | `fileByKeyDownload` |
| `GET /files-by-key/metadata` | `FileMetadata` | `fileByKeyMetadata` |
| `GET /files-by-key/preview` | `FileUrlResponse` | `fileByKeyPreview` |
| `GET /files/{key}` | `FileMetadata` | `legacyFileMetadata` |
| `GET /files/{key}/download` | `FileUrlResponse` | `legacyFileDownload` |
| `GET /files/{key}/preview` | `FileUrlResponse` | `legacyFilePreview` |
| `GET /files/stats` | `UploadStats` | `fileStats` |
| `GET /files/stats/activity` | `DailyUploadCount[]` | `uploadActivity` |
| `GET /health` | `HealthStatus` | `health` |
| `GET /inspection/stats` | `InspectionStats` | `inspectionStats` |
| `GET /inspection/stats/progress` | `StatsProgress` | `inspectionStatsProgress` |
| `GET /lines` | `Line[]` | `lines` |
| `GET /lines/{line_id}` | `LineDetail` | `lineDetail` |
| `GET /lines/{line_id}/models` | `ModelVersion[]` | `models` |
| `GET /lines/{line_id}/models/{version}` | `ModelVersionDetail` | `modelDetail` |
| `GET /lines/{line_id}/parts` | `InspectionPage` | `parts` |
| `GET /lines/{line_id}/parts/{serial}` | `PartTrace` | `partTrace` |
| `GET /lines/{line_id}/score-unscored` | `ScoreJob` | `scoreJob` |
| `GET /metrics` | — | _server-only_ |
| `GET /review-queue` | `ReviewItem[]` | `reviewQueue` |
| `GET /trace` | `TraceMatch[]` | `traceSearch` |
| `PATCH /lines/{line_id}` | `Line` | `lineUpdate` |
| `POST /lines` | `Line` | `lineCreate` |
| `POST /lines/{line_id}/models` | `ModelVersion` | `modelTrain` |
| `POST /lines/{line_id}/models/{version}/activate` | `Line` | `modelActivate` |
| `POST /lines/{line_id}/parts` | `InspectionRecord` | `partCapture` |
| `POST /lines/{line_id}/parts/{serial}/score` | `InspectionRecord` | `partScore` |
| `POST /lines/{line_id}/parts/presign` | `PresignCaptureResponse` | `partPresign` |
| `POST /lines/{line_id}/score-unscored` | `ScoreJob` | `scoreUnscoredStart` |
| `POST /upload/presign` | `PresignUploadResponse` | `uploadPresign` |
| `POST /upload/verify` | `FileUploadResponse` | `uploadVerify` |
| `PUT /lines/{line_id}/parts/{serial}/verdict` | `InspectionRecord` | `partVerdict` |
<!-- gen:end arch-api-contract -->

## Canonical Files

<!-- gen:begin arch-canonical-files -->
Hand-written — this is the file to edit:

- Layered API handler: `services/api/app/runtime/`
- Service orchestration: `services/api/app/service/`
- B2 data access (repo layer): `services/api/app/repo/b2_client.py`
- Pydantic models: `services/api/app/types/` (`base.py` carries the response-model config)
- Config (pydantic-settings): `services/api/app/config/settings.py`
- Structural tests: `services/api/tests/test_structure.py`
- OpenAPI exporter: `services/api/scripts/export_openapi.py`
- Frontend API client — error policy, transport, fallback: `apps/web/src/lib/api-client.ts`
- Frontend data layer — caching, invalidation, polling: `apps/web/src/lib/queries.ts`
- Shared type barrel: `packages/shared/src/types.ts`
- Generator policy: `scripts/gen/api-gen.config.json`
- Sample manifest behind the generated docs: `docs/exec-plans/sample.json`

Generated — **never hand-edit**; change the source and re-run the command:

- `docs/api/openapi.json` — `pnpm contract:export` (source: the routers and models)
- `packages/shared/src/generated/api-types.ts` — `pnpm gen:api`
- `apps/web/src/lib/generated/api-routes.ts` — `pnpm gen:api`
- `apps/web/src/lib/generated/query-keys.ts` — `pnpm gen:api`
- The marker-delimited regions of this file, `AGENTS.md`, `README.md` and the 1 `infra/` runbooks — `pnpm gen:docs`
<!-- gen:end arch-canonical-files -->

## Core Features

<!-- gen:begin arch-core-features -->
- [Capture and Scoring](docs/features/capture-and-scoring.md) — store each part image in B2 and score it with Anomalib PatchCore
- [Review Queue](docs/features/review-queue.md) — operators record pass or fail on parts above the threshold
- [Retraining and Model Versions](docs/features/retraining.md) — train a new model version from adjudicated images read from B2, stored with its metrics
- [Trace](docs/features/trace.md) — a part serial returns its image, heatmap, score, verdict and model version
- [Inspection Archive](docs/features/inspection-archive.md) — browse images, heatmaps, scores, labels and models by line and date
- [Lines](docs/features/lines.md) — create inspection lines and choose the active model version
- [Dashboard](docs/features/dashboard.md) — parts inspected, review backlog, verdicts and archive growth
- [Bucket Explorer](docs/features/file-browser.md) — browse, preview and download any object in the bucket
- [Settings](docs/features/settings.md) — theme plus labelled demo preference fields
<!-- gen:end arch-core-features -->

## References

<!-- gen:begin arch-references -->
- [docs/SECURITY.md](docs/SECURITY.md) — security principles and implementation
- [docs/RELIABILITY.md](docs/RELIABILITY.md) — reliability expectations
- [AGENTS.md](AGENTS.md) — architectural invariants and agent instructions
- [infra/railway/README.md](infra/railway/README.md) — Railway delivery contract
<!-- gen:end arch-references -->
