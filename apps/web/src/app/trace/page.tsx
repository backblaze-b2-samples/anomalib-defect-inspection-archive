"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { tracePath } from "@/components/inspection/parts-table";
import { PartStatusBadge } from "@/components/inspection/status-badge";
import { useTraceSearch } from "@/lib/queries";

export default function TraceSearchPage() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const { data, isLoading, isFetching, error, refetch } = useTraceSearch(query);

  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Trace</h1>
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
          Enter a part serial (or its beginning) to get back its image, heatmap, every score
          with the model version behind it, and the operator verdicts.
        </p>
      </div>
      <form
        className="flex max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. CNDL-000123"
          aria-label="Part serial"
        />
        <Button type="submit" disabled={!draft.trim() || (isFetching && draft.trim() === query)}>
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Search className="h-4 w-4" />
          )}{" "}
          {isFetching ? "Searching..." : "Trace"}
        </Button>
      </form>
      {!query ? null : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Searching every line for serials starting with &quot;{query}&quot;...
          </p>
          <Skeleton className="h-32" />
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState icon={Search} title="No part found" description={`No serial starting with "${query}" on any line.`} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serial</TableHead>
                  <TableHead>Line</TableHead>
                  <TableHead>Captured</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((m) => (
                  <TableRow key={`${m.line_id}/${m.serial}`}>
                    <TableCell className="font-medium">
                      <Link className="underline-offset-4 hover:underline" href={tracePath(m.line_id, m.serial)}>
                        {m.serial}
                      </Link>
                    </TableCell>
                    <TableCell>{m.line_id}</TableCell>
                    <TableCell>{m.capture_date}</TableCell>
                    <TableCell>
                      <PartStatusBadge status={m.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
