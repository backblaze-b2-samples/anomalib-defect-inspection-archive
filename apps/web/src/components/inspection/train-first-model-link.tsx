"use client";

import Link from "next/link";
import { Brain, Camera } from "lucide-react";

import { Button } from "@/components/ui/button";
import { captureReferencesHref, trainModelHref } from "@/lib/inspection-format";
import { useLineDetail } from "@/lib/queries";

/**
 * "Train the first model": straight to the focused Train form when the line has
 * enough known-good references, else to capturing them (reference mode).
 */
export function TrainFirstModelLink({ lineId }: { lineId: string }) {
  const { data: line } = useLineDetail(lineId);
  const missing = line ? line.min_normal_references - line.normal_reference_count : 0;
  if (missing > 0) {
    return (
      <Button asChild size="sm" className="h-8">
        <Link href={captureReferencesHref(lineId)}>
          <Camera className="h-3.5 w-3.5" /> Capture {missing} more known-good reference
          {missing === 1 ? "" : "s"}
        </Link>
      </Button>
    );
  }
  return (
    <Button asChild size="sm" className="h-8">
      <Link href={trainModelHref(lineId)}>
        <Brain className="h-3.5 w-3.5" /> Train the first model
      </Link>
    </Button>
  );
}
