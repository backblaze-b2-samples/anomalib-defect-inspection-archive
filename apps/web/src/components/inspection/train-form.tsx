"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import { CORESET_RATIOS, IMAGE_SIZES, TRAINING_SOURCE_LABELS } from "@/lib/inspection-format";
import { useEngine, useTrainModel } from "@/lib/queries";

type ImageSize = (typeof IMAGE_SIZES)[number];
type CoresetRatio = (typeof CORESET_RATIOS)[number];

/** "Train new version": every finite option is a selector, defaults pre-chosen. */
export function TrainForm({ lineId }: { lineId: string }) {
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
            description: "Images are read back from B2; the list updates when it finishes.",
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
        <Button size="sm" onClick={submit} disabled={train.isPending || engine?.ml_available === false}>
          {train.isPending ? "Queuing..." : "Train new version"}
        </Button>
        <EngineFacts />
      </div>
    </div>
  );
}
