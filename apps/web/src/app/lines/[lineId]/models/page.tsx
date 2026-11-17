"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Brain, Camera, CheckCircle2, ClipboardCheck } from "lucide-react";
import type { ModelVersion } from "@anomalib-defect-inspection-archive/shared";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EngineNotice } from "@/components/inspection/engine-notice";
import { JobProgress } from "@/components/inspection/job-progress";
import { ModelStatusBadge } from "@/components/inspection/status-badge";
import { TrainForm } from "@/components/inspection/train-form";
import {
  activationPrompt,
  captureReferencesHref,
  formatDateTime,
  formatPercent,
  formatScore,
  reviewQueueHref,
  scoreJobProgress,
  trainBlockedReason,
  trainingPercent,
} from "@/lib/inspection-format";
import {
  isScoreJobActive,
  isTrainingInFlight,
  useActivateModel,
  useLineDetail,
  useModels,
  useScoreJob,
} from "@/lib/queries";

export default function ModelsPage() {
  const { lineId } = useParams<{ lineId: string }>();
  // `?train=1` (from "Train the first model"): focus and highlight the form.
  const trainIntent = useSearchParams().get("train") === "1";
  const line = useLineDetail(lineId);
  const scoreJob = useScoreJob(lineId);
  // The run that just finished while this page watched it, for the next step.
  const [justFinished, setJustFinished] = useState<ModelVersion | null>(null);
  const models = useModels(lineId, {
    onRunsFinished: (runs) => {
      for (const run of runs) {
        if (run.status === "ready" && run.active) {
          const waiting = line.data?.unscored_count ?? 0;
          toast.success(`${run.version} is live`, {
            description: waiting
              ? `Scoring the ${waiting} part(s) waiting on this line now.`
              : "New captures on this line are scored with it.",
          });
        } else if (run.status === "ready") {
          toast.success(`${run.version} is ready`, { description: "Activate it to score new captures with it." });
        } else {
          toast.error(`Training ${run.version} ${run.status}`, { description: run.error ?? undefined });
        }
      }
      setJustFinished(runs.find((run) => run.status === "ready" && run.active) ?? null);
    },
  });
  const blockedReason = line.data
    ? trainBlockedReason(line.data.normal_reference_count, line.data.min_normal_references)
    : null;
  const liveJob = scoreJob.data && isScoreJobActive(scoreJob.data) ? scoreJobProgress(scoreJob.data) : null;
  const activate = useActivateModel(lineId);
  // The active marker comes from the version list itself (`m.active`, read
  // with the same request), never from the separately-loaded line detail:
  // that one could lag and offered "Activate" on the active version.
  const active = models.data?.find((m) => m.active);
  const prompt = activationPrompt(models.data ?? []);
  const base = `/lines/${encodeURIComponent(lineId)}`;
  // Oldest unfinished run first: the worker runs them in order.
  const inFlight = isTrainingInFlight(models.data)
    ? [...(models.data ?? [])].reverse().find((m) => m.status === "queued" || m.status === "training")
    : undefined;

  const onActivate = (version: string) =>
    activate.mutate(version, {
      onSuccess: () => toast.success(`${version} now scores new captures`),
      onError: (error) => toast.error(error.message),
    });

  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Models</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          <Link className="underline-offset-4 hover:underline" href={base}>
            {line.data?.name ?? lineId}
          </Link>{" "}
          · PatchCore versions trained from images read back from B2, each stored with its
          checkpoint, metrics and training-set manifest.
        </p>
      </div>
      <EngineNotice />
      {justFinished && (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>{justFinished.version} is live</AlertTitle>
          <AlertDescription>
            {liveJob ? (
              <JobProgress label={liveJob.label} percent={liveJob.percent} startedAt={scoreJob.data?.started_at} />
            ) : (
              <span>
                {scoreJob.data?.status === "done"
                  ? `Scored ${scoreJob.data.scored} waiting part(s) with ${justFinished.version}. Parts at or above the threshold are in the review queue.`
                  : `New captures on this line are scored with ${justFinished.version}.`}
              </span>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button asChild size="sm" className="h-8">
                <Link href={base}>Open the line</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8">
                <Link href={reviewQueueHref(lineId)}>
                  <ClipboardCheck className="h-3.5 w-3.5" /> Review queue
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {prompt && (
        <Alert>
          <Brain />
          <AlertTitle>
            {prompt.candidate.version} is ready but not active
          </AlertTitle>
          <AlertDescription>
            <span>
              {prompt.active
                ? `New captures still score with ${prompt.active.version} until you activate ${prompt.candidate.version}. `
                : `Nothing scores new captures until you activate ${prompt.candidate.version}. `}
              {prompt.candidate.version}: AUROC {formatPercent(prompt.candidate.image_auroc)}, threshold{" "}
              {formatScore(prompt.candidate.threshold)}
              {prompt.active &&
                ` (${prompt.active.version}: AUROC ${formatPercent(prompt.active.image_auroc)}, threshold ${formatScore(prompt.active.threshold)})`}
              .
            </span>
            <Button
              size="sm"
              className="mt-2 h-8"
              onClick={() => onActivate(prompt.candidate.version)}
              disabled={activate.isPending}
            >
              Activate {prompt.candidate.version}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Versions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {inFlight && (
              <div className="border-b border-border p-4">
                <JobProgress
                  label={`${inFlight.status === "queued" ? "Queued" : "Training"} ${inFlight.version}: ${inFlight.stage ?? "Waiting for the training worker"}`}
                  percent={trainingPercent(inFlight)}
                  startedAt={inFlight.started_at ?? inFlight.created_at}
                  hint="Runs on the API server; this table updates as the run moves through each stage."
                />
              </div>
            )}
            {models.error ? (
              <ErrorState error={models.error} onRetry={() => models.refetch()} />
            ) : models.isLoading ? (
              <Skeleton className="m-5 h-32" />
            ) : (models.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={Brain}
                title="No model yet"
                description="Train the first version from the line's reference images: at least 3 known-good ones (2 to train, 1 held out to set the threshold). Known-defective references make the evaluation sharper."
                action={
                  <Button asChild size="sm" variant="outline" className="h-8">
                    <Link href={captureReferencesHref(lineId)}>
                      <Camera className="h-3.5 w-3.5" /> Capture reference images
                    </Link>
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Train / eval</TableHead>
                    <TableHead className="text-right">AUROC</TableHead>
                    <TableHead className="text-right">Threshold</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.data?.map((m) => (
                    <TableRow key={m.version}>
                      <TableCell className="font-medium">
                        <Link className="underline-offset-4 hover:underline" href={`${base}/models/${m.version}`}>
                          {m.version}
                        </Link>
                        {m.active && <span className="ml-2 text-xs font-semibold text-primary">active</span>}
                      </TableCell>
                      <TableCell>
                        <ModelStatusBadge status={m.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.train_image_count} / {m.eval_image_count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPercent(m.image_auroc)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatScore(m.threshold)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(m.created_at)}</TableCell>
                      <TableCell className="text-right">
                        {m.status === "ready" && !m.active && (
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              size="sm"
                              variant={prompt?.candidate.version === m.version ? "default" : "outline"}
                              onClick={() => onActivate(m.version)}
                              disabled={activate.isPending}
                            >
                              Activate
                            </Button>
                            {active && (
                              <span className="text-xs text-muted-foreground">
                                captures score with {active.version}
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card id="train" className={trainIntent ? "ring-2 ring-primary" : undefined}>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Train new version</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <TrainForm
              lineId={lineId}
              busyVersion={inFlight?.version}
              blockedReason={blockedReason}
              autoFocus={trainIntent}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
