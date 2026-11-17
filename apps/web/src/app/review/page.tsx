import { ReviewQueue } from "@/components/inspection/review-queue";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ line?: string; serial?: string }>;
}) {
  const { line, serial } = await searchParams;
  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Review queue</h1>
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
          Production parts whose latest score is at or above the model&apos;s threshold and that
          have no verdict yet. Reference images are already labelled, so they never wait here. Each verdict is stored in B2 as a new label; earlier ones are kept.
        </p>
      </div>
      <ReviewQueue defaultLineId={line} defaultSerial={serial} />
    </div>
  );
}
