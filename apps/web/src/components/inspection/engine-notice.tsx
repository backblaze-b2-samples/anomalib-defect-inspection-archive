"use client";

import { Cpu } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEngine } from "@/lib/queries";

/** Shown wherever scoring or training is offered and the ML extra is missing. */
export function EngineNotice() {
  const { data } = useEngine();
  if (!data || data.ml_available) return null;
  return (
    <Alert>
      <Cpu />
      <AlertTitle>The anomaly engine is not installed</AlertTitle>
      <AlertDescription>
        <span>
          Captures are still stored in B2 and stay <strong>Unscored</strong>. To score and
          train, run <code>pnpm setup:ml</code> and restart the API.
        </span>
      </AlertDescription>
    </Alert>
  );
}

/** One line of engine facts: backbone, device, Anomalib version. */
export function EngineFacts() {
  const { data } = useEngine();
  if (!data) return null;
  return (
    <p className="text-xs text-muted-foreground">
      PatchCore on <code>{data.weights}</code> · device {data.device}
      {data.anomalib_version ? ` · Anomalib ${data.anomalib_version}` : ""}
    </p>
  );
}
