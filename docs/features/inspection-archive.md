<!-- last_verified: 2026-11-16 -->
# Feature: Inspection Archive

## Purpose
Browse what the inspection pipeline has written under `lines/` by line, capture date and kind: part images paired with their heatmaps, plus each line's Parquet score files, verdict labels and model files. It is the sample-specific, scoped view; the [Bucket Explorer](file-browser.md) stays the generic full-bucket view.

## Used By
- UI: `/archive` (optionally `?line=<line-id>`)
- API: `GET /archive?line_id=&date=&kind=&cursor=`

## Core Functions
- `apps/web/src/components/inspection/archive-browser.tsx`: line `Select`, capture date `Select`, kind tabs, paired grid, object table, next page
- `services/api/app/service/archive.py`: `capture_dates()`, `browse()`
- `services/api/app/service/keys.py`: `archive_prefix()`, `kind_of()`

## Inputs
- `line_id` (defaults to the first line), `date` (images and heatmaps only; defaults to the newest capture date), `kind` (`images` default, `heatmaps`, `scores`, `labels`, `models`), `cursor` (B2 continuation token)

## Outputs
- `ArchivePage`: up to 60 `ArchiveItem`s (key, kind, size, last modified, presigned inline URL), `next_cursor`, `dates` (capture dates of the line, newest first), `date` (the date shown)

## Flow
- Dates come from the line's `YYYY-MM-DD/` sub-prefixes; each kind maps to one prefix, so a page is one `list_objects_v2` call
- The grid pairs each image with the heatmap of the same serial (the newest version listed)

## Edge Cases
- No lines or no captures: empty page with an empty state
- No line chosen: the first line (by id) is selected and shown in the Line selector
- Image and heatmap tiles show a pulsing placeholder until each image loads, load lazily, and say so when an image fails
- Read-only: nothing in this view deletes or overwrites

## Verification
- Test files: `services/api/tests/test_inspection_api.py` (`test_archive_and_stats`), `services/api/tests/test_inspection_keys.py`
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`

## Related Docs
- [Bucket Explorer](file-browser.md)
