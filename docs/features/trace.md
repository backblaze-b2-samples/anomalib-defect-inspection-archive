<!-- last_verified: 2026-11-16 -->
# Feature: Trace

## Purpose
Given a part serial, return its full record: the original image, every heatmap, every score with the model version and threshold behind it, the verdict history, and the model's metrics, so a quality question can be answered long after the fact.

## Used By
- UI: `/trace` (serial search), `/trace/{lineId}/{serial}` (record); every serial elsewhere links here
- API: `GET /trace?serial=&line_id=`, `GET /lines/{line_id}/parts/{serial}`

## Core Functions
- `apps/web/src/app/trace/page.tsx`, `apps/web/src/app/trace/[lineId]/[serial]/page.tsx`
- `apps/web/src/components/inspection/part-evidence.tsx`: image and heatmap side by side
- `services/api/app/service/trace.py`: `get_trace()`, `search()`

## Inputs
- `serial`: a full serial or its beginning (validated against the serial pattern); optional `line_id`

## Outputs
- `TraceMatch[]` (up to 50): line, serial, capture date, status
- `PartTrace`: the `InspectionRecord` plus `scores` (newest first, each with model version, backbone, Anomalib version, threshold and a presigned heatmap URL), `verdicts` (newest first, with `score_ref`), `model` (the version behind the latest score) and `parquet_keys` (the score files the rows came from)

## Flow
- Search lists `lines/<line>/parts/<serial-prefix>` on each line, then loads matching lines' state for status
- The record page offers a verdict form (pre-selected with the latest verdict) and "Re-score" with a `Select` of ready versions; re-scoring adds a score row and a heatmap for that version and keeps the old ones

## Edge Cases
- Unknown serial: empty match list; unknown part URL: 404
- Serial with path syntax: 400 (never reaches a key)
- Presigned links expire after `PRESIGN_VIEW_EXPIRY_SECONDS` (15 minutes); reloading the page signs new ones

## Verification
- Test files: `services/api/tests/test_inspection_api.py` (`test_each_scoring_call_appends_a_new_parquet_file`, `test_lines_crud_and_trace_search`), `services/api/live_tests/test_inspection_flow.py`
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`

## Related Docs
- [Capture and Scoring](capture-and-scoring.md), [Retraining](retraining.md)
