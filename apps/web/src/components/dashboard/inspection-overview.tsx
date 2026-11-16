"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ClipboardCheck,
  ScanSearch,
  XCircle,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingNotice } from "@/components/common/loading-notice";
import { PartsTable } from "@/components/inspection/parts-table";
import { ARCHIVE_KIND_LABELS, formatBytes } from "@/lib/inspection-format";
import { useInspectionStats } from "@/lib/queries";
import type { ArchiveKind } from "@anomalib-defect-inspection-archive/shared";

const chartConfig = {
  parts: { label: "Parts", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function InspectionOverview() {
  const { data: stats, isLoading, error, refetch } = useInspectionStats();

  const perDay = useMemo(
    () =>
      (stats?.parts_per_day ?? []).map((d) => ({
        date: new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
        parts: d.count,
      })),
    [stats],
  );

  if (error) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  const cards = [
    { title: "Parts inspected", value: stats?.parts_inspected, icon: ScanSearch },
    { title: "Above threshold", value: stats?.above_threshold, icon: AlertTriangle },
    { title: "Review backlog", value: stats?.review_backlog, icon: ClipboardCheck },
    { title: "Passed", value: stats?.passed, icon: CheckCircle2 },
    { title: "Failed", value: stats?.failed, icon: XCircle },
    { title: "Model versions", value: stats?.model_versions, icon: Brain },
  ];
  const totalBytes = Object.values(stats?.bytes_by_kind ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {isLoading && <LoadingNotice subject="inspection stats" />}
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((card, i) => (
          <Card key={card.title} className={`card-hover animate-fade-in-up stagger-${(i % 4) + 1}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pt-4 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground">{card.title}</CardTitle>
              <div className="stat-icon-wrap">
                <card.icon className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-5">
              {isLoading ? <Skeleton className="h-8 w-16" /> : <div className="stat-value">{card.value ?? 0}</div>}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Parts per day</CardTitle>
            <CardDescription className="text-xs">Captures by UTC date, last 14 days</CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            {isLoading ? (
              <Skeleton className="h-[220px]" />
            ) : (
              <ChartContainer config={chartConfig} className="h-[220px] w-full">
                <BarChart data={perDay} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="parts" fill="var(--color-parts)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border px-5 py-4">
            <CardTitle className="card-title">Archive in B2</CardTitle>
            <CardDescription className="text-xs">{formatBytes(totalBytes)} under lines/</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {(Object.keys(ARCHIVE_KIND_LABELS) as ArchiveKind[]).map((kind) => {
              const bytes = stats?.bytes_by_kind[kind] ?? 0;
              const share = totalBytes ? (bytes / totalBytes) * 100 : 0;
              return (
                <div key={kind} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{ARCHIVE_KIND_LABELS[kind]}</span>
                    <span className="tabular-nums text-muted-foreground">{formatBytes(bytes)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${share}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="border-b border-border px-5 py-4">
          <CardTitle className="card-title">Recent parts above threshold</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <Skeleton className="m-5 h-24" />
          ) : (stats?.recent_above_threshold.length ?? 0) === 0 ? (
            <EmptyState icon={ScanSearch} title="No flagged parts yet" description="Parts scoring at or above their model's threshold show up here." />
          ) : (
            <PartsTable items={stats?.recent_above_threshold ?? []} showLine />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
