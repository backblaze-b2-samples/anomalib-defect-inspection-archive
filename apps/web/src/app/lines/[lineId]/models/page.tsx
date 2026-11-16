"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Brain } from "lucide-react";

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
import { ModelStatusBadge } from "@/components/inspection/status-badge";
import { TrainForm } from "@/components/inspection/train-form";
import { formatDateTime, formatPercent, formatScore } from "@/lib/inspection-format";
import { useActivateModel, useLineDetail, useModels } from "@/lib/queries";

export default function ModelsPage() {
  const { lineId } = useParams<{ lineId: string }>();
  const line = useLineDetail(lineId);
  const models = useModels(lineId);
  const activate = useActivateModel(lineId);
  const active = line.data?.active_model_version;
  const base = `/lines/${encodeURIComponent(lineId)}`;

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
            {lineId}
          </Link>{" "}
          · PatchCore versions trained from images read back from B2, each stored with its
          checkpoint, metrics and training-set manifest.
        </p>
      </div>
      <EngineNotice />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Versions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {models.error ? (
              <ErrorState error={models.error} onRetry={() => models.refetch()} />
            ) : models.isLoading ? (
              <Skeleton className="m-5 h-32" />
            ) : (models.data?.length ?? 0) === 0 ? (
              <EmptyState icon={Brain} title="No model yet" description="Train the first version from the line's reference images." />
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
                        {m.version === active && <span className="ml-2 text-xs text-muted-foreground">active</span>}
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
                        {m.status === "ready" && m.version !== active && (
                          <Button size="sm" variant="outline" onClick={() => onActivate(m.version)} disabled={activate.isPending}>
                            Activate
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Train new version</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <TrainForm lineId={lineId} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
