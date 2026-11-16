import { ArchiveBrowser } from "@/components/inspection/archive-browser";

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ line?: string }>;
}) {
  const { line } = await searchParams;
  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Inspection Archive</h1>
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
          Everything a line has written under <code>lines/&lt;line-id&gt;/</code> in B2: part
          images paired with their heatmaps by capture date, plus the Parquet score files,
          verdict labels and model versions. The full bucket stays browsable in Files.
        </p>
      </div>
      <ArchiveBrowser defaultLineId={line} />
    </div>
  );
}
