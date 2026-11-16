import type {
  ArchiveKind,
  ArchivePage,
  CapturePartRequest,
  CreateLineRequest,
  EngineStatus,
  InspectionPage,
  InspectionRecord,
  InspectionStats,
  Line,
  LineDetail,
  ModelVersion,
  ModelVersionDetail,
  PartStatus,
  PartTrace,
  PresignCaptureResponse,
  ReferenceLabel,
  ReviewItem,
  TraceMatch,
  TrainModelRequest,
  UpdateLineRequest,
  VerdictRequest,
  DailyUploadCount,
  DeleteFileResponse,
  FileMetadata,
  FileMetadataDetail,
  FileUploadResponse,
  FileUrlResponse,
  HealthStatus,
  PresignUploadResponse,
  UploadStats,
} from "@anomalib-defect-inspection-archive/shared";

import { API_CLIENT_ROUTES } from "./generated/api-routes";

// The route registry is GENERATED from the API contract (`pnpm gen:api`), so
// it cannot drift from FastAPI. Re-exported from here because this module is
// the frontend's API surface: consumers and the contract test import it from
// `lib/api-client`, and that import path should not change just because the
// registry moved behind a generator.
//
// Everything else in this file is hand-written on purpose — error policy, base
// URL resolution, the legacy-route fallback, the CORS diagnostics and the XHR
// upload transport are per-app judgement the contract does not describe. See
// `scripts/gen/api-gen.config.json` (`escapeHatch`).
export { API_CLIENT_ROUTES };

// Single-origin deploys (Vercel `services`: one project serving web + API) put
// the API under /api on the same origin, so no NEXT_PUBLIC_API_URL is needed —
// a production build with it unset defaults to the relative "/api". An explicit
// NEXT_PUBLIC_API_URL still wins (two-project / separate-origin deploys). Local
// dev (NODE_ENV !== "production") falls back to the dev API port.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:8000");

/** Typed API error with HTTP status code for caller-side branching. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True for 408, 429, 500, 502, 503, 504 — worth retrying. */
  get isRetryable(): boolean {
    return [408, 429, 500, 502, 503, 504].includes(this.status);
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

/**
 * Build the right status-0 ApiError for a thrown fetch().
 *
 * fetch() rejects with a TypeError for genuinely-offline/DNS failures AND for
 * responses the browser refused to expose — most notably a cross-origin 500
 * that shipped without `Access-Control-Allow-Origin`. We can't tell those apart
 * from the error object, but `navigator.onLine === false` reliably means the
 * device has no connectivity. Anything else reached the network, so the most
 * likely cause is the server erroring with a CORS-blocked response — point the
 * developer at the API logs instead of blaming their connection.
 */
function networkError(): ApiError {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return new ApiError("You appear to be offline — check your connection", 0);
  }
  return new ApiError(
    "Couldn't reach the API, or the server returned an error the browser blocked (CORS). Check the API logs.",
    0,
  );
}

/**
 * Build the status-0 ApiError for a failed browser→B2 PUT.
 *
 * Deliberately not `networkError()`: these bytes never touch the API, so
 * "check the API logs" sends the developer to the one place that looks fine —
 * the presign that produced this URL succeeded and logged a clean 200.
 *
 * On a deployed origin the overwhelmingly likely cause is that the *bucket's*
 * CORS does not allow that origin, so the browser blocks the PUT before it
 * leaves and XHR reports only a contentless `error` event. Local dev rarely
 * trips it because localhost origins are usually already allowed — which is
 * exactly why it first appears immediately after a deploy. Name the cause and
 * the remedy instead of leaving a mystery.
 */
function storageNetworkError(): ApiError {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return new ApiError("You appear to be offline — check your connection", 0);
  }
  return new ApiError(
    "Couldn't upload to B2 storage. If this app is deployed, the bucket's CORS " +
      "must allow this origin — run services/api/scripts/setup_b2_cors.py " +
      "--origin <your origin>.",
    0,
  );
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw networkError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.detail || `API error: ${res.status}`,
      res.status,
    );
  }
  return res.json();
}

function isEndpointUnavailable(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    (error.message === "Not Found" || error.message === "API error: 404")
  );
}

async function apiFetchWithLegacyFallback<T>(
  path: string,
  legacyPath: () => string,
  init?: RequestInit
): Promise<T> {
  try {
    return await apiFetch<T>(path, init);
  } catch (error) {
    if (isEndpointUnavailable(error)) {
      return apiFetch<T>(legacyPath(), init);
    }
    throw error;
  }
}

function fileKeyQuery(key: string): string {
  if (key.length === 0) {
    throw new ApiError("File key is required", 400);
  }
  return new URLSearchParams({ key }).toString();
}

function legacyFileKeyPath(
  key: string,
  options: { blockRouteCollisions?: boolean } = {}
): string {
  if (!isLegacyPathFallbackSafe(key, options)) {
    throw new ApiError("Current API version required for this file key", 404);
  }
  return encodeURIComponent(key);
}

/**
 * Substitute a file key into a legacy `{key}` path template. The parameter type
 * requires the literal `{key}` placeholder, so passing a registry path that has
 * no placeholder is a compile error rather than a silent no-op that would send
 * the request to a keyless URL.
 */
function legacyFileKeyRoute(
  path: `${string}{key}${string}`,
  key: string,
  options: { blockRouteCollisions?: boolean } = {}
): string {
  return path.replace("{key}", legacyFileKeyPath(key, options));
}

function isLegacyPathFallbackSafe(
  key: string,
  { blockRouteCollisions = false }: { blockRouteCollisions?: boolean } = {}
): boolean {
  if (/(\.\.\/|\/\.\.|\\|%2e%2e|%00|\x00)/i.test(key)) return false;
  if (!blockRouteCollisions) return true;

  const lowerKey = key.toLowerCase();
  if (lowerKey === "stats" || lowerKey === "stats/activity") return false;
  if (lowerKey.endsWith("/download") || lowerKey.endsWith("/preview")) return false;
  return true;
}

export async function getHealth() {
  return apiFetch<HealthStatus>(API_CLIENT_ROUTES.health.path);
}

export async function getFiles(prefix = "", limit = 100) {
  return apiFetch<FileMetadata[]>(
    `${API_CLIENT_ROUTES.files.path}?prefix=${encodeURIComponent(prefix)}&limit=${limit}`
  );
}

export async function getFileStats() {
  return apiFetch<UploadStats>(API_CLIENT_ROUTES.fileStats.path);
}

export async function getUploadActivity(days = 7) {
  return apiFetch<DailyUploadCount[]>(
    `${API_CLIENT_ROUTES.uploadActivity.path}?days=${days}`
  );
}

export async function getFile(key: string) {
  return apiFetchWithLegacyFallback<FileMetadata>(
    `${API_CLIENT_ROUTES.fileByKeyMetadata.path}?${fileKeyQuery(key)}`,
    () =>
      legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFileMetadata.path, key, {
        blockRouteCollisions: true,
      })
  );
}

/**
 * Rich metadata (checksums, image/PDF fields) for an already-stored file.
 * The server recomputes this on demand by downloading the object, so it's a
 * heavier call than getFile — fetch it lazily (only when the user asks to see
 * details). No legacy path fallback: this endpoint is new, so an older backend
 * wouldn't serve it under any route.
 */
export async function getFileDetail(key: string) {
  return apiFetch<FileMetadataDetail>(
    `${API_CLIENT_ROUTES.fileByKeyDetail.path}?${fileKeyQuery(key)}`
  );
}

export async function getDownloadUrl(key: string) {
  return apiFetchWithLegacyFallback<FileUrlResponse>(
    `${API_CLIENT_ROUTES.fileByKeyDownload.path}?${fileKeyQuery(key)}`,
    () => legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFileDownload.path, key)
  );
}

/** Preview-only presigned URL — does NOT increment the download counter. */
export async function getPreviewUrl(key: string) {
  return apiFetchWithLegacyFallback<FileUrlResponse>(
    `${API_CLIENT_ROUTES.fileByKeyPreview.path}?${fileKeyQuery(key)}`,
    () => legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFilePreview.path, key)
  );
}

export async function deleteFile(key: string) {
  return apiFetchWithLegacyFallback<DeleteFileResponse>(
    `${API_CLIENT_ROUTES.fileByKeyDelete.path}?${fileKeyQuery(key)}`,
    () => legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFileDelete.path, key),
    {
      // Derived from the registry so the verb the contract test checks is the
      // verb actually sent — a hardcoded "DELETE" could silently disagree.
      method: API_CLIENT_ROUTES.fileByKeyDelete.method.toUpperCase(),
    }
  );
}

/**
 * Upload a file directly to B2 in three steps: presign (the API validates the
 * declared file and signs a short-lived PUT), a direct browser→B2 PUT, then
 * verify (the API inspects the stored object). The bytes never pass through the
 * API, which is what removes Vercel's ~4.5 MB Function payload ceiling.
 *
 * The `(file, onProgress) => FileUploadResponse` signature is unchanged, so the
 * upload queue and progress UI don't care that the transport changed. Progress
 * tracks the browser→B2 leg; when it reaches 100% the queue enters its
 * server-side phase (see `upload-status`) while `verify` runs.
 */
export async function uploadFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<FileUploadResponse> {
  const presign = await apiFetch<PresignUploadResponse>(
    API_CLIENT_ROUTES.uploadPresign.path,
    {
      method: API_CLIENT_ROUTES.uploadPresign.method.toUpperCase(),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        content_type: file.type,
        size_bytes: file.size,
      }),
    }
  );

  await putFileToStorage(presign, file, onProgress);

  return apiFetch<FileUploadResponse>(API_CLIENT_ROUTES.uploadVerify.path, {
    method: API_CLIENT_ROUTES.uploadVerify.method.toUpperCase(),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: presign.key }),
  });
}

/**
 * PUT the raw file bytes to the presigned B2 URL. XHR (not fetch) because only
 * XHR exposes upload progress. The signed URL binds the exact size and
 * content-type, so `presign.headers` must be sent verbatim — B2 answers a
 * mismatch with 403.
 */
function putFileToStorage(
  presign: PresignUploadResponse,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  return putToStorage(presign.method, presign.url, presign.headers, file, onProgress);
}

/**
 * The XHR transport shared by Upload and Capture: PUT `body` to a presigned
 * B2 URL with the exact signed headers, reporting progress.
 */
export function putToStorage(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        // B2 errors are XML, not JSON — surface a stable message rather than
        // the raw body (a 403 here means the signed size/type was violated).
        reject(
          new ApiError(`Upload to storage failed (${xhr.status})`, xhr.status)
        );
      }
    });

    xhr.addEventListener("error", () => reject(storageNetworkError()));
    xhr.addEventListener("abort", () =>
      reject(new ApiError("Upload aborted", 0)),
    );

    xhr.open(method.toUpperCase(), url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.send(body);
  });
}

// --- Inspection archive -----------------------------------------------------

/** Fill `{name}` placeholders in a registry path, URL-encoding each value. */
function routePath(path: string, params: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") {
      throw new ApiError(`Missing route parameter: ${name}`, 400);
    }
    return encodeURIComponent(value);
  });
}

function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(name, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function sendJson<T>(
  route: { method: string; path: string },
  path: string,
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method: route.method.toUpperCase(),
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function getLines() {
  return apiFetch<Line[]>(API_CLIENT_ROUTES.lines.path);
}

export function getLineDetail(lineId: string) {
  return apiFetch<LineDetail>(
    routePath(API_CLIENT_ROUTES.lineDetail.path, { line_id: lineId }),
  );
}

export function createLine(body: CreateLineRequest) {
  return sendJson<Line>(API_CLIENT_ROUTES.lineCreate, API_CLIENT_ROUTES.lineCreate.path, body);
}

export function updateLine(lineId: string, body: UpdateLineRequest) {
  return sendJson<Line>(
    API_CLIENT_ROUTES.lineUpdate,
    routePath(API_CLIENT_ROUTES.lineUpdate.path, { line_id: lineId }),
    body,
  );
}

export interface PartsQuery {
  date?: string;
  status?: PartStatus;
  limit?: number;
  cursor?: string;
}

export function getParts(lineId: string, query: PartsQuery = {}) {
  return apiFetch<InspectionPage>(
    routePath(API_CLIENT_ROUTES.parts.path, { line_id: lineId }) +
      queryString({ ...query }),
  );
}

export function getPartTrace(lineId: string, serial: string) {
  return apiFetch<PartTrace>(
    routePath(API_CLIENT_ROUTES.partTrace.path, { line_id: lineId, serial }),
  );
}

export interface CaptureInput {
  lineId: string;
  serial: string;
  file: File;
  reference?: ReferenceLabel | null;
  scoreNow?: boolean;
}

/**
 * Capture a part in three steps, mirroring Upload: presign (the API checks the
 * serial and signs a PUT to `lines/<line>/<date>/images/<serial>.png`), a
 * direct browser->B2 PUT, then register (the API validates the image and
 * scores it with the line's active model).
 */
export async function capturePart(
  input: CaptureInput,
  onProgress?: (percent: number) => void,
): Promise<InspectionRecord> {
  const presign = await sendJson<PresignCaptureResponse>(
    API_CLIENT_ROUTES.partPresign,
    routePath(API_CLIENT_ROUTES.partPresign.path, { line_id: input.lineId }),
    { serial: input.serial, content_type: input.file.type, size_bytes: input.file.size },
  );
  await putToStorage("PUT", presign.upload_url, presign.headers, input.file, onProgress);
  const body: CapturePartRequest = {
    serial: input.serial,
    image_key: presign.image_key,
    score_now: input.scoreNow ?? true,
    reference: input.reference ?? null,
  };
  return sendJson<InspectionRecord>(
    API_CLIENT_ROUTES.partCapture,
    routePath(API_CLIENT_ROUTES.partCapture.path, { line_id: input.lineId }),
    body,
  );
}

export function scorePart(lineId: string, serial: string, modelVersion?: string | null) {
  return sendJson<InspectionRecord>(
    API_CLIENT_ROUTES.partScore,
    routePath(API_CLIENT_ROUTES.partScore.path, { line_id: lineId, serial }),
    { model_version: modelVersion ?? null },
  );
}

export function recordVerdict(lineId: string, serial: string, body: VerdictRequest) {
  return sendJson<InspectionRecord>(
    API_CLIENT_ROUTES.partVerdict,
    routePath(API_CLIENT_ROUTES.partVerdict.path, { line_id: lineId, serial }),
    body,
  );
}

export function getReviewQueue(lineId?: string, limit = 100) {
  return apiFetch<ReviewItem[]>(
    API_CLIENT_ROUTES.reviewQueue.path + queryString({ line_id: lineId, limit }),
  );
}

export function searchTrace(serial: string, lineId?: string) {
  return apiFetch<TraceMatch[]>(
    API_CLIENT_ROUTES.traceSearch.path + queryString({ serial, line_id: lineId }),
  );
}

export function getModels(lineId: string) {
  return apiFetch<ModelVersion[]>(routePath(API_CLIENT_ROUTES.models.path, { line_id: lineId }));
}

export function getModelDetail(lineId: string, version: string) {
  return apiFetch<ModelVersionDetail>(
    routePath(API_CLIENT_ROUTES.modelDetail.path, { line_id: lineId, version }),
  );
}

export function trainModel(lineId: string, body: TrainModelRequest) {
  return sendJson<ModelVersion>(
    API_CLIENT_ROUTES.modelTrain,
    routePath(API_CLIENT_ROUTES.modelTrain.path, { line_id: lineId }),
    body,
  );
}

export function activateModel(lineId: string, version: string) {
  return sendJson<Line>(
    API_CLIENT_ROUTES.modelActivate,
    routePath(API_CLIENT_ROUTES.modelActivate.path, { line_id: lineId, version }),
  );
}

export interface ArchiveQuery {
  lineId?: string;
  date?: string;
  kind?: ArchiveKind;
  cursor?: string;
}

export function getArchive(query: ArchiveQuery) {
  return apiFetch<ArchivePage>(
    API_CLIENT_ROUTES.archive.path +
      queryString({
        line_id: query.lineId,
        date: query.date,
        kind: query.kind,
        cursor: query.cursor,
      }),
  );
}

export function getInspectionStats() {
  return apiFetch<InspectionStats>(API_CLIENT_ROUTES.inspectionStats.path);
}

export function getEngine() {
  return apiFetch<EngineStatus>(API_CLIENT_ROUTES.engine.path);
}
