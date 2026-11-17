<!-- last_verified: 2026-11-16 -->
# App Workflows

User journeys inside the application. The first time through: create a line,
capture reference images, train the first model, then capture production parts.

## Capture and Score a Part

- User opens `/upload` (Capture), or "Capture part" on a line page, which pre-selects that line
- Chooses the line from a `Select`, types the part serial (e.g. `CNDL-000123`), and says whether the part is a reference image: a known-good part (`normal`), a known-defective part (`anomalous`) or a production part (default)
- Drops one PNG or JPEG (up to 20 MB). The browser uploads it straight to `lines/<line>/<date>/images/<serial>.png` in B2 with a presigned PUT, with a progress bar
- The API registers the part (a JPEG is stored as PNG) and, if the line has an active model, scores it: the "Last capture" card shows the image, its heatmap, the status badge and score vs threshold
- A line without a model stores the image as `Unscored`, and the result card links to the line's Models page ("Train the first model"). When the line's first model becomes ready it is activated and a server-side job scores every unscored part; later, "Score N unscored part(s)" on the line page starts the same job, whose progress ("Scoring part k of N") survives leaving or reloading the page
- Without the ML extra, an engine notice says so and captures stay `Unscored`
- A serial already used on the line is refused (409) before anything is uploaded
- See: [Capture and Scoring](features/capture-and-scoring.md)

## Review Flagged Parts

- User opens `/review` (or "Review queue" on a line page, filtered to that line); the line `Select` also offers "All lines"
- The queue lists parts whose latest score is at or above the threshold and that have no verdict yet, oldest capture first, each with score / threshold
- Selecting one shows the image and heatmap side by side and the verdict form: Pass / Fail as a `RadioGroup`, operator (e.g. initials), optional note
- Saving appends a label in B2 and the part leaves the queue; the next one is shown
- Changing a verdict later (from Trace) adds another label; the history keeps both
- See: [Review Queue](features/review-queue.md)

## Retrain the Model

- User opens a line, then "Models"
- "Train new version" form: training images (`Reference and adjudicated` default, or `Reference only`), image size (256 / 224 segmented control), coreset ratio (`Select`, 0.1 default), optional note; backbone and device are shown read-only
- Submitting queues version `v<N>`; the table polls while it is queued and training. Images are read back from B2 into the local cache first
- When it finishes, the row shows train / eval counts, AUROC and threshold. The line's first ready version becomes active automatically; later versions need "Activate"
- The version page shows configuration, metrics, links to `model.ckpt` and `metrics.json`, and the training-set manifest (every serial with its role, label, source and ETag)
- An API restart during training leaves that version `Interrupted`; train again
- See: [Retraining and Model Versions](features/retraining.md)

## Trace a Part

- User opens `/trace`, enters a serial or its beginning, and picks a match (line, capture date, status)
- The part page shows the captured image next to the heatmap of the selected score, the score history (each row with its model version and threshold, "Show heatmap" switches the evidence), and the verdict history (operator, note, the score reviewed)
- "Re-score" runs a chosen ready version (default: the active one) and adds a new score row and heatmap; earlier ones stay
- The verdict form records or changes the verdict
- Every serial anywhere else in the app links here
- See: [Trace](features/trace.md)

## Inspection Archive

- User opens `/archive` (or "Archive" on a line page) and picks a line
- "Images + heatmaps" shows a grid pairing each captured image with its heatmap for the selected capture date (`Latest` by default); each serial links to Trace
- The Scores, Labels and Models tabs list the line's Parquet files, verdict labels and model files with size and date; each key opens the object
- "Next page" follows the B2 listing cursor
- See: [Inspection Archive](features/inspection-archive.md)

## Set Up a Line

- User opens `/lines` and clicks "New line"
- Enters a line id (e.g. `line-01`; lowercase, digits and dashes; it cannot change later), a name (e.g. "Line 1, candle station") and an optional description
- The line page shows part counts by status, the score distribution with the active threshold, and today's parts with a date and status filter
- "Edit line" opens pre-filled with the name and description
- See: [Lines](features/lines.md)

## View Dashboard

- User navigates to `/` (home)
- Cards: parts inspected, above threshold, review backlog, passed, failed, model versions
- Parts per day (last 14 UTC days), archive bytes in B2 by kind (images, heatmaps, scores, labels, models), and the most recent parts above threshold, each linking to Trace
- While stats load, the page says so in words; a failure shows an error with Retry instead of zeros
- See: [Dashboard](features/dashboard.md)

## Browse the Bucket

- User navigates to `/files` to see any object in the bucket as a folder tree (the inspection data appears under `lines/`)
- Clicking a file opens its preview with Download and Delete, and a "Detailed metadata" disclosure (checksums, image or PDF fields)
- Delete works on any object, as in the starter kit; deleting under `lines/` removes evidence a trace depends on, so leave that prefix alone
- See: [Bucket Explorer](features/file-browser.md)

## Change Preferences

- User navigates to `/settings`
- A banner at the top states that the page is mostly a demonstration: only Theme is wired up for real
- **Theme** (real): saving applies it immediately and persists it (`next-themes`); the header's theme toggle drives the same state
- **Profile and preference fields** (demo): each is labelled "Demo field", persists to `localStorage` only, and drives no behaviour
- Danger Zone actions are a demo; no real delete runs
- See: [Settings](features/settings.md)
