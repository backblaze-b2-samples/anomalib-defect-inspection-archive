<!-- last_verified: 2026-11-16 -->
# Feature: Review Queue

## Purpose
Route parts the model flags to an operator, who records a pass or fail verdict that is kept in B2 with a reference to the exact score reviewed.

## Used By
- UI: `/review` (optionally `?line=<line-id>`), the verdict panel on the Trace page
- API: `GET /review-queue`, `PUT /lines/{line_id}/parts/{serial}/verdict`

## Core Functions
- `apps/web/src/components/inspection/review-queue.tsx`: line filter, oldest-first list, verdict panel
- `apps/web/src/components/inspection/verdict-form.tsx`: `RadioGroup` (Pass / Fail), operator, note; pre-selects the latest verdict when changing one
- `services/api/app/service/review.py`: `select_for_review()`, `review_queue()`
- `services/api/app/service/inspection.py`: `record_verdict()`
- `services/api/app/service/state.py`: `derive_status()`

## Inputs
- `GET /review-queue?line_id=&limit=` (limit 1-500, default 100)
- `VerdictRequest`: `verdict` (`pass` | `fail`), `operator` (1-64 chars), `note` (up to 500)

## Outputs
- `ReviewItem[]`: in-review records, oldest capture first
- B2 write: `lines/<line>/labels/<serial>/<utc-ts>.json` with `serial`, `line_id`, `verdict`, `operator`, `note`, `score_ref` (`<scored_at>@<model_version>`), `recorded_at`

## Flow
- A part is in review when its latest score is at or above that score's threshold and it has no verdict
- Reference images (captured as known-good or known-defective) are already labelled: once scored they read as status `reference`, never `in_review`, so they stay out of the queue, the line's "In review" count and the dashboard backlog. Their score stays on the record and the Trace page
- Recording a verdict appends a new label object; the latest one wins, earlier ones stay and appear on the Trace page
- A `pass` verdict makes the part a normal training image for the next model version; a `fail` adds it to the evaluation split as anomalous (see [Retraining](retraining.md))

## Edge Cases
- Verdict on a part that was never scored or scored below threshold: allowed (from Trace); `score_ref` is null when unscored
- Changing a verdict: a new label, never an overwrite
- Verdict on a reference image (from Trace): allowed, with a note that it replaces the reference label in the next training run, shown as a warning when the verdict contradicts the label
- Re-score below threshold after a flag: the part leaves the queue without a verdict

## UX States
- Empty: "Nothing to review", with "Train a new version from verdicts" (the line's Models page, when a line is selected) and "Capture part"
- `/review?line=<line>&serial=<serial>` pre-selects that part (the capture card's "Open in review queue" link); otherwise the oldest part is selected
- Loading: skeleton; Error: `ErrorState` with Retry
- After a verdict the part leaves the list at once (cache update), then the queue is re-read from B2
- The Operator field is remembered per browser (`localStorage`, guarded: blocked storage just means an empty field) and prefilled for every queued part
- Submitting without a verdict says "Choose Pass or Fail."

## Verification
- Test files: `services/api/tests/test_inspection_logic.py` (`test_review_queue_selects_unadjudicated_above_threshold_oldest_first`, `test_status_derivation_latest_verdict_then_latest_score`, `test_reference_parts_are_labelled_not_reviewed`), `services/api/tests/test_inspection_api.py` (`test_scored_reference_stays_out_of_the_review_queue`), `apps/web/src/lib/inspection-format.test.ts` (`pickReviewItem`), `services/api/tests/test_inspection_api.py` (`test_verdict_history_latest_wins_and_earlier_kept`)
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`

## Related Docs
- [Capture and Scoring](capture-and-scoring.md), [Trace](trace.md)
