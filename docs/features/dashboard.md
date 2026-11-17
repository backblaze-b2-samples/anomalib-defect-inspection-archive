<!-- last_verified: 2026-11-16 -->
# Feature: Dashboard

## Purpose
Answer "how is inspection going" at a glance: parts inspected, parts above threshold, the review backlog, verdict counts, model versions, how much the archive holds in B2 by kind, captures per day and the most recent flagged parts.

## Used By
- UI: `/` page
- API: `GET /inspection/stats`, `GET /inspection/stats/progress`

## Core Functions
- `apps/web/src/components/dashboard/inspection-overview.tsx`: six stat cards, parts-per-day chart, archive bytes by kind, recent above-threshold table
- `apps/web/src/components/inspection/parts-table.tsx`: the shared record table (serial links to Trace)
- `apps/web/src/lib/queries.ts`: `useInspectionStats()`, `useInspectionStatsProgress()`
- `services/api/app/runtime/stats.py`: `GET /inspection/stats`, `GET /inspection/stats/progress`
- `services/api/app/service/stats.py`: `inspection_stats()`, `progress()`, `warm_in_background()`, `bytes_by_kind()`, `parts_per_day()`
- `services/api/app/service/state.py`: per-line state and status derivation

## Inputs
- none

## Outputs
- `StatsProgress`: `running`, `lines_done`, `lines_total` of the running (or last) computation
- `InspectionStats`: `parts_inspected`, `above_threshold` (parts whose latest score is at or above its threshold, adjudicated or not), `review_backlog` (status `in_review`), `passed`, `failed`, `model_versions`, `bytes_by_kind` (images, heatmaps, scores, labels, models), `parts_per_day` (14 UTC days), `recent_above_threshold` (8 newest flagged records)

## Flow
- One paginated `list_objects_v2` pass over `lines/` gives the line ids (from `line.json` keys), byte totals by kind (from the key layout in `service/keys.py`), captures per day (from image keys), the model-version count, and every line's part, score and label keys: no per-line listing
- Each line's state (part index, Parquet score rows, labels) is built from that listing to count statuses and pick recent flagged parts. Those objects are write-once, so each is read from B2 once per API process (`b2_store.get_immutable`); after that a dashboard load costs the one listing
- API startup reads them once on a background thread (unless the `warm_list_cache_on_startup` setting is off), so the first dashboard view is usually warm and startup never waits on B2
- Lines processed so far are exposed at `GET /inspection/stats/progress` while a computation runs
- Writes anywhere in the app invalidate the `lines` query-key parent, which this query sits under

## Edge Cases
- No lines yet: all zeros, empty chart days, empty flagged table
- B2 unreachable: inline error state with Retry (never zeros pretending to be data)
- Stats not back after 90 seconds: the request is abandoned with a "took longer than 90s" error and Retry

## UX States
- Loading: on-screen loading notice plus skeleton cards; while the server is still reading lines, a determinate bar with "line k of N" (polled every second)
- Empty: zero counts and an empty-state row for flagged parts
- Error: `ErrorState` with Retry

## Verification
- Test files: `services/api/tests/test_inspection_api.py` (`test_archive_and_stats`, `test_stats_read_one_listing_and_report_line_progress`), `apps/web/src/lib/api-client.test.ts` (`getInspectionStats` timeout)
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`

## Related Docs
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [App Workflows](../app-workflows.md)
