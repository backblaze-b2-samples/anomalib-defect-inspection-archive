// GENERATED FILE — DO NOT EDIT.
//
// Written by `pnpm gen:api` from:
//   docs/api/openapi.json
//
// Hand edits are discarded by the next `pnpm gen:api`. `pnpm gen:check`
// (part of `pnpm verify:web`) fails while this file disagrees with the
// contract. To change what is here, change the FastAPI route or Pydantic
// model and re-run `pnpm contract:export && pnpm gen:api`.

export interface ArchiveItem {
  key: string;
  kind: ArchiveKind;
  last_modified: string;
  size: number;
  url: string;
}

export type ArchiveKind = "images" | "heatmaps" | "scores" | "labels" | "models";

export interface ArchivePage {
  /** Capture date the items belong to. */
  date: string | null;
  /** Capture dates that exist for the line, newest first. */
  dates: string[];
  items: ArchiveItem[];
  next_cursor: string | null;
}

export interface CapturePartRequest {
  /** Must equal the key the presign step returned. */
  image_key: string;
  /** Mark the part as a reference image (normal or anomalous) for training. */
  reference?: ReferenceLabel | null;
  score_now?: boolean;
  serial: string;
}

export interface CreateLineRequest {
  description?: string | null;
  /** Slug, e.g. line-01. */
  line_id: string;
  name: string;
}

export interface DailyPartCount {
  count: number;
  date: string;
}

/** One day's upload count, for the dashboard activity chart. */
export interface DailyUploadCount {
  date: string;
  uploads: number;
}

/** Acknowledgement that one object was removed from the bucket. */
export interface DeleteFileResponse {
  deleted: boolean;
  key: string;
}

export interface EngineStatus {
  anomalib_version: string | null;
  backbone: string;
  device: string;
  install_hint: string | null;
  ml_available: boolean;
  torch_version: string | null;
  weights: string;
}

/** One stored object as the file list and the by-key metadata route see it. */
export interface FileMetadata {
  content_type: string;
  filename: string;
  folder: string;
  key: string;
  size_bytes: number;
  size_human: string;
  uploaded_at: string;
  /**
   * Public object URL, set only when B2_PUBLIC_URL_BASE is configured and
   * the bucket is public. Null otherwise — the UI asks for a presigned URL
   * instead.
   */
  url: string | null;
}

/** Rich metadata recomputed on demand by re-reading the stored object. */
export interface FileMetadataDetail {
  /** Audio/video: bits per second. */
  bitrate: number | null;
  /** Audio/video: codec name. */
  codec: string | null;
  /** Audio/video: duration in seconds. */
  duration_seconds: number | null;
  /**
   * Image-specific: EXIF tags, values stringified. Null for non-images or
   * when no EXIF block was present.
   */
  exif: Record<string, string> | null;
  extension: string;
  filename: string;
  /** Image-specific: pixel height. Null for non-images. */
  image_height: number | null;
  /** Image-specific: pixel width. Null for non-images. */
  image_width: number | null;
  md5: string;
  /**
   * Set when a format-specific extractor was skipped or failed (e.g. an
   * image above Pillow's decompression-bomb limit). The core fields are
   * always exact, so the UI shows this instead of silently dropping the
   * Image / PDF section.
   */
  metadata_warning: string | null;
  mime_type: string;
  /** PDF-specific: author. */
  pdf_author: string | null;
  /** PDF-specific: page count. Null for non-PDFs. */
  pdf_pages: number | null;
  /** PDF-specific: title. */
  pdf_title: string | null;
  sha256: string;
  size_bytes: number;
  size_human: string;
  uploaded_at: string;
}

/** The stored object as `POST /upload/verify` reports it back. */
export interface FileUploadResponse {
  content_type: string;
  filename: string;
  key: string;
  /** Rich metadata, when extraction succeeded for this type. */
  metadata: FileMetadataDetail | null;
  size_bytes: number;
  size_human: string;
  uploaded_at: string;
  /** Public object URL when the bucket is public, else null. */
  url: string | null;
}

/** A short-lived presigned GET for downloading or previewing one object. */
export interface FileUrlResponse {
  /**
   * Presigned GET URL. Download URLs force an attachment disposition;
   * preview URLs are signed inline so a PDF renders in place.
   */
  url: string;
}

export interface HTTPValidationError {
  detail?: ValidationError[];
}

/**
 * Liveness plus B2 reachability. The route answers HTTP 200 even when B2
 * is unreachable, so a caller must read `b2_connected` rather than
 * trusting the status code.
 */
export interface HealthStatus {
  /** True when the bucket answered a cheap head request. */
  b2_connected: boolean;
  /** "healthy" when B2 answered, else "degraded". */
  status: string;
}

export interface InspectionPage {
  items: InspectionRecord[];
  next_cursor: string | null;
}

/** One inspected part: the primary entity. */
export interface InspectionRecord {
  capture_date: string;
  captured_at: string;
  heatmap_key: string | null;
  heatmap_url: string | null;
  image_key: string;
  image_url: string;
  line_id: string;
  model_version: string | null;
  reference: ReferenceLabel | null;
  score: number | null;
  scored_at: string | null;
  serial: string;
  status: PartStatus;
  threshold: number | null;
  verdict: Verdict | null;
}

export interface InspectionStats {
  above_threshold: number;
  bytes_by_kind: Record<string, number>;
  failed: number;
  model_versions: number;
  parts_inspected: number;
  parts_per_day: DailyPartCount[];
  passed: number;
  recent_above_threshold: InspectionRecord[];
  review_backlog: number;
}

/** An inspection line: the container for parts, scores, labels and models. */
export interface Line {
  /** Model version that scores new captures; changes only via /activate. */
  active_model_version: string | null;
  created_at: string;
  description: string | null;
  line_id: string;
  name: string;
  updated_at: string;
}

export interface LineDetail {
  /** Model version that scores new captures; changes only via /activate. */
  active_model_version: string | null;
  created_at: string;
  description: string | null;
  failed_count: number;
  in_review_count: number;
  line_id: string;
  /** Known-good references a first training run needs. */
  min_normal_references: number;
  model_count: number;
  name: string;
  /**
   * Known-good reference images without a verdict: the pool the held-out
   * threshold image comes from.
   */
  normal_reference_count: number;
  part_count: number;
  passed_count: number;
  scores: ScoreSummary;
  unscored_count: number;
  updated_at: string;
}

export type ModelStatus = "queued" | "training" | "ready" | "failed" | "interrupted";

/** One trained (or training) PatchCore model version of a line. */
export interface ModelVersion {
  /**
   * True when this is the line's active version (derived from the line,
   * never stored in version.json).
   */
  active: boolean;
  anomalib_version: string | null;
  backbone: string;
  coreset_ratio: number;
  created_at: string;
  error: string | null;
  eval_image_count: number;
  finished_at: string | null;
  image_auroc: number | null;
  image_f1: number | null;
  image_size: number;
  line_id: string;
  note: string | null;
  /** Line's active version when this one was trained. */
  parent_version: string | null;
  /** Share of the training stages already done (0-1); null once finished. */
  progress: number | null;
  source: TrainingSource;
  /** What a training run is doing right now; null once it has finished. */
  stage: string | null;
  started_at: string | null;
  status: ModelStatus;
  threshold: number | null;
  /** f1_max on a split with anomalies, else p99_normal. */
  threshold_method: string | null;
  train_image_count: number;
  version: string;
}

export interface ModelVersionDetail {
  /**
   * True when this is the line's active version (derived from the line,
   * never stored in version.json).
   */
  active: boolean;
  anomalib_version: string | null;
  backbone: string;
  checkpoint_url: string | null;
  coreset_ratio: number;
  created_at: string;
  error: string | null;
  eval_image_count: number;
  finished_at: string | null;
  image_auroc: number | null;
  image_f1: number | null;
  image_size: number;
  line_id: string;
  /** Full metrics.json: AUROC, F1, threshold, counts. */
  metrics: Record<string, number | string | null>;
  metrics_url: string | null;
  note: string | null;
  /** Line's active version when this one was trained. */
  parent_version: string | null;
  /** Share of the training stages already done (0-1); null once finished. */
  progress: number | null;
  source: TrainingSource;
  /** What a training run is doing right now; null once it has finished. */
  stage: string | null;
  started_at: string | null;
  status: ModelStatus;
  threshold: number | null;
  /** f1_max on a split with anomalies, else p99_normal. */
  threshold_method: string | null;
  train_image_count: number;
  training_set: TrainingSetEntry[];
  version: string;
}

export type PartStatus = "unscored" | "below_threshold" | "in_review" | "passed" | "failed" | "reference";

export interface PartTrace {
  capture_date: string;
  captured_at: string;
  heatmap_key: string | null;
  heatmap_url: string | null;
  image_key: string;
  image_url: string;
  line_id: string;
  model: ModelVersion | null;
  model_version: string | null;
  parquet_keys: string[];
  reference: ReferenceLabel | null;
  score: number | null;
  scored_at: string | null;
  scores: ScoreEntry[];
  serial: string;
  status: PartStatus;
  threshold: number | null;
  verdict: Verdict | null;
  verdicts: VerdictEntry[];
}

export interface PresignCaptureRequest {
  content_type: "image/png" | "image/jpeg";
  /** Part serial, e.g. CNDL-000123. */
  serial: string;
  /** Signed into the URL; B2 rejects any other size. */
  size_bytes: number;
}

export interface PresignCaptureResponse {
  capture_date: string;
  content_type: string;
  expires_in: number;
  /** Send verbatim with the PUT; signed into the URL. */
  headers: Record<string, string>;
  image_key: string;
  upload_url: string;
}

/** What the browser declares before uploading directly to B2. */
export interface PresignUploadRequest {
  content_type: string;
  filename: string;
  size_bytes: number;
}

/**
 * A short-lived presigned PUT the browser uploads to, plus the exact
 * headers it must send. `Content-Length` and `content-type` are signed
 * into the URL, so B2 rejects a body of any other size or type.
 */
export interface PresignUploadResponse {
  content_type: string;
  expires_in: number;
  /**
   * Signed into the URL, so the browser must send them verbatim — B2
   * answers a mismatch with 403.
   */
  headers: Record<string, string>;
  key: string;
  method: string;
  url: string;
}

export type ReferenceLabel = "normal" | "anomalous";

/** An InspectionRecord in status in_review. */
export interface ReviewItem {
  capture_date: string;
  captured_at: string;
  heatmap_key: string | null;
  heatmap_url: string | null;
  image_key: string;
  image_url: string;
  line_id: string;
  model_version: string | null;
  reference: ReferenceLabel | null;
  score: number | null;
  scored_at: string | null;
  serial: string;
  status: PartStatus;
  threshold: number | null;
  verdict: Verdict | null;
}

export interface ScoreEntry {
  above_threshold: boolean;
  anomalib_version: string;
  backbone: string;
  heatmap_key: string;
  heatmap_url: string;
  model_version: string;
  score: number;
  scored_at: string;
  threshold: number;
}

/**
 * Server-side run that scores every unscored part of a line. It runs in
 * the API process, so leaving or reloading the page does not stop it.
 */
export interface ScoreJob {
  /** Last per-part error, if any. */
  error: string | null;
  failed: number;
  finished_at: string | null;
  line_id: string;
  model_version: string | null;
  scored: number;
  started_at: string | null;
  status: ScoreJobStatus;
  /** Parts to score; null until counted. */
  total: number | null;
}

export type ScoreJobStatus = "idle" | "queued" | "running" | "done" | "failed";

export interface ScorePartRequest {
  /** Defaults to the line's active model version. */
  model_version?: string | null;
}

/** Latest score per scored part on a line. */
export interface ScoreSummary {
  above_threshold_count: number;
  max_score: number | null;
  mean_score: number | null;
  min_score: number | null;
  /** Latest score of up to 500 parts, for the distribution chart. */
  recent_scores: number[];
  scored_count: number;
  /** Threshold of the active model version, when one is ready. */
  threshold: number | null;
}

/** How far a dashboard stats computation has got, for a determinate wait. */
export interface StatsProgress {
  lines_done: number;
  lines_total: number;
  running: boolean;
}

export interface TraceMatch {
  capture_date: string;
  line_id: string;
  serial: string;
  status: PartStatus;
}

export interface TrainModelRequest {
  coreset_ratio?: 0.01 | 0.05 | 0.1;
  image_size?: 256 | 224;
  note?: string | null;
  source?: TrainingSource;
}

export interface TrainingSetEntry {
  etag: string;
  key: string;
  label: "normal" | "anomalous";
  role: "train" | "eval";
  serial: string;
  source: "reference" | "verdict";
}

export type TrainingSource = "reference_and_adjudicated" | "reference_only";

export interface UpdateLineRequest {
  description?: string | null;
  name?: string | null;
}

/** Aggregate bucket figures behind the dashboard stat cards. */
export interface UploadStats {
  total_downloads: number;
  total_files: number;
  total_size_bytes: number;
  total_size_human: string;
  uploads_today: number;
}

export interface ValidationError {
  ctx?: Record<string, unknown>;
  input?: unknown;
  loc: (string | number)[];
  msg: string;
  type: string;
}

export type Verdict = "pass" | "fail";

export interface VerdictEntry {
  note: string | null;
  operator: string;
  recorded_at: string;
  /** '<scored_at>@<model_version>' the operator reviewed. */
  score_ref: string | null;
  verdict: Verdict;
}

export interface VerdictRequest {
  note?: string | null;
  operator: string;
  verdict: Verdict;
}

/** Sent after the direct PUT so the API can inspect the stored object. */
export interface VerifyUploadRequest {
  key: string;
}
