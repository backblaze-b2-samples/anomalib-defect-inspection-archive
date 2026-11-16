<!-- last_verified: 2026-11-16 -->
# Feature: Dashboard

## Purpose
Answer "how is inspection going" at a glance: parts inspected, parts above threshold, the review backlog, verdict counts, model versions, how much the archive holds in B2 by kind, captures per day and the most recent flagged parts.

## Used By
- UI: `/` page
- API: `GET /inspection/stats`

## Core Functions
- `apps/web/src/components/dashboard/inspection-overview.tsx`: six stat cards, parts-per-day chart, archive bytes by kind, recent above-threshold table
- `apps/web/src/components/inspection/parts-table.tsx`: the shared record table (serial links to Trace)
- `apps/web/src/lib/queries.ts`: `useInspectionStats()`
- `services/api/app/runtime/stats.py`: `GET /inspection/stats`
- `services/api/app/service/stats.py`: `inspection_stats()`, `bytes_by_kind()`, `parts_per_day()`
- `services/api/app/service/state.py`: per-line state and status derivation

## Inputs
- none

## Outputs
- `InspectionStats`: `parts_inspected`, `above_threshold` (parts whose latest score is at or above its threshold, adjudicated or not), `review_backlog` (status `in_review`), `passed`, `failed`, `model_versions`, `bytes_by_kind` (images, heatmaps, scores, labels, models), `parts_per_day` (14 UTC days), `recent_above_threshold` (8 newest flagged records)

## Flow
- One `list_objects_v2` pass over `lines/` gives byte totals by kind (from the key layout in `service/keys.py`), captures per day (from image keys) and the model-version count
- Each line's state (part index, Parquet score rows, labels) is loaded to count statuses and pick recent flagged parts
- Writes anywhere in the app invalidate the `lines` query-key parent, which this query sits under

## Edge Cases
- No lines yet: all zeros, empty chart days, empty flagged table
- B2 unreachable: inline error state with Retry (never zeros pretending to be data)

## UX States
- Loading: on-screen loading notice plus skeleton cards
- Empty: zero counts and an empty-state row for flagged parts
- Error: `ErrorState` with Retry

## Verification
- Test files: `services/api/tests/test_inspection_api.py` (`test_archive_and_stats`)
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`

## Related Docs
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [App Workflows](../app-workflows.md)
