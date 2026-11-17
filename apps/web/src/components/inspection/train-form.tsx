"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { TrainingSource } from "@anomalib-defect-inspection-archive/shared";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EngineFacts } from "@/components/inspection/engine-notice";
import {
  CORESET_RATIOS,
  IMAGE_SIZES,
  TRAINING_SOURCE_LABELS,
  captureReferencesHref,
} from "@/lib/inspection-format";
import { useEngine, useTrainModel } from "@/lib/queries";

type ImageSize = (typeof IMAGE_SIZES)[number];
type CoresetRatio = (typeof CORESET_RATIOS)[number];

/**
 * "Train new version": every finite option is a selector, defaults pre-chosen.
 * Disabled while `busyVersion` (a queued or training run of this line) is in
 * flight, so one click cannot stack a second run behind it by accident.
 */
export function TrainForm({
  lineId,
  busyVersion,
  blockedReason,
  autoFocus,
}: {
  lineId: string;
  busyVersion?: string;
  /** Why training cannot start yet (too few known-good references), or null. */
  blockedReason?: string | null;
  /** Focus the Train button (deep link `?train=1`). */
  autoFocus?: boolean;
}) {
  const [source, setSource] = useState<TrainingSource>("reference_and_adjudicated");
  const [imageSize, setImageSize] = useState<ImageSize>(256);
  const [coreset, setCoreset] = useState<CoresetRatio>(0.1);
  const [note, setNote] = useState("");
  const train = useTrainModel(lineId);
  const { data: engine } = useEngine();

  const submit = () =>
    train.mutate(
      { source, image_size: imageSize, coreset_ratio: coreset, note: note || null },
      {
        onSuccess: (model) => {
          toast.success(`Training ${model.version} queued`, {
            description: "Images are read back from B2; the Versions table shows each stage.",
          });
          setNote("");
        },
        onError: (error) => toast.error(error.message),
      },
    );

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Training images</Label>
        <RadioGroup
          value={source}
          onValueChange={(value) => setSource(value as TrainingSource)}
          className="space-y-1"
        >
          {(Object.keys(TRAINING_SOURCE_LABELS) as TrainingSource[]).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={value} /> {TRAINING_SOURCE_LABELS[value]}
            </label>
          ))}
        </RadioGroup>
        <p className="text-xs text-muted-foreground">
          Adjudicated parts: a <strong>pass</strong> joins the normal training images, a{" "}
          <strong>fail</strong> joins the evaluation split as anomalous.
        </p>
      </div>
      <div className="space-y-2">
        <Label id="image-size-label">Image size</Label>
        <div role="radiogroup" aria-labelledby="image-size-label" className="inline-flex rounded-md border border-border p-0.5">
          {IMAGE_SIZES.map((size) => (
            <Toggle
              key={size}
              role="radio"
              aria-checked={imageSize === size}
              pressed={imageSize === size}
              onPressedChange={() => setImageSize(size)}
              size="sm"
            >
              {size} px
            </Toggle>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="coreset">Coreset ratio</Label>
        <Select value={String(coreset)} onValueChange={(v) => setCoreset(Number(v) as CoresetRatio)}>
          <SelectTrigger id="coreset" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CORESET_RATIOS.map((ratio) => (
              <SelectItem key={ratio} value={String(ratio)}>
                {ratio}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Share of patch features kept in memory. 0.1 suits a small reference set on CPU; lower
          values give a smaller model for large sets.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="train-note">Note (optional)</Label>
        <Textarea
          id="train-note"
          rows={2}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why this version?"
        />
      </div>
      <div className="space-y-1.5">
        <Button
          size="sm"
          onClick={submit}
          autoFocus={autoFocus && !blockedReason}
          aria-describedby={blockedReason ? "train-blocked" : undefined}
          disabled={
            train.isPending || !!busyVersion || !!blockedReason || engine?.ml_available === false
          }
        >
          {train.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Queuing...
            </>
          ) : busyVersion ? (
            `Training ${busyVersion}...`
          ) : (
            "Train new version"
          )}
        </Button>
        {busyVersion && (
          <p className="text-xs text-muted-foreground">
            Available again when {busyVersion} finishes.
          </p>
        )}
        {blockedReason && !busyVersion && (
          <p id="train-blocked" className="text-xs text-muted-foreground">
            {blockedReason}{" "}
            <Link className="font-medium text-foreground underline underline-offset-4" href={captureReferencesHref(lineId)}>
              Capture known-good references
            </Link>
          </p>
        )}
        {train.error && !train.isPending && (
          <p role="alert" className="text-xs text-destructive">
            {train.error.message}
          </p>
        )}
        <EngineFacts />
      </div>
    </div>
  );
}
