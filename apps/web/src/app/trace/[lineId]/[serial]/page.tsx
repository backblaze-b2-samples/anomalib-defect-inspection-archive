"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EngineNotice } from "@/components/inspection/engine-notice";
import { PartEvidence } from "@/components/inspection/part-evidence";
import { PartStatusBadge } from "@/components/inspection/status-badge";
import { VerdictForm } from "@/components/inspection/verdict-form";
import { formatDateTime, formatPercent, formatScore } from "@/lib/inspection-format";
import { useModels, usePartTrace, useScorePart } from "@/lib/queries";

export default function TracePartPage() {
  const params = useParams<{ lineId: string; serial: string }>();
  const lineId = decodeURIComponent(params.lineId);
  const serial = decodeURIComponent(params.serial);
  const { data: part, isLoading, error, refetch } = usePartTrace(lineId, serial);
  const models = useModels(lineId);
  const score = useScorePart(lineId);
  const ready = (models.data ?? []).filter((m) => m.status === "ready");
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [shownScore, setShownScore] = useState(0);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !part) return <Skeleton className="h-96" />;
  const shown = part.scores[shownScore] ?? part.scores[0];
  const base = `/lines/${encodeURIComponent(lineId)}`;

  const rescore = () =>
    score.mutate(
      { serial, modelVersion: version ?? null },
      {
        onSuccess: (record) => {
          setShownScore(0);
          toast.success(`Re-scored with ${record.model_version}: ${formatScore(record.score)}`);
        },
        onError: (e) => toast.error(e.message),
      },
    );

  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title flex flex-wrap items-center gap-3">
          {part.serial} <PartStatusBadge status={part.status} />
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          <Link className="underline-offset-4 hover:underline" href={base}>
            {lineId}
          </Link>{" "}
          · captured {part.capture_date} ({formatDateTime(part.captured_at)})
          {part.reference ? ` · reference (${part.reference})` : ""} · <code>{part.image_key}</code>
        </p>
      </div>
      <EngineNotice />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">
              Evidence {shown ? `· ${shown.model_version}, score ${formatScore(shown.score)}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <PartEvidence
              serial={part.serial}
              imageUrl={part.image_url}
              heatmapUrl={shown?.heatmap_url ?? null}
              heatmapLabel={shown ? `Heatmap from ${shown.model_version} (${formatDateTime(shown.scored_at)})` : undefined}
            />
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b border-border px-5 py-4">
              <CardTitle className="card-title">{part.verdict ? "Change verdict" : "Record verdict"}</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <VerdictForm lineId={lineId} serial={serial} current={part.verdict} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="border-b border-border px-5 py-4">
              <CardTitle className="card-title">Re-score</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 p-5">
              <Select value={version} onValueChange={setVersion} disabled={ready.length === 0}>
                <SelectTrigger className="w-48" aria-label="Model version">
                  <SelectValue placeholder={ready.length ? "Active version" : "No ready version"} />
                </SelectTrigger>
                <SelectContent>
                  {ready.map((m) => (
                    <SelectItem key={m.version} value={m.version}>
                      {m.version} (threshold {formatScore(m.threshold)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={rescore} disabled={score.isPending || ready.length === 0}>
                {score.isPending ? "Scoring..." : "Re-score"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Score history ({part.scores.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scored</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Threshold</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {part.scores.map((s, i) => (
                  <TableRow key={`${s.scored_at}-${s.model_version}`} aria-selected={i === shownScore}>
                    <TableCell>{formatDateTime(s.scored_at)}</TableCell>
                    <TableCell>
                      <Link className="underline-offset-4 hover:underline" href={`${base}/models/${s.model_version}`}>
                        {s.model_version}
                      </Link>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${s.above_threshold ? "font-semibold" : ""}`}>
                      {formatScore(s.score)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatScore(s.threshold)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setShownScore(i)} disabled={i === shownScore}>
                        Show heatmap
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Verdict history ({part.verdicts.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recorded</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Reviewed score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {part.verdicts.map((v) => (
                  <TableRow key={v.recorded_at}>
                    <TableCell>{formatDateTime(v.recorded_at)}</TableCell>
                    <TableCell className="font-medium">{v.verdict}</TableCell>
                    <TableCell>
                      {v.operator}
                      {v.note && <span className="block text-xs text-muted-foreground">{v.note}</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{v.score_ref ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      {part.model && (
        <p className="text-xs text-muted-foreground">
          Latest score from <strong>{part.model.version}</strong>: {part.model.backbone},{" "}
          {part.model.image_size} px, AUROC {formatPercent(part.model.image_auroc)}, threshold{" "}
          {formatScore(part.model.threshold)} ({part.model.threshold_method}). Score rows come from{" "}
          {part.parquet_keys.length} Parquet file(s) under <code>{`lines/${lineId}/scores/`}</code>.
        </p>
      )}
    </div>
  );
}
