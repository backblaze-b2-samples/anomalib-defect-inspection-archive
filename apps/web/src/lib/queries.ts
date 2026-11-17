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
  getInspectionStatsProgress,
  getLineDetail,
  getLines,
  getModelDetail,
  getModels,
  getPartTrace,
  getParts,
  getReviewQueue,
  getScoreJob,
  recordVerdict,
  scorePart,
  searchTrace,
  startScoreUnscored,
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
  Line,
  LineDetail,
  ModelVersion,
  ReviewItem,
  ScoreJob,
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

/**
 * One line with its counters. When a re-read finds a new active version (the
 * first model finished training and went live), the line's score job is
 * re-read too: the server queues it before activating, so the page shows its
 * progress instead of offering a manual "Score unscored" button.
 */
export function useLineDetail(lineId: string | undefined) {
  const qc = useQueryClient();
  const key = [...qk.lineDetail(), lineId ?? ""];
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const previous = qc.getQueryData<LineDetail>(key);
      const next = await getLineDetail(lineId as string);
      if (activeModelChanged(previous, next)) {
        qc.invalidateQueries({ queryKey: [...qk.scoreJob(), lineId ?? ""] });
        qc.invalidateQueries({ queryKey: [...qk.models(), lineId ?? ""] });
      }
      return next;
    },
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

const UNFINISHED_MODEL = new Set<ModelVersion["status"]>(["queued", "training"]);

/** True while any version of the line is queued or training. */
export function isTrainingInFlight(models: ModelVersion[] | undefined): boolean {
  return (models ?? []).some((m) => UNFINISHED_MODEL.has(m.status));
}

/**
 * True when a version that was queued/training in `previous` has finished in
 * `next`. A finished run can change the line itself (its first ready version
 * becomes active and starts scoring the unscored parts), so the caller
 * re-reads the line; without this the Versions table offered "Activate" on a
 * version that was already active until a reload.
 */
export function modelRunFinished(
  previous: ModelVersion[] | undefined,
  next: ModelVersion[],
): boolean {
  return finishedModelRuns(previous, next).length > 0;
}

/** The versions (as now read) that were queued/training in `previous` and are not any more. */
export function finishedModelRuns(
  previous: ModelVersion[] | undefined,
  next: ModelVersion[],
): ModelVersion[] {
  if (!previous) return [];
  const before = new Map(previous.map((m) => [m.version, m.status]));
  return next.filter((m) => {
    const was = before.get(m.version);
    return was !== undefined && UNFINISHED_MODEL.has(was) && !UNFINISHED_MODEL.has(m.status);
  });
}

/** Put a just-queued version at the top of its line's cached version list. */
export function addQueuedModel(qc: QueryClient, queued: ModelVersion) {
  qc.setQueryData<ModelVersion[]>([...qk.models(), queued.line_id], (previous) =>
    previous && !previous.some((m) => m.version === queued.version)
      ? [queued, ...previous]
      : previous,
  );
}

/** True when a re-read line names a different active version than the cached one. */
export function activeModelChanged(previous: LineDetail | undefined, next: LineDetail): boolean {
  return !!previous && previous.active_model_version !== next.active_model_version;
}

/** Reflect a new active version in the cached line detail, line list and version list. */
export function applyActivatedModel(qc: QueryClient, line: Line) {
  const active = line.active_model_version;
  qc.setQueryData<ModelVersion[]>([...qk.models(), line.line_id], (previous) =>
    previous?.map((m) => ({ ...m, active: m.version === active })),
  );
  qc.setQueryData<LineDetail>([...qk.lineDetail(), line.line_id], (previous) =>
    previous ? { ...previous, active_model_version: active } : previous,
  );
  qc.setQueryData<Line[]>(qk.lines(), (previous) =>
    previous?.map((l) => (l.line_id === line.line_id ? { ...l, active_model_version: active } : l)),
  );
}

/** Drop a part that just got its verdict from every cached review queue. */
export function dropVerdictedPartFromQueue(qc: QueryClient, lineId: string, serial: string) {
  qc.setQueriesData<ReviewItem[]>(
    // Partial key: matches qk.reviewQueue(line, limit) for every filter.
    { queryKey: [...qk.lines(), "review"] },
    (previous) =>
      previous?.filter((item) => !(item.line_id === lineId && item.serial === serial)),
  );
}

/**
 * Model versions. Polls every 2s while a version is queued or training, so the
 * stage the run reports stays live; re-reads the line when a run finishes.
 */
export function useModels(
  lineId: string | undefined,
  { onRunsFinished }: { onRunsFinished?: (runs: ModelVersion[]) => void } = {},
) {
  const qc = useQueryClient();
  const key = [...qk.models(), lineId ?? ""];
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const previous = qc.getQueryData<ModelVersion[]>(key);
      const next = await getModels(lineId as string);
      const finished = finishedModelRuns(previous, next);
      if (finished.length > 0) onRunsFinished?.(finished);
      if (finished.length > 0) {
        qc.invalidateQueries({ queryKey: [...qk.lineDetail(), lineId ?? ""] });
        qc.invalidateQueries({ queryKey: qk.lines(), exact: true });
        qc.invalidateQueries({ queryKey: [...qk.scoreJob(), lineId ?? ""] });
      }
      return next;
    },
    enabled: !!lineId,
    refetchInterval: (query) => (isTrainingInFlight(query.state.data) ? 2_000 : false),
  });
}

export function isScoreJobActive(job: ScoreJob | undefined): boolean {
  return job?.status === "queued" || job?.status === "running";
}

/**
 * The line's server-side "score every unscored part" job. Polls every 1.5s
 * while it runs; when it ends, every view of the line is re-read so counters,
 * chart and parts table show the new scores.
 */
export function useScoreJob(lineId: string | undefined) {
  const qc = useQueryClient();
  const key = [...qk.scoreJob(), lineId ?? ""];
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const previous = qc.getQueryData<ScoreJob>(key);
      const next = await getScoreJob(lineId as string);
      if (isScoreJobActive(previous) && !isScoreJobActive(next)) {
        qc.invalidateQueries({
          queryKey: qk.lines(),
          predicate: (query) => query.queryKey[2] !== "score-job",
        });
      }
      return next;
    },
    enabled: !!lineId,
    staleTime: 0,
    refetchInterval: (query) => (isScoreJobActive(query.state.data) ? 1_500 : false),
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

export function useArchive(query: ArchiveQuery, { enabled = true }: QueryGate = {}) {
  return useQuery({
    queryKey: qk.archive(query.lineId, query.date, query.kind, query.cursor),
    queryFn: () => getArchive(query),
    enabled,
  });
}

export function useInspectionStats() {
  return useQuery({ queryKey: qk.inspectionStats(), queryFn: () => getInspectionStats() });
}

/** Lines processed by the stats computation; polled only while the dashboard waits. */
export function useInspectionStatsProgress(enabled: boolean) {
  return useQuery({
    queryKey: qk.inspectionStatsProgress(),
    queryFn: getInspectionStatsProgress,
    enabled,
    staleTime: 0,
    retry: false,
    refetchInterval: enabled ? 1_000 : false,
  });
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
  const qc = useQueryClient();
  const invalidate = useInvalidateInspection();
  return useMutation<Awaited<ReturnType<typeof recordVerdict>>, ApiError, VerdictRequest>({
    mutationFn: (body) => recordVerdict(lineId, serial, body),
    // The queue refetch re-reads the whole line (seconds), so drop the row now.
    onSuccess: () => {
      dropVerdictedPartFromQueue(qc, lineId, serial);
      invalidate();
    },
  });
}

export function useTrainModel(lineId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateInspection();
  return useMutation<Awaited<ReturnType<typeof trainModel>>, ApiError, TrainModelRequest>({
    mutationFn: (body) => trainModel(lineId, body),
    onSuccess: (queued) => {
      addQueuedModel(qc, queued);
      invalidate();
    },
  });
}

export function useActivateModel(lineId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateInspection();
  return useMutation<Awaited<ReturnType<typeof activateModel>>, ApiError, string>({
    mutationFn: (version) => activateModel(lineId, version),
    // The line-detail refetch takes seconds; show the new active version with the toast.
    onSuccess: (line) => {
      applyActivatedModel(qc, line);
      invalidate();
    },
  });
}

/** Queue the server-side job that scores every unscored part of the line. */
export function useStartScoreUnscored(lineId: string) {
  const qc = useQueryClient();
  return useMutation<ScoreJob, ApiError, void>({
    mutationFn: () => startScoreUnscored(lineId),
    onSuccess: (job) => qc.setQueryData([...qk.scoreJob(), lineId], job),
  });
}
