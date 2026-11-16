import type {
  ArchiveKind,
  ModelStatus,
  PartStatus,
  TrainingSource,
} from "@anomalib-defect-inspection-archive/shared";

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  unscored: "Unscored",
  below_threshold: "Below threshold",
  in_review: "In review",
  passed: "Passed",
  failed: "Failed",
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
