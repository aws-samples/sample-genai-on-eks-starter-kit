"use client";

import { formatClock } from "@/lib/format";

interface TooltipEntry {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  /** Formatter for the value column — pass the panel's unit formatter. */
  formatValue: (value: number | null) => string;
  /** Header rendering; defaults to a HH:MM clock for timeseries panels. */
  formatLabel?: (label: string | number) => string;
}

/** Dark tooltip matching the card surface; series rows sorted by magnitude. */
export function ChartTooltip({ active, payload, label, formatValue, formatLabel }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const header =
    formatLabel?.(label ?? "") ?? (typeof label === "number" ? formatClock(label) : String(label ?? ""));

  const rows = payload
    .map((entry) => ({
      name: String(entry.name ?? entry.dataKey ?? ""),
      color: entry.color ?? "currentColor",
      value: typeof entry.value === "number" ? entry.value : Number(entry.value),
    }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl bg-surface-raised px-3 py-2 ring-1 ring-white/10 shadow-lg">
      <p className="tabular mb-1.5 text-[11px] font-medium text-ink-muted">{header}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-3 text-xs">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="mr-auto max-w-[14rem] truncate text-ink-secondary">{row.name}</span>
            <span className="tabular font-medium text-ink">{formatValue(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
