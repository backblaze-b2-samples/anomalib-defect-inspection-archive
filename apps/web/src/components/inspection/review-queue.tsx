"use client";

import { useState } from "react";
import Link from "next/link";
import { Brain, Camera, ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ALL_LINES, LineSelect } from "@/components/inspection/line-select";
import { PartEvidence } from "@/components/inspection/part-evidence";
import { tracePath } from "@/components/inspection/parts-table";
import { VerdictForm } from "@/components/inspection/verdict-form";
import { formatDateTime, formatScore, pickReviewItem, reviewItemId } from "@/lib/inspection-format";
import { useReviewQueue } from "@/lib/queries";

/**
 * Flagged parts, oldest first; each opens a verdict panel. `defaultSerial`
 * (from "Open in review queue" after a capture) pre-selects that part instead
 * of the oldest one.
 */
export function ReviewQueue({
  defaultLineId,
  defaultSerial,
}: {
  defaultLineId?: string;
  defaultSerial?: string;
}) {
  const [lineId, setLineId] = useState<string>(defaultLineId ?? ALL_LINES);
  const [selected, setSelected] = useState<string | null>(
    defaultLineId && defaultSerial ? reviewItemId({ line_id: defaultLineId, serial: defaultSerial }) : null,
  );
  const filter = lineId === ALL_LINES ? undefined : lineId;
  const { data: queue, isLoading, error, refetch } = useReviewQueue(filter);
  const current = pickReviewItem(queue, selected);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Label htmlFor="review-line">Line</Label>
        <LineSelect id="review-line" value={lineId} onChange={setLineId} allowAll />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-64" />
      ) : !queue || queue.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing to review"
          description="Parts whose score reaches the threshold land here until an operator records a verdict. Verdicts already recorded feed the next training run."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {filter && (
                <Button asChild size="sm" className="h-8">
                  <Link href={`/lines/${encodeURIComponent(filter)}/models`}>
                    <Brain className="h-3.5 w-3.5" /> Train a new version from verdicts
                  </Link>
                </Button>
              )}
              <Button asChild size="sm" variant={filter ? "outline" : "default"} className="h-8">
                <Link href={filter ? `/upload?line=${encodeURIComponent(filter)}` : "/upload"}>
                  <Camera className="h-3.5 w-3.5" /> Capture part
                </Link>
              </Button>
              {!filter && (
                <Button asChild size="sm" variant="outline" className="h-8">
                  <Link href="/lines">
                    <Brain className="h-3.5 w-3.5" /> Lines and models
                  </Link>
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card>
            <CardHeader className="border-b border-border px-5 py-4">
              <CardTitle className="card-title">{queue.length} waiting (oldest first)</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[640px] overflow-auto p-2">
              <ul className="space-y-1">
                {queue.map((item) => {
                  const id = reviewItemId(item);
                  const active = current && id === reviewItemId(current);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setSelected(id)}
                        aria-current={active ? "true" : undefined}
                        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${active ? "bg-muted font-medium" : "hover:bg-muted/60"}`}
                      >
                        <span>
                          {item.serial}
                          <span className="ml-2 text-xs text-muted-foreground">{item.line_id}</span>
                        </span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {formatScore(item.score)} / {formatScore(item.threshold)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
          {current && (
            <Card>
              <CardHeader className="border-b border-border px-5 py-4">
                <CardTitle className="card-title">
                  <Link className="underline-offset-4 hover:underline" href={tracePath(current.line_id, current.serial)}>
                    {current.serial}
                  </Link>{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    score {formatScore(current.score)} vs threshold {formatScore(current.threshold)} ·{" "}
                    {current.model_version} · captured {formatDateTime(current.captured_at)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 p-5">
                <PartEvidence serial={current.serial} imageUrl={current.image_url} heatmapUrl={current.heatmap_url} />
                <VerdictForm
                  key={`${current.line_id}/${current.serial}`}
                  lineId={current.line_id}
                  serial={current.serial}
                  current={current.verdict}
                  onDone={() => setSelected(null)}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
