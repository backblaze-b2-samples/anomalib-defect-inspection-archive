"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ModelStatusBadge } from "@/components/inspection/status-badge";
import { tracePath } from "@/components/inspection/parts-table";
import { formatDateTime, formatPercent, formatScore } from "@/lib/inspection-format";
import { useModelDetail } from "@/lib/queries";

export default function ModelDetailPage() {
  const { lineId, version } = useParams<{ lineId: string; version: string }>();
  const { data: model, isLoading, error, refetch } = useModelDetail(lineId, version);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !model) return <Skeleton className="h-64" />;

  const facts: [string, string][] = [
    ["Backbone", model.backbone],
    ["Image size", `${model.image_size} px`],
    ["Coreset ratio", String(model.coreset_ratio)],
    ["Training source", model.source],
    ["Train / eval images", `${model.train_image_count} / ${model.eval_image_count}`],
    ["Threshold", `${formatScore(model.threshold)} (${model.threshold_method ?? "-"})`],
    ["Image AUROC", formatPercent(model.image_auroc)],
    ["Image F1 at threshold", formatPercent(model.image_f1)],
    ["Trained from", model.parent_version ? `${model.parent_version} was active` : "first version"],
    ["Anomalib", model.anomalib_version ?? "-"],
    ["Created", formatDateTime(model.created_at)],
    ["Finished", formatDateTime(model.finished_at)],
  ];

  return (
    <div className="space-y-8">
      <div className="animate-fade-in flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="page-title flex items-center gap-3">
            {lineId} / {model.version} <ModelStatusBadge status={model.status} />
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            <Link className="underline-offset-4 hover:underline" href={`/lines/${encodeURIComponent(lineId)}/models`}>
              All versions
            </Link>
            {model.note ? ` · ${model.note}` : ""}
          </p>
          {model.error && <p className="mt-2 text-sm text-destructive">{model.error}</p>}
        </div>
        <div className="flex gap-2">
          {model.checkpoint_url && (
            <Button asChild size="sm" variant="outline" className="h-8">
              <a href={model.checkpoint_url}>
                <Download className="h-3.5 w-3.5" /> model.ckpt
              </a>
            </Button>
          )}
          {model.metrics_url && (
            <Button asChild size="sm" variant="outline" className="h-8">
              <a href={model.metrics_url} target="_blank" rel="noreferrer">
                <Download className="h-3.5 w-3.5" /> metrics.json
              </a>
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Configuration and metrics</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Training-set manifest ({model.training_set.length})</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[480px] overflow-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serial</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>ETag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.training_set.map((entry) => (
                  <TableRow key={entry.key}>
                    <TableCell>
                      <Link className="underline-offset-4 hover:underline" href={tracePath(lineId, entry.serial)}>
                        {entry.serial}
                      </Link>
                    </TableCell>
                    <TableCell>{entry.role}</TableCell>
                    <TableCell>{entry.label}</TableCell>
                    <TableCell>{entry.source}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={entry.key}>
                      {entry.etag.slice(0, 12)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
