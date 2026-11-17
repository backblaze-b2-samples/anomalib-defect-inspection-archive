"use client";

/* eslint-disable @next/next/no-img-element -- presigned B2 URLs expire; next/image would cache them */
import { useCallback, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { EVIDENCE_MAX_RETRIES, evidenceRetryDelay } from "@/lib/inspection-format";
import { cn } from "@/lib/utils";

interface EvidenceImageProps {
  src: string;
  alt: string;
  className?: string;
  /**
   * Defer loading until the image nears the viewport. Only for long grids
   * (the archive); a single part's evidence loads eagerly, since a lazy image
   * is fetched at low priority and could sit behind a grey placeholder.
   */
  lazy?: boolean;
}

/**
 * A B2 image that shows a pulsing placeholder until it has loaded (full-size
 * part images can take seconds each), and says so when the presigned URL fails
 * instead of leaving a blank box.
 *
 * Keyed by `src`, so a new URL always starts from a fresh placeholder instead
 * of inheriting the previous image's loaded/error state.
 */
export function EvidenceImage(props: EvidenceImageProps) {
  return <EvidenceImageFor key={props.src} {...props} />;
}

function EvidenceImageFor({ src, alt, className, lazy = false }: EvidenceImageProps) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  // An image served from cache can finish before React's onLoad listener sees
  // it; read `complete` on mount so the placeholder never sticks.
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setState("loaded");
  }, []);

  // A heatmap URL is handed out right after its object is written, and a
  // just-written object can briefly 404: retry a few times before giving up.
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!retrying) return;
    const timer = setTimeout(() => {
      setRetrying(false);
      setAttempt((n) => n + 1);
    }, evidenceRetryDelay(attempt));
    return () => clearTimeout(timer);
  }, [retrying, attempt]);

  const onError = () => {
    if (attempt < EVIDENCE_MAX_RETRIES) setRetrying(true);
    else setState("error");
  };

  return (
    <div className={cn("relative aspect-square w-full overflow-hidden rounded-md border border-border bg-muted", className)}>
      {state === "loading" && <Skeleton className="absolute inset-0 rounded-none" aria-hidden />}
      {state === "error" ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
          <ImageOff className="h-4 w-4" aria-hidden />
          Could not load image
        </div>
      ) : (
        !retrying && (
          <img
            // A retry remounts the element, so the browser requests the URL again.
            key={attempt}
            ref={imgRef}
            src={src}
            alt={alt}
            loading={lazy ? "lazy" : "eager"}
            decoding="async"
            onLoad={() => setState("loaded")}
            onError={onError}
            className={cn(
              "h-full w-full object-contain transition-opacity",
              state === "loaded" ? "opacity-100" : "opacity-0",
            )}
          />
        )
      )}
    </div>
  );
}
