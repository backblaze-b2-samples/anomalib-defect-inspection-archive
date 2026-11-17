"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { binScores, formatScore } from "@/lib/inspection-format";

const chartConfig = {
  parts: { label: "Parts", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Distribution of each part's latest score, with the active threshold noted. */
export function ScoreHistogram({
  scores,
  threshold,
  activeModel,
}: {
  scores: number[];
  threshold: number | null;
  activeModel: string | null | undefined;
}) {
  const data = useMemo(
    () => binScores(scores).map((bin) => ({ score: bin.label, parts: bin.count })),
    [scores],
  );
  if (data.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No scores yet"
        description={
          activeModel
            ? `No part has been scored yet. Score the unscored parts, or capture a new one: ${activeModel} scores it.`
            : "Scores appear once the line has an active model."
        }
      />
    );
  }
  return (
    <div className="space-y-2">
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="score" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} fontSize={11} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="parts" fill="var(--color-parts)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">
        Latest raw PatchCore score per part. Active threshold: {formatScore(threshold)} (parts at or
        above it go to review).
      </p>
    </div>
  );
}
