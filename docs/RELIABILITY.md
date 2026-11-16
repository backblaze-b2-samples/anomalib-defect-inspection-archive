<!-- last_verified: 2026-11-16 -->
# Reliability

Reliability expectations and practices for this project.

## Health Checks

- `GET /health` verifies B2 connectivity and returns `healthy` or `degraded`
- Health endpoint is always available, even when B2 is down
- The B2 client bounds connection attempts to 5 seconds, socket reads to 30
  seconds, and standard retries to 3 total attempts. Normal tests mock this
  boundary and deny network access; real connectivity is opt-in through
  `RUN_LIVE_B2_TESTS=1 pnpm test:live:b2`.

## Error Handling

- HTTP handlers return structured error responses with appropriate status codes
- External service failures (B2) are caught and surfaced as 502 (inspection routes) or 500 responses
- A missing ML extra is a 503 with the install command, never a 500; capture still stores the image
- No unhandled exceptions leak stack traces to clients
- Uncaught exceptions are converted to a typed JSON 500 (`{"detail": "Internal server error"}`, modeled by `app.types.ErrorResponse`) by the catch-all in `timing_middleware`
- **Error responses carry CORS headers.** `CORSMiddleware` is registered LAST in `main.py` so it is the outermost middleware and wraps every response — including uncaught-exception 500s produced by the inner catch-all. This is intentional and load-bearing: if a 500 shipped without `Access-Control-Allow-Origin`, the browser would block it and the frontend would surface only an opaque "network error", hiding the real server bug. Regression-guarded by `tests/test_error_handling.py::test_unhandled_exception_500_carries_cors_headers`.

## Training Queue and Restarts

- Training runs on **one background worker thread** (`service/train_runner.py`), FIFO, **one job at a time**, so two heavy PyTorch fits never compete for the same CPU or GPU. A request to train returns at once with the version `queued`; the UI polls.
- Job status lives in the `ModelVersion` record in B2 (`version.json`), not in memory: `queued` -> `training` -> `ready` or `failed`. The worker claims the job id before the `queued` record is written, so a fresh job is never misread.
- **Restart behaviour**: the queue is in-process. If the API stops while a version is `queued` or `training`, the next read of that record finds no live job for it and marks it `interrupted` (and saves that), so nothing is ever stuck in `training`. Train again to replace it. Images, the manifest and earlier versions are untouched.
- Training and scoring may run at the same time (scoring a capture while a fit runs); resident scorers are capped at two model versions to bound memory.
- A fit that fails on Apple MPS is retried once on CPU; scoring falls back to CPU the same way. `INSPECTION_DEVICE=cpu` forces CPU everywhere.

## Immutable Appends on Object Storage

- B2 objects are written whole, so nothing here is "updated": each scoring call writes **one new Parquet part file** (`scores/date=<date>/<utc-ts>-<uuid>.parquet`), each verdict a **new label object**, each heatmap a **new key per model version**. Concurrent writers never race on one object, and a crash mid-call leaves at most one orphaned heatmap or score file, never a corrupted table.
- Readers list the line's part files and concatenate them; a reader that meets a newer column ignores it.
- Part index, label and score objects are memoized in memory after the first read (they never change); listings are never cached for inspection data, so a new score or verdict is visible on the next request.
- The local cache (`INSPECTION_CACHE_DIR`) is keyed by object key + ETag and is disposable; a missing entry is re-downloaded from B2.

## Logging

- Structured JSON logging via Python stdlib
- Every request gets a `request_id` for tracing
- Log levels: ERROR for failures, WARNING for degraded state, INFO for requests

## Observability

- Request timing middleware logs duration for every request
- `/metrics` endpoint exposes basic Prometheus-format counters
- Upload success/failure counts tracked

## Stateful Counters — durability caveats

The download counter and the `/metrics` counters are **in-process, per replica**. Consequences to plan for before scaling:

- **Download counter** (`app/repo/counter.py`) persists to a JSON file at `DOWNLOAD_COUNT_FILE` (default `.data/download_count.json`, resolved from the repo root — deliberately outside `services/api/`, which `uvicorn --reload` watches, so a download never writes into the dev reloader's watch tree). On an ephemeral filesystem (Railway without a mounted volume) it **resets to 0 on every redeploy**. With multiple replicas each keeps its own file/count. For durable, shared counts: mount a persistent volume or swap the adapter for Redis/DB.
- **`/metrics` counters** live in process memory and reset on restart. Behind a load balancer, each replica reports only its own slice — scrape with an instance label and aggregate, or push to a shared collector.

## Rate Limiting

- Per-IP fixed-window limiter (`app/runtime/ratelimit.py`); `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_WRITE_PER_MINUTE` are the budgets. Rejected requests get `429` with a `Retry-After` header.
- Counters are in-process per replica; horizontal scaling needs a shared store (e.g. Redis) for a global limit.

## Graceful Degradation

- File listing returns empty list (not error) when B2 has no objects
- Metadata extraction failures don't block upload (return partial metadata)
- Frontend shows skeleton states while loading, error states on failure — and, for the bucket-listing waits that can run for seconds, on-screen copy that escalates instead of silent skeletons (`lib/loading-progress.ts`)
- A full bucket listing (needed by both `/files` and `/files/stats`) is cached, warmed at startup, and served **stale-while-revalidate**: after the first scan, an expired entry is returned immediately while a background thread refreshes it, so a slow or failing B2 list never turns into a user-visible 8-20s wait. `LIST_CACHE_TTL_SECONDS` (default 300) bounds staleness for changes made outside this app; the app's own uploads and deletes invalidate the cache outright. A failed background refresh keeps serving the previous snapshot and is logged
- `WARM_LIST_CACHE_ON_STARTUP=false` skips the startup scan (offline dev, or when startup must not touch B2)

## Deployment

- The API contract checks `/health`; it confirms process readiness, but the
  response is still HTTP 200 when B2 is degraded. Promotion therefore also
  requires `b2_connected: true` and an affected-flow smoke test.
- Railway uses a persistent service model, which the training queue needs. The
  default API build installs only `requirements.lock`, so scoring and training
  answer 503 there until the ML extra is added to the build.
- See [infra/railway/README.md](../infra/railway/README.md) for the versioned
  configuration, approval, rollback, and cleanup procedure.
- Environment-specific configuration uses platform variables; no environment
  values are committed to the repository.
