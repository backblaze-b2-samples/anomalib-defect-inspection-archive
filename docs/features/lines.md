<!-- last_verified: 2026-11-16 -->
# Feature: Lines

## Purpose
An inspection line is the container for parts, scores, verdicts and model versions, with one active model version that scores new captures.

## Used By
- UI: `/lines` (list, "New line"), `/lines/{lineId}` (counts, score distribution, today's parts with status filter, "Edit line", links to Capture, Review, Models, Archive)
- API: `GET/POST /lines`, `GET/PATCH /lines/{line_id}`

## Core Functions
- `apps/web/src/components/inspection/line-form.tsx`: create (placeholder guidance) and edit (pre-filled) dialog
- `apps/web/src/components/inspection/score-histogram.tsx`: binned latest scores with the active threshold
- `services/api/app/service/lines.py`: `create_line()`, `update_line()`, `set_active_model()`, `line_detail()`
- `services/api/app/service/model_versions.py`: `line_detail()` (adds model count and active threshold)

## Inputs
- `CreateLineRequest`: `line_id` (`^[a-z0-9][a-z0-9-]{1,40}$`), `name`, `description`
- `UpdateLineRequest`: `name`, `description`. The active model changes only through `/activate`

## Outputs
- `Line` stored at `lines/<line-id>/line.json`
- `LineDetail`: the line plus part counts by status, model count and a `ScoreSummary` (latest score per part, up to 500, plus the active threshold)

## Edge Cases
- Duplicate line id: 409; invalid id: 422
- No delete: a line holds the evidence behind every result recorded on it

## Verification
- Test files: `services/api/tests/test_inspection_api.py` (`test_lines_crud_and_trace_search`)
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`

## Related Docs
- [Retraining](retraining.md), [Inspection Archive](inspection-archive.md)
