import { CaptureForm } from "@/components/upload/capture-form";

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ line?: string }>;
}) {
  const { line } = await searchParams;
  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Capture</h1>
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground text-pretty">
          Store a part image in B2 under its line and date, and score it with the line&apos;s
          active Anomalib PatchCore model.
        </p>
      </div>
      <div className="animate-fade-in-up stagger-2">
        <CaptureForm defaultLineId={line} />
      </div>
    </div>
  );
}
