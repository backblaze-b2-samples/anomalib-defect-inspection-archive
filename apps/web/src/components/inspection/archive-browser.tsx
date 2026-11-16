"use client";

/* eslint-disable @next/next/no-img-element -- presigned B2 URLs expire; next/image would cache them */
import { useMemo, useState } from "react";
import Link from "next/link";
import { FolderArchive } from "lucide-react";
import type { ArchiveItem, ArchiveKind } from "@anomalib-defect-inspection-archive/shared";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { LineSelect } from "@/components/inspection/line-select";
import { tracePath } from "@/components/inspection/parts-table";
import { ARCHIVE_KIND_LABELS, formatBytes, formatDateTime } from "@/lib/inspection-format";
import { useArchive } from "@/lib/queries";

const LATEST = "__latest__";
type View = "parts" | Exclude<ArchiveKind, "images" | "heatmaps">;

function serialOf(key: string): string {
  return key.split("/").pop()!.split(".")[0];
}

/** Scoped explorer for `lines/`: paired image/heatmap grid, plus record folders. */
export function ArchiveBrowser({ defaultLineId }: { defaultLineId?: string }) {
  const [lineId, setLineId] = useState<string | undefined>(defaultLineId);
  const [date, setDate] = useState<string>(LATEST);
  const [view, setView] = useState<View>("parts");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const dateParam = date === LATEST ? undefined : date;
  const kind: ArchiveKind = view === "parts" ? "images" : view;
  const page = useArchive({ lineId, date: dateParam, kind, cursor });
  const heatmaps = useArchive({
    lineId: page.data?.date ? lineId : undefined,
    date: page.data?.date ?? undefined,
    kind: "heatmaps",
  });
  const resolvedLine = lineId;

  const heatmapsBySerial = useMemo(() => {
    const map = new Map<string, ArchiveItem>();
    for (const item of heatmaps.data?.items ?? []) {
      map.set(serialOf(item.key), item); // keys sort by version; the last wins
    }
    return map;
  }, [heatmaps.data]);

  const reset = (next: () => void) => {
    next();
    setCursor(undefined);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="archive-line">Line</Label>
          <LineSelect id="archive-line" value={lineId} onChange={(v) => reset(() => setLineId(v))} />
        </div>
        {view === "parts" && (
          <div className="space-y-1.5">
            <Label htmlFor="archive-date">Capture date</Label>
            <Select value={date} onValueChange={(v) => reset(() => setDate(v))}>
              <SelectTrigger id="archive-date" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LATEST}>Latest</SelectItem>
                {(page.data?.dates ?? []).map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Tabs value={view} onValueChange={(v) => reset(() => setView(v as View))}>
          <TabsList>
            <TabsTrigger value="parts">Images + heatmaps</TabsTrigger>
            {(["scores", "labels", "models"] as const).map((k) => (
              <TabsTrigger key={k} value={k}>
                {ARCHIVE_KIND_LABELS[k]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {page.error ? (
        <ErrorState error={page.error} onRetry={() => page.refetch()} />
      ) : page.isLoading ? (
        <Skeleton className="h-64" />
      ) : (page.data?.items.length ?? 0) === 0 ? (
        <EmptyState icon={FolderArchive} title="Nothing here yet" description="Capture parts on a line to fill its archive." />
      ) : view === "parts" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {page.data?.items.map((item) => {
            const serial = serialOf(item.key);
            const heat = heatmapsBySerial.get(serial);
            return (
              <Card key={item.key}>
                <CardContent className="space-y-2 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <img src={item.url} alt={`Part ${serial}`} className="aspect-square w-full rounded border border-border object-contain" />
                    {heat ? (
                      <img src={heat.url} alt={`Heatmap of ${serial}`} className="aspect-square w-full rounded border border-border object-contain" />
                    ) : (
                      <div className="flex aspect-square items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
                        unscored
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    {resolvedLine ? (
                      <Link className="font-medium underline-offset-4 hover:underline" href={tracePath(resolvedLine, serial)}>
                        {serial}
                      </Link>
                    ) : (
                      <span className="font-medium">{serial}</span>
                    )}
                    <span className="text-muted-foreground">{formatBytes(item.size)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Modified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.data?.items.map((item) => (
                  <TableRow key={item.key}>
                    <TableCell className="font-mono text-xs">
                      <a className="underline-offset-4 hover:underline" href={item.url} target="_blank" rel="noreferrer">
                        {item.key}
                      </a>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatBytes(item.size)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(item.last_modified)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {page.data?.next_cursor && (
        <Button variant="outline" size="sm" onClick={() => setCursor(page.data?.next_cursor ?? undefined)}>
          Next page
        </Button>
      )}
    </div>
  );
}
