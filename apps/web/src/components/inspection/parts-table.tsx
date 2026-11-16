import Link from "next/link";
import type { InspectionRecord } from "@anomalib-defect-inspection-archive/shared";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PartStatusBadge } from "@/components/inspection/status-badge";
import { formatDateTime, formatScore } from "@/lib/inspection-format";

export function tracePath(lineId: string, serial: string): string {
  return `/trace/${encodeURIComponent(lineId)}/${encodeURIComponent(serial)}`;
}

/** Inspection records as rows; the serial links to the Trace page. */
export function PartsTable({ items, showLine }: { items: InspectionRecord[]; showLine?: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Serial</TableHead>
          {showLine && <TableHead>Line</TableHead>}
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead className="text-right">Threshold</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Captured</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={`${item.line_id}/${item.serial}`}>
            <TableCell className="font-medium">
              <Link className="underline-offset-4 hover:underline" href={tracePath(item.line_id, item.serial)}>
                {item.serial}
              </Link>
              {item.reference && (
                <span className="ml-2 text-xs text-muted-foreground">ref: {item.reference}</span>
              )}
            </TableCell>
            {showLine && <TableCell>{item.line_id}</TableCell>}
            <TableCell>
              <PartStatusBadge status={item.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatScore(item.score)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatScore(item.threshold)}</TableCell>
            <TableCell>{item.model_version ?? "-"}</TableCell>
            <TableCell className="text-muted-foreground">{formatDateTime(item.captured_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
