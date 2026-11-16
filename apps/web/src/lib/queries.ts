"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  ApiError,
  activateModel,
  capturePart,
  createLine,
  getArchive,
  getEngine,
  getInspectionStats,
  getLineDetail,
  getLines,
  getModelDetail,
  getModels,
  getPartTrace,
  getParts,
  getReviewQueue,
  recordVerdict,
  scorePart,
  searchTrace,
  trainModel,
  updateLine,
  type ArchiveQuery,
  type CaptureInput,
  type PartsQuery,
  deleteFile,
  getDownloadUrl,
  getFileDetail,
  getFiles,
  getFileStats,
  getHealth,
  getPreviewUrl,
  getUploadActivity,
} from "@/lib/api-client";
import type {
  CreateLineRequest,
  TrainModelRequest,
  UpdateLineRequest,
  VerdictRequest,
  FileMetadata,
  FileMetadataDetail,
  FileUrlResponse,
} from "@anomalib-defect-inspection-archive/shared";
import { qk } from "@/lib/generated/query-keys";

// Query keys are GENERATED from the API contract (`pnpm gen:api`) and their
// hierarchy is declared in `scripts/gen/api-gen.config.json`, so invalidating
// a parent key still reaches its children and no hook can invent a key the API
// cannot answer. Re-exported here because this module is the data layer's
// public surface: components and tests import `qk` from `@/lib/queries`.
//
// The caching policy below — staleTime, refetchInterval, retry, `enabled`
// gating, the query-vs-mutation choice, and the cache surgery in
// `dropDeletedFileFromCache` — is hand-written on purpose and is never
// generated.
export { qk };

export type Health = Awaited<ReturnType<typeof getHealth>>;

/**
 * Gate a query on something being open/visible. Deliberately the only option we
 * expose, so callers can't drift the caching policy per call site — the ⌘K
 * palette reuses `useFiles`' key (and therefore its cache) instead of fetching
 * its own private, smaller list.
 */
export interface QueryGate {
  enabled?: boolean;
}

export function useFiles(prefix = "", limit = 100, { enabled = true }: QueryGate = {}) {
  return useQuery<FileMetadata[], ApiError>({
    queryKey: qk.files(prefix, limit),
    queryFn: () => getFiles(prefix, limit),
    enabled,
  });
}

export function useFileStats({ enabled = true }: QueryGate = {}) {
  return useQuery({
    queryKey: qk.stats(),
    queryFn: getFileStats,
    enabled,
  });
}

export function useUploadActivity(days = 7) {
  return useQuery({
    queryKey: qk.uploadActivity(days),
    queryFn: () => getUploadActivity(days),
  });
}

// Presigned preview URL — only fetched when `enabled` is true (e.g., when
// the dialog opens for a specific file). Kept short-lived (60s) because
// the URL itself has a presigned expiry and is cheap to regenerate.
export function usePreviewUrl(key: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.preview(key ?? ""),
    queryFn: () => getPreviewUrl(key as string),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}

// Rich metadata for an already-stored file. The server recomputes it on demand
// (a full object download), so it's only fetched when `enabled` — i.e. the
// preview dialog is open AND the user expands "Detailed metadata". Kept
// short-lived like the preview URL; cheap correctness under key overwrites.
export function useFileDetail(key: string | undefined, enabled: boolean) {
  return useQuery<FileMetadataDetail, ApiError>({
    queryKey: qk.detail(key ?? ""),
    queryFn: () => getFileDetail(key as string),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}

// Health poll for the top-of-app B2 banner. `retry: false` and letting a
// failed fetch leave `data` undefined keeps a down API silent (the
// per-component ErrorState covers that); the banner only reacts to an up API
// reporting b2_connected: false. Polls every 60s and on window focus.
export function useHealth() {
  return useQuery<Health>({
    queryKey: qk.health(),
    queryFn: getHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Drop a deleted object from every cached file list, plus its own cached
 * preview/detail entries.
 *
 * Invalidation alone is not enough: the refetch re-lists the whole bucket and
 * took 5-6s in practice, so the success toast fired while the row was still
 * listed — and using that stale row's Preview 404'd. Editing the cache makes
 * the row disappear with the toast; the invalidation that follows still
 * reconciles against the server.
 *
 * Exported for tests — the mutation below is its only production caller.
 */
export function dropDeletedFileFromCache(qc: QueryClient, fileKey: string) {
  qc.setQueriesData<FileMetadata[]>(
    // Partial key: matches qk.files(prefix, limit) for every prefix/limit.
    { queryKey: [...qk.all, "files"] },
    (previous) =>
      previous ? previous.filter((file) => file.key !== fileKey) : previous,
  );
  // A presigned URL for a deleted key can only 404 now.
  qc.removeQueries({ queryKey: qk.preview(fileKey) });
  qc.removeQueries({ queryKey: qk.detail(fileKey) });
}

/**
 * Fetch a download URL for one file.
 *
 * A mutation, not a query: it has a server side effect (it bumps the download
 * counter) and it must never be cached or replayed. Being a mutation is also
 * what gives the UI an honest pending state — the old code awaited the presign
 * inside a plain click handler, so a slow round trip left the screen completely
 * unchanged and a user could not tell a working download from a dead button.
 *
 * The caller performs the navigation (see `lib/browser-download.ts`) and gets
 * `isPending` / `variables` for the pending row.
 */
export function useDownloadUrl() {
  const qc = useQueryClient();
  return useMutation<FileUrlResponse, ApiError, FileMetadata>({
    mutationFn: (file) => getDownloadUrl(file.key),
    // The server counted a download, so the dashboard's "Total Downloads" is
    // now stale. Cheap: /files/stats reads a cached bucket listing.
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.stats() }),
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileKey: string) => deleteFile(fileKey),
    onSuccess: (_data, fileKey) => {
      // Remove the row immediately, then reconcile everything (lists, stats,
      // activity) against the server in the background.
      dropDeletedFileFromCache(qc, fileKey);
      qc.invalidateQueries({ queryKey: qk.all });
    },
  });
}

// --- Inspection archive -----------------------------------------------------
//
// Every inspection key sits under qk.lines(), so one invalidation of that
// parent after a write (capture, verdict, score, train, activate) refreshes
// every line, part, review, archive and dashboard view. Path parameters are
// appended to the generated key here, because the generated factory only
// knows query parameters.

export function useLines() {
  return useQuery({ queryKey: qk.lines(), queryFn: getLines });
}

export function useLineDetail(lineId: string | undefined) {
  return useQuery({
    queryKey: [...qk.lineDetail(), lineId ?? ""],
    queryFn: () => getLineDetail(lineId as string),
    enabled: !!lineId,
  });
}

export function useParts(lineId: string | undefined, query: PartsQuery = {}) {
  return useQuery({
    queryKey: [...qk.parts(query.date, query.status, query.limit, query.cursor), lineId ?? ""],
    queryFn: () => getParts(lineId as string, query),
    enabled: !!lineId,
  });
}

export function usePartTrace(lineId: string | undefined, serial: string | undefined) {
  return useQuery({
    queryKey: [...qk.partTrace(), lineId ?? "", serial ?? ""],
    queryFn: () => getPartTrace(lineId as string, serial as string),
    enabled: !!lineId && !!serial,
  });
}

export function useReviewQueue(lineId?: string) {
  return useQuery({
    queryKey: qk.reviewQueue(lineId),
    queryFn: () => getReviewQueue(lineId),
  });
}

export function useTraceSearch(serial: string, lineId?: string) {
  return useQuery({
    queryKey: qk.traceSearch(serial, lineId),
    queryFn: () => searchTrace(serial, lineId),
    enabled: serial.trim().length > 0,
  });
}

/** Model versions; polls every 5s while any version is queued or training. */
export function useModels(lineId: string | undefined) {
  return useQuery({
    queryKey: [...qk.models(), lineId ?? ""],
    queryFn: () => getModels(lineId as string),
    enabled: !!lineId,
    refetchInterval: (query) =>
      query.state.data?.some((m) => m.status === "queued" || m.status === "training")
        ? 5_000
        : false,
  });
}

export function useModelDetail(lineId: string | undefined, version: string | undefined) {
  return useQuery({
    queryKey: [...qk.modelDetail(), lineId ?? "", version ?? ""],
    queryFn: () => getModelDetail(lineId as string, version as string),
    enabled: !!lineId && !!version,
    refetchInterval: (query) =>
      query.state.data?.status === "queued" || query.state.data?.status === "training"
        ? 5_000
        : false,
  });
}

export function useArchive(query: ArchiveQuery) {
  return useQuery({
    queryKey: qk.archive(query.lineId, query.date, query.kind, query.cursor),
    queryFn: () => getArchive(query),
  });
}

export function useInspectionStats() {
  return useQuery({ queryKey: qk.inspectionStats(), queryFn: getInspectionStats });
}

export function useEngine() {
  return useQuery({ queryKey: qk.engine(), queryFn: getEngine, staleTime: 60_000 });
}

function useInvalidateInspection() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.lines() });
    // Captures also add objects the full-bucket explorer lists.
    qc.invalidateQueries({ queryKey: [...qk.all, "files"] });
    qc.invalidateQueries({ queryKey: qk.stats() });
  };
}

export function useCreateLine() {
  const invalidate = useInvalidateInspection();
  return useMutation({
    mutationFn: (body: CreateLineRequest) => createLine(body),
    onSuccess: invalidate,
  });
}

export function useUpdateLine(lineId: string) {
  const invalidate = useInvalidateInspection();
  return useMutation({
    mutationFn: (body: UpdateLineRequest) => updateLine(lineId, body),
    onSuccess: invalidate,
  });
}

export function useCapturePart(onProgress?: (percent: number) => void) {
  const invalidate = useInvalidateInspection();
  return useMutation<Awaited<ReturnType<typeof capturePart>>, ApiError, CaptureInput>({
    mutationFn: (input) => capturePart(input, onProgress),
    onSuccess: invalidate,
  });
}

export function useScorePart(lineId: string) {
  const invalidate = useInvalidateInspection();
  return useMutation<
    Awaited<ReturnType<typeof scorePart>>,
    ApiError,
    { serial: string; modelVersion?: string | null }
  >({
    mutationFn: ({ serial, modelVersion }) => scorePart(lineId, serial, modelVersion),
    onSuccess: invalidate,
  });
}

export function useRecordVerdict(lineId: string, serial: string) {
  const invalidate = useInvalidateInspection();
  return useMutation<Awaited<ReturnType<typeof recordVerdict>>, ApiError, VerdictRequest>({
    mutationFn: (body) => recordVerdict(lineId, serial, body),
    onSuccess: invalidate,
  });
}

export function useTrainModel(lineId: string) {
  const invalidate = useInvalidateInspection();
  return useMutation<Awaited<ReturnType<typeof trainModel>>, ApiError, TrainModelRequest>({
    mutationFn: (body) => trainModel(lineId, body),
    onSuccess: invalidate,
  });
}

export function useActivateModel(lineId: string) {
  const invalidate = useInvalidateInspection();
  return useMutation<Awaited<ReturnType<typeof activateModel>>, ApiError, string>({
    mutationFn: (version) => activateModel(lineId, version),
    onSuccess: invalidate,
  });
}
