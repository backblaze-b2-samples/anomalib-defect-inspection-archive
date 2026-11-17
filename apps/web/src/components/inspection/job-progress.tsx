"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { formatElapsed, progressValueProps } from "@/lib/inspection-format";

interface JobProgressProps {
  /** The stage, in words ("Training PatchCore", "Scoring part 3 of 14 with v1"). */
  label: string;
  /** Determinate progress when known; the spinner alone otherwise. */
  percent?: number | null;
  /** ISO time the job started, for a ticking elapsed clock. */
  startedAt?: string | null;
  hint?: string;
}

/** A visibly animating, named stage for a server-side job that takes seconds. */
export function JobProgress({ label, percent = null, startedAt, hint }: JobProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const started = startedAt ? Date.parse(startedAt) : NaN;

  return (
    <div role="status" aria-live="polite" className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
        <span className="font-medium">{label}</span>
        {Number.isFinite(started) && (
          <span className="ml-auto tabular-nums text-xs text-muted-foreground">
            {formatElapsed(now - started)}
          </span>
        )}
      </div>
      {percent !== null && (
        <div className="flex items-center gap-2">
          <Progress value={percent} aria-label={label} {...progressValueProps(percent)} />
          <span className="w-9 shrink-0 text-right tabular-nums text-xs text-muted-foreground">
            {percent}%
          </span>
        </div>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
