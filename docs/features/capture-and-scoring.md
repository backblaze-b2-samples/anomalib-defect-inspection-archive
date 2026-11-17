<!-- last_verified: 2026-11-16 -->
# Feature: Capture and Scoring

## Purpose
Store each inspected part image in B2 under its line and capture date, score it with the line's active Anomalib PatchCore model, and keep the heatmap and a score row (with the model version and threshold) as permanent evidence.

## Used By
- UI: `/upload` (Capture), "Capture part" on a line page, "Re-score" on the Trace page, "Score unscored parts" on a line page
- API: `POST /lines/{line_id}/parts/presign`, `POST /lines/{line_id}/parts`, `POST /lines/{line_id}/parts/{serial}/score`, `POST|GET /lines/{line_id}/score-unscored` (server-side bulk scoring job and its progress)

## Core Functions
- `apps/web/src/components/upload/capture-form.tsx`: line `Select`, serial input, reference `Select`, dropzone (PNG/JPEG; one image for a production part, one or more for reference images), progress, last-capture evidence
- `apps/web/src/lib/api-client.ts`: `capturePart()` (presign, XHR `putToStorage()`, register), `scorePart()`
- `services/api/app/service/inspection.py`: `presign_capture()`, `capture_part()`, `score_part()`
- `services/api/app/service/scoring.py`: `score_parts()`: cache fill, PatchCore, heatmap, Parquet part file
- `services/api/app/service/score_jobs.py`: `start()`, `get()`: one in-process job per line that scores every unscored part, one scoring call per part, on the shared ML worker thread
- `services/api/app/repo/anomaly_infer.py`: `Scorer`, `load_scorer()`, `cached_scorer()` (lazy ML imports)
- `services/api/app/repo/local_cache.py`: `fetch()` fills the local cache from B2 by key + ETag
- `services/api/app/repo/heatmap.py`: `to_png()`, `render_overlay()`
- `services/api/app/repo/parquet_scores.py`: `encode_rows()`, `decode_rows()`

## Inputs
- `PresignCaptureRequest`: `serial` (`^[A-Za-z0-9._-]{1,64}$`), `content_type` (`image/png` or `image/jpeg`), `size_bytes` (signed into the URL)
- `CapturePartRequest`: `serial`, `image_key` (must be the presigned key), `score_now` (default true), `reference` (`normal` | `anomalous` | null)
- `ScorePartRequest`: `model_version` (default: the line's active version)

## Outputs
- `InspectionRecord`: status, latest score, threshold, model version, heatmap key, verdict, presigned `image_url` / `heatmap_url`
- B2 writes: `lines/<line>/<date>/images/<serial>.png`, `lines/<line>/parts/<serial>.json`, `lines/<line>/<date>/heatmaps/<serial>.<version>.png`, one `lines/<line>/scores/date=<date>/<utc-ts>-<uuid>.parquet` per scoring call

## Flow
- Presign: the line must exist and the serial must be unused on it (409 otherwise). The key is minted by the API for today's UTC date; size and content type are signed into the PUT
- The browser PUTs the bytes straight to B2
- Register: the key must parse back to the same line and serial (and today's or yesterday's date). The image is read from B2, validated by magic bytes and decoded; a JPEG is re-encoded to PNG under the same key, once, before the part exists. The part index object is written. The response is built from the part just written (and its new score rows, if scored): a new serial has no other scores or verdicts, so the line is not listed and read again
- If `score_now` and the line has an active model, scoring runs. Without the ML extra, or without a ready model, the part is stored as `unscored` and the response still succeeds
- Scoring: the checkpoint and image are fetched into the local cache from B2 through the app's boto3 client; PatchCore returns a raw image score and an anomaly map; the heatmap is rendered on a fixed colour scale (full red at 1.5x the version's threshold) and written per model version, so re-scoring keeps earlier heatmaps; one Parquet part file with this call's rows is written
- `above_threshold` is `score >= threshold`; a production part whose latest score is above threshold and has no verdict is `in_review`; a scored reference image is `reference` and never enters review

## Edge Cases
- Duplicate serial on the same line: 409 at presign and at register
- Key not from the presign (other line, other serial, stale date): 400
- Not a PNG/JPEG, or undecodable: 415; larger than `CAPTURE_MAX_BYTES` (20 MB): 413
- Line has no model yet: stored `unscored`; the line's first ready model starts a server-side job that scores every unscored part. Later, "Score N unscored part(s)" on the line page starts the same job (409 without an active model)
- Bulk scoring job: production parts are scored before reference images (they are what an operator waits on). Progress lives in the API process, so leaving or reloading the page does not stop it; an API restart loses only the progress view (parts stay `unscored` in B2 and can be scored again)
- ML extra missing: `POST .../score` answers 503 with the `pnpm setup:ml` hint; capture still stores the image
- Apple MPS op failure: scoring falls back to CPU and logs it

## UX States
- Engine notice when the ML extra is missing
- Reference batch: with "Reference image" set, several files can be dropped; the serial becomes a prefix and the images get `<prefix>-001`, `-002`, ... and upload one after another through the same presign + register flow, with "Reference image k of N" text, a determinate bar of images stored (exposes `aria-valuenow`) and a summary of any failures. Until a prefix is typed, it defaults to `<LINE>-GOOD-<MMDD-HHMM>` (or `-DEFECT-`), stamped when the images are chosen so two batches never collide
- `/upload?line=<line>&reference=normal` opens with that line and "known-good" preselected; the line shows by id at once, before the line list loads
- A disabled Capture button says why next to it (no line, no serial, invalid serial, no image)
- Upload progress bar (exposes `aria-valuenow`), then a spinner naming the stage ("Scoring with PatchCore vN", or "Registering the part" when the line has no model; the button never claims scoring without a model)
- Last capture card shows image, heatmap, status badge, score vs threshold and the model version, with "Open in review queue" (in review; pre-selects this part) and "View trace" links. Evidence images load eagerly, reset when their URL changes, and retry a few times on an error before showing "Could not load image"; an unscored result keeps a "Train the first model" link (the focused Train form, or reference capture while known-good references are missing)
- Line page: a "no model yet" callout with "Train the first model"; a callout to score unscored parts; while a job runs, a spinner with "Scoring part k of N with vN", a progress bar and the elapsed time
- Images show a pulsing placeholder until loaded and load lazily

## Verification
- Test files: `services/api/tests/test_inspection_api.py`, `services/api/tests/test_inspection_logic.py`, `services/api/tests/test_inspection_keys.py`, `services/api/live_tests/test_inspection_flow.py`
- Required cases: capture without a model, capture and score with heatmap + Parquet, new Parquet file per scoring call, JPEG stored as PNG, duplicate serial 409, foreign key 400, 503 without ML, server-side bulk scoring with progress, bulk scoring 409 without a model, first ready model scores pending parts
- Focused verify command: `pnpm test:api`; real PatchCore on CPU: `make test`
- Default pre-PR verify command: `pnpm verify`

## Related Docs
- [Retraining](retraining.md), [Review Queue](review-queue.md), [Trace](trace.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
