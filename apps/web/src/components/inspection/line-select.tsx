"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLines } from "@/lib/queries";

export const ALL_LINES = "__all__";

interface LineSelectProps {
  value: string | undefined;
  onChange: (lineId: string) => void;
  /** Adds an "All lines" option whose value is ALL_LINES. */
  allowAll?: boolean;
  id?: string;
  placeholder?: string;
}

/** Selector of existing lines: line ids are never typed free-hand. */
export function LineSelect({ value, onChange, allowAll, id, placeholder }: LineSelectProps) {
  const { data: lines, isLoading } = useLines();
  return (
    <Select value={value} onValueChange={onChange} disabled={isLoading}>
      <SelectTrigger id={id} className="w-full sm:w-64" aria-label="Line">
        <SelectValue placeholder={isLoading ? "Loading lines..." : (placeholder ?? "Choose a line")} />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL_LINES}>All lines</SelectItem>}
        {(lines ?? []).map((line) => (
          <SelectItem key={line.line_id} value={line.line_id}>
            {line.name} ({line.line_id})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
