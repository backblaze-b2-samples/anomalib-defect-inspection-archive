"use client";

import { useState } from "react";
import Link from "next/link";
import type { FileRejection } from "react-dropzone";
import { toast } from "sonner";
import { ClipboardCheck, Loader2, Search } from "lucide-react";
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
import { JobProgress } from "@/components/inspection/job-progress";
import { LineSelect } from "@/components/inspection/line-select";
import { PartEvidence } from "@/components/inspection/part-evidence";
import { tracePath } from "@/components/inspection/parts-table";
import { PartStatusBadge } from "@/components/inspection/status-badge";
import { TrainFirstModelLink } from "@/components/inspection/train-first-model-link";
import {
  batchStamp,
  captureBlockedReason,
  captureButtonLabel,
  defaultReferencePrefix,
  formatScore,
  progressValueProps,
  referenceSerials,
  reviewQueueHref,
} from "@/lib/inspection-format";
import { useCapturePart, useLines } from "@/lib/queries";
import { CAPTURE_FILE_TYPES, CAPTURE_MAX_BYTES } from "@/lib/upload-file-types";

const SERIAL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const NOT_REFERENCE = "none";

/**
 * Capture: choose a line and a serial, drop one image. The browser PUTs it
 * straight to `lines/<line>/<date>/images/<serial>.png` in B2 with a presigned
 * URL, then the API registers and scores it with the line's active model.
 *
 * Reference images can come in a batch: several files share a serial prefix
 * (<prefix>-001, -002, ...) and upload one after another through the same
 * per-part flow. A production part is always one image with its own serial.
 */
export function CaptureForm({
  defaultLineId,
  defaultReference,
}: {
  defaultLineId?: string;
  /** From `?reference=` ("Capture reference images" links): opens in reference mode. */
  defaultReference?: ReferenceLabel;
}) {
  const [lineId, setLineId] = useState<string | undefined>(defaultLineId);
  const [typedSerial, setTypedSerial] = useState("");
  // Until the user types one, a reference batch gets a serial prefix named
  // after its line ("LINE-01-GOOD"), so the button is not blocked on it.
  const [serialEdited, setSerialEdited] = useState(false);
  const [reference, setReference] = useState<string>(defaultReference ?? NOT_REFERENCE);
  // Taken when images are chosen (never during SSR, so server and client
  // render the same input value) and so renewed per batch: one batch's
  // default serials cannot collide with the last one's.
  const [stamp, setStamp] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<InspectionRecord | null>(null);
  const capture = useCapturePart(setProgress);
  const { data: lines } = useLines();
  const activeModel = lines?.find((line) => line.line_id === lineId)?.active_model_version ?? null;
  const busy = capture.isPending || batch !== null;
  const uploaded = capture.isPending && progress >= 100;
  const isReference = reference !== NOT_REFERENCE;
  const serial =
    !serialEdited && isReference && lineId
      ? defaultReferencePrefix(lineId, reference as ReferenceLabel, stamp || undefined)
      : typedSerial;
  const setSerial = (value: string) => {
    setTypedSerial(value);
    setSerialEdited(value !== "");
  };
  const many = isReference && files.length > 1;
  const serials = many ? referenceSerials(serial, files.length) : [serial];

  // The longest generated serial must still fit the server's 64-char pattern.
  const serialValid =
    SERIAL_PATTERN.test(serials[serials.length - 1] ?? "") && serial !== "" && !/^\.+$/.test(serial);
  const canSubmit = !!lineId && serialValid && files.length > 0 && !busy;
  const blockedReason = captureBlockedReason({
    lineId,
    serial,
    serialValid,
    fileCount: files.length,
    busy,
  });

  const onRejected = (rejections: FileRejection[]) =>
    toast.error(rejections[0]?.errors[0]?.message ?? "Only PNG or JPEG images up to 20 MB");

  const referenceLabel = isReference ? (reference as ReferenceLabel) : null;

  const submit = () => {
    if (!lineId || files.length === 0) return;
    setProgress(0);
    if (many) {
      void submitBatch(lineId);
      return;
    }
    capture.mutate(
      { lineId, serial, file: files[0], reference: referenceLabel },
      {
        onSuccess: (record) => {
          setResult(record);
          setSerial("");
          setFiles([]);
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

  /** Reference batch: one presigned upload + register per file, in order. */
  const submitBatch = async (line: string) => {
    const failures: string[] = [];
    setBatch({ done: 0, total: files.length });
    for (const [i, file] of files.entries()) {
      setProgress(0);
      try {
        setResult(
          await capture.mutateAsync({ lineId: line, serial: serials[i], file, reference: referenceLabel }),
        );
      } catch (error) {
        failures.push(`${serials[i]}: ${error instanceof Error ? error.message : String(error)}`);
      }
      setBatch({ done: i + 1, total: files.length });
    }
    setBatch(null);
    const stored = files.length - failures.length;
    if (failures.length === 0) {
      setSerial("");
      setFiles([]);
      toast.success(`Captured ${stored} reference image(s)`, {
        description: `${serials[0]} to ${serials[serials.length - 1]}, stored in B2.`,
      });
    } else {
      toast.error(`${failures.length} of ${files.length} reference image(s) failed`, {
        description: failures.slice(0, 3).join("; "),
      });
    }
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
            <Label htmlFor="capture-serial">{many ? "Serial prefix" : "Serial"}</Label>
            <Input
              id="capture-serial"
              value={serial}
              onChange={(e) => setSerial(e.target.value.trim())}
              placeholder="e.g. CNDL-000123"
              autoComplete="off"
              aria-invalid={serial !== "" && !serialValid}
            />
            <p className="text-xs text-muted-foreground">
              {many
                ? `The ${files.length} images get serials ${serials[0]} to ${serials[serials.length - 1]}.`
                : "Letters, digits, dot, dash or underscore. Unique per line; it names the image key."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="capture-reference">Reference image</Label>
            <Select
              value={reference}
              onValueChange={(value) => {
                setReference(value);
                // A production part is one image: drop the extras of a batch.
                if (value === NOT_REFERENCE) setFiles((current) => current.slice(0, 1));
              }}
            >
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
              {isReference && " You can drop several at once."}
            </p>
          </div>
          <Dropzone
            accept={CAPTURE_FILE_TYPES}
            maxSize={CAPTURE_MAX_BYTES}
            multiple={isReference}
            disabled={busy}
            onFilesSelected={(selected) => {
              setFiles(isReference ? selected : selected.slice(0, 1));
              setStamp(batchStamp(new Date()));
            }}
            onFilesRejected={onRejected}
            idleTitle={
              files.length > 1
                ? `${files.length} reference images selected`
                : files[0]
                  ? files[0].name
                  : isReference
                    ? "Drop one or more reference images, or click to browse"
                    : "Drop one part image, or click to browse"
            }
            idleDescription="PNG or JPEG, up to 20 MB. JPEG is stored as PNG."
          />
          {batch && (
            <div className="space-y-1.5" role="status" aria-live="polite">
              <p className="text-sm font-medium">
                Reference image {Math.min(batch.done + 1, batch.total)} of {batch.total} ·{" "}
                {batch.done} stored
              </p>
              <Progress
                value={Math.round((batch.done / batch.total) * 100)}
                aria-label="Reference images stored"
                {...progressValueProps(Math.round((batch.done / batch.total) * 100))}
              />
            </div>
          )}
          {capture.isPending && !uploaded && (
            <Progress value={progress} aria-label="Upload progress" {...progressValueProps(progress)} />
          )}
          {uploaded && (
            <JobProgress
              label={
                activeModel
                  ? `Uploaded. Scoring with PatchCore ${activeModel} and writing the heatmap to B2`
                  : "Uploaded. Registering the part in B2"
              }
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={!canSubmit} aria-describedby={blockedReason ? "capture-blocked" : undefined}>
              {capture.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {many && !busy
                ? `Capture ${files.length} reference images`
                : captureButtonLabel({ pending: capture.isPending, progress, hasModel: !!activeModel })}
            </Button>
            {blockedReason && (
              <p id="capture-blocked" className="text-xs text-muted-foreground">
                {blockedReason}
              </p>
            )}
          </div>
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
                  {result.model_version ? ` · model ${result.model_version}` : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.status === "in_review" && (
                  <Button asChild size="sm" className="h-8">
                    <Link href={reviewQueueHref(result.line_id, result.serial)}>
                      <ClipboardCheck className="h-3.5 w-3.5" /> Open in review queue
                    </Link>
                  </Button>
                )}
                <Button asChild size="sm" variant="outline" className="h-8">
                  <Link href={tracePath(result.line_id, result.serial)}>
                    <Search className="h-3.5 w-3.5" /> View trace
                  </Link>
                </Button>
              </div>
              {result.status === "unscored" && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                  {activeModel ? (
                    <p>
                      Stored in B2 but not scored. Score it from the{" "}
                      <Link className="underline underline-offset-4" href={`/lines/${encodeURIComponent(result.line_id)}`}>
                        line page
                      </Link>
                      .
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p>
                        Stored in B2. This line has no model yet, so the part stays unscored until
                        the first model is trained; it is then scored automatically.
                      </p>
                      <TrainFirstModelLink lineId={result.line_id} />
                    </div>
                  )}
                </div>
              )}
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
