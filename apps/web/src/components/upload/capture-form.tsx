"use client";

import { useState } from "react";
import Link from "next/link";
import type { FileRejection } from "react-dropzone";
import { toast } from "sonner";
import type { InspectionRecord, ReferenceLabel } from "@anomalib-defect-inspection-archive/shared";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dropzone } from "@/components/upload/dropzone";
import { EngineNotice } from "@/components/inspection/engine-notice";
import { LineSelect } from "@/components/inspection/line-select";
import { PartEvidence } from "@/components/inspection/part-evidence";
import { tracePath } from "@/components/inspection/parts-table";
import { PartStatusBadge } from "@/components/inspection/status-badge";
import { formatScore } from "@/lib/inspection-format";
import { useCapturePart } from "@/lib/queries";
import { CAPTURE_FILE_TYPES, CAPTURE_MAX_BYTES } from "@/lib/upload-file-types";

const SERIAL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const NOT_REFERENCE = "none";

/**
 * Capture: choose a line and a serial, drop one image. The browser PUTs it
 * straight to `lines/<line>/<date>/images/<serial>.png` in B2 with a presigned
 * URL, then the API registers and scores it with the line's active model.
 */
export function CaptureForm({ defaultLineId }: { defaultLineId?: string }) {
  const [lineId, setLineId] = useState<string | undefined>(defaultLineId);
  const [serial, setSerial] = useState("");
  const [reference, setReference] = useState<string>(NOT_REFERENCE);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<InspectionRecord | null>(null);
  const capture = useCapturePart(setProgress);

  const serialValid = SERIAL_PATTERN.test(serial) && !/^\.+$/.test(serial);
  const canSubmit = !!lineId && serialValid && !!file && !capture.isPending;

  const onRejected = (rejections: FileRejection[]) =>
    toast.error(rejections[0]?.errors[0]?.message ?? "Only PNG or JPEG images up to 20 MB");

  const submit = () => {
    if (!lineId || !file) return;
    setProgress(0);
    capture.mutate(
      {
        lineId,
        serial,
        file,
        reference: reference === NOT_REFERENCE ? null : (reference as ReferenceLabel),
      },
      {
        onSuccess: (record) => {
          setResult(record);
          setSerial("");
          setFile(null);
          toast.success(`Captured ${record.serial}`, {
            description:
              record.status === "unscored"
                ? "Stored in B2. It will be scored once the line has a model."
                : `Score ${formatScore(record.score)} against threshold ${formatScore(record.threshold)}.`,
          });
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader className="border-b border-border py-4 px-5">
          <CardTitle className="card-title">Capture a part</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          <EngineNotice />
          <div className="space-y-2">
            <Label htmlFor="capture-line">Line</Label>
            <LineSelect id="capture-line" value={lineId} onChange={setLineId} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="capture-serial">Serial</Label>
            <Input
              id="capture-serial"
              value={serial}
              onChange={(e) => setSerial(e.target.value.trim())}
              placeholder="e.g. CNDL-000123"
              autoComplete="off"
              aria-invalid={serial !== "" && !serialValid}
            />
            <p className="text-xs text-muted-foreground">
              Letters, digits, dot, dash or underscore. Unique per line; it names the image key.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="capture-reference">Reference image</Label>
            <Select value={reference} onValueChange={setReference}>
              <SelectTrigger id="capture-reference" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_REFERENCE}>No, a production part</SelectItem>
                <SelectItem value="normal">Yes, a known-good part</SelectItem>
                <SelectItem value="anomalous">Yes, a known-defective part</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Reference images seed training: good ones train the model, defective ones evaluate it.
            </p>
          </div>
          <Dropzone
            accept={CAPTURE_FILE_TYPES}
            maxSize={CAPTURE_MAX_BYTES}
            multiple={false}
            disabled={capture.isPending}
            onFilesSelected={(files) => setFile(files[0] ?? null)}
            onFilesRejected={onRejected}
            idleTitle={file ? file.name : "Drop one part image, or click to browse"}
            idleDescription="PNG or JPEG, up to 20 MB. JPEG is stored as PNG."
          />
          {capture.isPending && <Progress value={progress} aria-label="Upload progress" />}
          <Button onClick={submit} disabled={!canSubmit}>
            {capture.isPending ? (progress < 100 ? "Uploading to B2..." : "Scoring...") : "Capture and score"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="border-b border-border py-4 px-5">
          <CardTitle className="card-title">Last capture</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          {result ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Link className="font-medium underline-offset-4 hover:underline" href={tracePath(result.line_id, result.serial)}>
                  {result.serial}
                </Link>
                <PartStatusBadge status={result.status} />
                <span className="tabular-nums text-muted-foreground">
                  score {formatScore(result.score)} / threshold {formatScore(result.threshold)}
                </span>
              </div>
              <PartEvidence serial={result.serial} imageUrl={result.image_url} heatmapUrl={result.heatmap_url} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              The captured image and its heatmap appear here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
