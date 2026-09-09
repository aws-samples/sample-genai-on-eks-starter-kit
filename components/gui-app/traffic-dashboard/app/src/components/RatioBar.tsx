"use client";

import { formatPercentUnit } from "@/lib/format";

/** Inline 0..1 bar with the percentage beside it, for table cells. */
export function RatioBar({ value, color }: { value: number | null; color: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(value, 1)) * 100;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-gridline">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
      <span className="tabular w-12 text-right text-ink">{formatPercentUnit(value, 1)}</span>
    </span>
  );
}
