import { ImageOff } from "lucide-react";

import { EvidenceImage } from "@/components/inspection/evidence-image";

interface PartEvidenceProps {
  serial: string;
  imageUrl: string;
  heatmapUrl: string | null;
  heatmapLabel?: string;
}

/** The captured image and its anomaly heatmap, side by side. */
export function PartEvidence({ serial, imageUrl, heatmapUrl, heatmapLabel }: PartEvidenceProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <figure className="space-y-1.5">
        <EvidenceImage src={imageUrl} alt={`Captured image of part ${serial}`} />
        <figcaption className="text-xs text-muted-foreground">Captured image</figcaption>
      </figure>
      <figure className="space-y-1.5">
        {heatmapUrl ? (
          <EvidenceImage src={heatmapUrl} alt={`Anomaly heatmap of part ${serial}`} />
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-muted-foreground">
            <ImageOff className="h-5 w-5" aria-hidden />
            <span className="text-xs">Not scored yet</span>
          </div>
        )}
        <figcaption className="text-xs text-muted-foreground">
          {heatmapLabel ?? "Anomaly heatmap (red = far from normal)"}
        </figcaption>
      </figure>
    </div>
  );
}
