"use client";

import Link from "next/link";
import { Factory } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { LineFormDialog } from "@/components/inspection/line-form";
import { formatDateTime } from "@/lib/inspection-format";
import { useLines } from "@/lib/queries";

export default function LinesPage() {
  const { data: lines, isLoading, error, refetch } = useLines();
  return (
    <div className="space-y-8">
      <div className="animate-fade-in flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="page-title">Lines</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Each inspection line keeps its images, scores, verdicts and model versions under{" "}
            <code>lines/&lt;line-id&gt;/</code> in B2.
          </p>
        </div>
        <LineFormDialog />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : !lines || lines.length === 0 ? (
        <EmptyState
          icon={Factory}
          title="No lines yet"
          description="Create a line, capture reference images, then train its first model."
          action={<LineFormDialog />}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lines.map((line) => (
            <Link key={line.line_id} href={`/lines/${encodeURIComponent(line.line_id)}`}>
              <Card className="card-hover h-full">
                <CardHeader className="px-5 py-4">
                  <CardTitle className="card-title">{line.name}</CardTitle>
                  <CardDescription className="text-xs">{line.line_id}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 px-5 pb-5 text-sm text-muted-foreground">
                  {line.description && <p>{line.description}</p>}
                  <p>
                    Active model: <strong className="text-foreground">{line.active_model_version ?? "none yet"}</strong>
                  </p>
                  <p className="text-xs">Updated {formatDateTime(line.updated_at)}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
