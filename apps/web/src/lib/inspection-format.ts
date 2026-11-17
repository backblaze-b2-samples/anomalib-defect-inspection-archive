import type {
  ArchiveKind,
  ModelStatus,
  ModelVersion,
  PartStatus,
  ReferenceLabel,
  ScoreJob,
  TrainingSource,
} from "@anomalib-defect-inspection-archive/shared";

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  unscored: "Unscored",
  below_threshold: "Below threshold",
  in_review: "In review",
  passed: "Passed",
  failed: "Failed",
  reference: "Reference",
};

export const PART_STATUSES = Object.keys(PART_STATUS_LABELS) as PartStatus[];

export const MODEL_STATUS_LABELS: Record<ModelStatus, string> = {
  queued: "Queued",
  training: "Training",
  ready: "Ready",
  failed: "Failed",
  interrupted: "Interrupted",
};

export const TRAINING_SOURCE_LABELS: Record<TrainingSource, string> = {
  reference_and_adjudicated: "Reference and adjudicated",
  reference_only: "Reference only",
};

export const ARCHIVE_KIND_LABELS: Record<ArchiveKind, string> = {
  images: "Images",
  heatmaps: "Heatmaps",
  scores: "Scores",
  labels: "Labels",
  models: "Models",
};

export const IMAGE_SIZES = [256, 224] as const;
export const CORESET_RATIOS = [0.01, 0.05, 0.1] as const;

/** Raw PatchCore scores: three decimals is enough to compare with a threshold. */
export function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : value.toFixed(3);
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${(value * 100).toFixed(1)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Equal-width histogram bins for the score distribution chart. */
export function binScores(
  scores: number[],
  binCount = 12,
): { label: string; from: number; to: number; count: number }[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const width = max > min ? (max - min) / binCount : 1;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
    label: (min + (i + 0.5) * width).toFixed(2),
  }));
  for (const score of scores) {
    const index = Math.min(Math.floor((score - min) / width), binCount - 1);
    bins[index].count += 1;
  }
  return bins;
}

/** Today's capture date (UTC), matching the API's key layout. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Elapsed time for a running job: "42s", "1m 05s". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Stage text and (when known) percent for a server-side score job. */
export function scoreJobProgress(job: ScoreJob): { label: string; percent: number | null } {
  if (job.status === "queued") {
    return { label: "Queued: waiting for the ML worker", percent: null };
  }
  if (job.total === null || job.total === undefined) {
    return { label: "Finding unscored parts", percent: null };
  }
  const handled = job.scored + job.failed;
  const current = Math.min(handled + 1, job.total);
  return {
    label: `Scoring part ${current} of ${job.total} with ${job.model_version}`,
    percent: job.total ? Math.round((handled / job.total) * 100) : 100,
  };
}

/** Capture button copy: never claims scoring when the line has no model yet. */
export function captureButtonLabel({
  pending,
  progress,
  hasModel,
}: {
  pending: boolean;
  progress: number;
  hasModel: boolean;
}): string {
  if (!pending) return hasModel ? "Capture and score" : "Capture";
  if (progress < 100) return "Uploading to B2...";
  return hasModel ? "Scoring with PatchCore..." : "Saving to B2...";
}

/**
 * The ready version waiting to be activated: the newest ready one, when it is
 * not the active one. Captures keep scoring with `active` until then (after a
 * deliberate rollback the notice still holds: the newer version is idle).
 */
export function activationPrompt(
  models: ModelVersion[],
): { candidate: ModelVersion; active: ModelVersion | undefined } | null {
  const number = (m: ModelVersion) => Number(m.version.slice(1));
  const ready = models.filter((m) => m.status === "ready").sort((a, b) => number(b) - number(a));
  const candidate = ready[0];
  if (!candidate || candidate.active) return null;
  return { candidate, active: models.find((m) => m.active) };
}

/** A training run's share of stages done, as a whole percent (null when unknown). */
export function trainingPercent(model: ModelVersion): number | null {
  return model.progress === null || model.progress === undefined
    ? null
    : Math.round(model.progress * 100);
}

/**
 * DOM attributes for a determinate progress bar. The generated shadcn
 * `Progress` keeps `value` for its own indicator and never passes it to the
 * Radix root, so without these the bar has no aria-valuenow at all.
 */
export function progressValueProps(percent: number) {
  return {
    "aria-valuenow": percent,
    "data-value": percent,
    "data-state": percent >= 100 ? "complete" : "loading",
  } as const;
}

type QueuedPart = { line_id: string; serial: string };

export function reviewItemId(item: QueuedPart): string {
  return `${item.line_id}/${item.serial}`;
}

/** The selected queue item, else the oldest one. */
export function pickReviewItem<T extends QueuedPart>(
  queue: T[] | undefined,
  selectedId: string | null,
): T | undefined {
  return queue?.find((item) => reviewItemId(item) === selectedId) ?? queue?.[0];
}

/** Link to the review queue of a line, pre-selecting one part when given. */
export function reviewQueueHref(lineId: string, serial?: string): string {
  const base = `/review?line=${encodeURIComponent(lineId)}`;
  return serial ? `${base}&serial=${encodeURIComponent(serial)}` : base;
}

/** Serials for a batch of reference images: GOOD-001, GOOD-002, ... */
export function referenceSerials(prefix: string, count: number): string[] {
  const width = Math.max(3, String(count).length);
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(width, "0")}`);
}

/**
 * A heatmap URL can be handed out a moment before its object is readable, so
 * a failed evidence image is retried a few times before saying it failed.
 */
export const EVIDENCE_MAX_RETRIES = 3;

export function evidenceRetryDelay(attempt: number): number {
  return 1_000 * 2 ** attempt;
}

/** Capture page opened in "known-good reference" mode for a line. */
export function captureReferencesHref(lineId: string): string {
  return `/upload?line=${encodeURIComponent(lineId)}&reference=normal`;
}

/** Models page with the Train form focused: one click to start the run. */
export function trainModelHref(lineId: string): string {
  return `/lines/${encodeURIComponent(lineId)}/models?train=1`;
}

/** The `reference` search param, when it names a real reference label. */
export function parseReferenceParam(value: string | undefined): ReferenceLabel | undefined {
  return value === "normal" || value === "anomalous" ? value : undefined;
}

/** UTC month-day-hour-minute, so two reference batches get distinct serials. */
export function batchStamp(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}-${two(now.getUTCHours())}${two(now.getUTCMinutes())}`;
}

/** Default serial prefix for a reference batch: LINE-01-GOOD-1116-2205-001, ... */
export function defaultReferencePrefix(lineId: string, reference: ReferenceLabel, stamp?: string): string {
  const base = `${lineId.toUpperCase()}-${reference === "normal" ? "GOOD" : "DEFECT"}`;
  return stamp ? `${base}-${stamp}` : base;
}

/** Why the Capture button is disabled (null when it is enabled or busy). */
export function captureBlockedReason({
  lineId,
  serial,
  serialValid,
  fileCount,
  busy,
}: {
  lineId: string | undefined;
  serial: string;
  serialValid: boolean;
  fileCount: number;
  busy: boolean;
}): string | null {
  if (busy) return null;
  if (!lineId) return "Choose a line first.";
  if (serial === "") return "Type a serial first.";
  if (!serialValid) return "Serial can only use letters, digits, dot, dash or underscore (64 max).";
  if (fileCount === 0) return "Drop an image first.";
  return null;
}

/** Why "Train new version" is disabled for lack of known-good references. */
export function trainBlockedReason(normalReferences: number | undefined, minimum: number): string | null {
  if (normalReferences === undefined || normalReferences >= minimum) return null;
  return `Needs at least ${minimum} known-good reference images; this line has ${normalReferences}.`;
}

/**
 * A verdict's `score_ref` ("<scored_at>@<model_version>") as the reviewed
 * score, its model version and when it was scored, looked up in the part's
 * score history.
 */
export function describeScoreRef(
  ref: string | null | undefined,
  scores: { scored_at: string; model_version: string; score: number }[],
): string {
  if (!ref) return "-";
  const at = ref.lastIndexOf("@");
  const scoredAt = at >= 0 ? ref.slice(0, at) : ref;
  const version = at >= 0 ? ref.slice(at + 1) : "";
  const when = Date.parse(scoredAt);
  const row = scores.find((s) => s.model_version === version && Date.parse(s.scored_at) === when);
  const parts = [row ? formatScore(row.score) : null, version || null, formatDateTime(scoredAt)];
  return parts.filter(Boolean).join(" · ");
}
