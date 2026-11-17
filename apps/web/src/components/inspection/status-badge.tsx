import type { ModelStatus, PartStatus } from "@anomalib-defect-inspection-archive/shared";

import { Badge } from "@/components/ui/badge";
import { MODEL_STATUS_LABELS, PART_STATUS_LABELS } from "@/lib/inspection-format";

const PART_VARIANT: Record<PartStatus, "default" | "secondary" | "destructive" | "outline"> = {
  unscored: "outline",
  below_threshold: "secondary",
  in_review: "default",
  passed: "secondary",
  failed: "destructive",
  reference: "outline",
};

export function PartStatusBadge({ status }: { status: PartStatus }) {
  return <Badge variant={PART_VARIANT[status]}>{PART_STATUS_LABELS[status]}</Badge>;
}

const MODEL_VARIANT: Record<ModelStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  training: "default",
  ready: "secondary",
  failed: "destructive",
  interrupted: "destructive",
};

export function ModelStatusBadge({ status }: { status: ModelStatus }) {
  return <Badge variant={MODEL_VARIANT[status]}>{MODEL_STATUS_LABELS[status]}</Badge>;
}
