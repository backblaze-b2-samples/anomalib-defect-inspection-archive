/* eslint-disable @next/next/no-img-element -- presigned B2 URLs expire; next/image would cache them */
import { ImageOff } from "lucide-react";

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
        <img
          src={imageUrl}
          alt={`Captured image of part ${serial}`}
          className="aspect-square w-full rounded-md border border-border bg-muted object-contain"
        />
        <figcaption className="text-xs text-muted-foreground">Captured image</figcaption>
      </figure>
      <figure className="space-y-1.5">
        {heatmapUrl ? (
          <img
            src={heatmapUrl}
            alt={`Anomaly heatmap of part ${serial}`}
            className="aspect-square w-full rounded-md border border-border bg-muted object-contain"
          />
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
