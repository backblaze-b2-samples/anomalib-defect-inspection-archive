"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Archive, Brain, Camera, ClipboardCheck, ListChecks } from "lucide-react";
import type { PartStatus } from "@anomalib-defect-inspection-archive/shared";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EngineNotice } from "@/components/inspection/engine-notice";
import { LineFormDialog } from "@/components/inspection/line-form";
import { PartsTable } from "@/components/inspection/parts-table";
import { ScoreHistogram } from "@/components/inspection/score-histogram";
import { PART_STATUSES, PART_STATUS_LABELS, todayUtc } from "@/lib/inspection-format";
import { useLineDetail, useParts, useScorePart } from "@/lib/queries";

const ANY = "any";

export default function LineDetailPage() {
  const { lineId } = useParams<{ lineId: string }>();
  const [status, setStatus] = useState<string>(ANY);
  const [todayOnly, setTodayOnly] = useState(true);
  const detail = useLineDetail(lineId);
  const parts = useParts(lineId, {
    status: status === ANY ? undefined : (status as PartStatus),
    date: todayOnly ? todayUtc() : undefined,
    limit: 100,
  });
  const unscored = useParts(lineId, { status: "unscored", limit: 200 });
  const score = useScorePart(lineId);
  const [scoring, setScoring] = useState(false);

  const scoreUnscored = async () => {
    const serials = (unscored.data?.items ?? []).map((item) => item.serial);
    setScoring(true);
    let done = 0;
    for (const serial of serials) {
      try {
        await score.mutateAsync({ serial });
        done += 1;
      } catch (error) {
        toast.error(`${serial}: ${(error as Error).message}`);
        break;
      }
    }
    setScoring(false);
    if (done) toast.success(`Scored ${done} part(s)`);
  };

  if (detail.error) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  const line = detail.data;
  const base = `/lines/${encodeURIComponent(lineId)}`;

  return (
    <div className="space-y-8">
      <div className="animate-fade-in flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="page-title">{line?.name ?? lineId}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {lineId}
            {line?.description ? ` · ${line.description}` : ""} · active model{" "}
            <strong className="text-foreground">{line?.active_model_version ?? "none yet"}</strong>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" className="h-8">
            <Link href={`/upload?line=${encodeURIComponent(lineId)}`}>
              <Camera className="h-3.5 w-3.5" /> Capture part
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link href={`/review?line=${encodeURIComponent(lineId)}`}>
              <ClipboardCheck className="h-3.5 w-3.5" /> Review queue
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link href={`${base}/models`}>
              <Brain className="h-3.5 w-3.5" /> Models
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link href={`/archive?line=${encodeURIComponent(lineId)}`}>
              <Archive className="h-3.5 w-3.5" /> Archive
            </Link>
          </Button>
          {line && <LineFormDialog line={line} />}
        </div>
      </div>
      <EngineNotice />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Parts", line?.part_count],
          ["Unscored", line?.unscored_count],
          ["In review", line?.in_review_count],
          ["Passed", line?.passed_count],
          ["Failed", line?.failed_count],
        ].map(([title, value]) => (
          <Card key={title as string}>
            <CardHeader className="px-4 pt-4 pb-1">
              <CardTitle className="text-xs font-semibold text-muted-foreground">{title}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {detail.isLoading ? <Skeleton className="h-7 w-12" /> : <div className="stat-value">{value ?? 0}</div>}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Score distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {line && <ScoreHistogram scores={line.scores.recent_scores} threshold={line.scores.threshold} />}
            {(unscored.data?.items.length ?? 0) > 0 && line?.active_model_version && (
              <Button size="sm" variant="outline" onClick={scoreUnscored} disabled={scoring}>
                {scoring ? "Scoring..." : `Score ${unscored.data?.items.length} unscored part(s)`}
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <CardTitle className="card-title">{todayOnly ? "Today's parts" : "All parts"}</CardTitle>
            <div className="flex gap-2">
              <Select value={todayOnly ? "today" : "all"} onValueChange={(v) => setTodayOnly(v === "today")}>
                <SelectTrigger className="h-8 w-32" aria-label="Date range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today (UTC)</SelectItem>
                  <SelectItem value="all">All dates</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 w-40" aria-label="Status filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any status</SelectItem>
                  {PART_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PART_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {parts.error ? (
              <ErrorState error={parts.error} onRetry={() => parts.refetch()} />
            ) : parts.isLoading ? (
              <Skeleton className="m-5 h-40" />
            ) : (parts.data?.items.length ?? 0) === 0 ? (
              <EmptyState icon={ListChecks} title="No parts match" description="Capture a part, or widen the filters." />
            ) : (
              <PartsTable items={parts.data?.items ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
