"use client";

import { STATUS, STATUS_GLYPH, STATUS_LABEL, StatusLevel } from "@/lib/theme";

interface StatTileProps {
  label: string;
  value: string;
  /** Secondary line: the unit, window, or a caveat such as "estimate". */
  hint?: string;
  status?: StatusLevel;
  isLoading?: boolean;
  error?: Error;
}

/**
 * Headline number. Status is carried by a glyph plus a text label — the colour
 * is redundant reinforcement, never the only channel.
 */
export function StatTile({ label, value, hint, status, isLoading, error }: StatTileProps) {
  return (
    <div className="h-full rounded-2xl bg-surface ring-1 ring-white/10 px-5 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
        {status && (
          <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: STATUS[status] }}>
            <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
            <span>{STATUS_LABEL[status]}</span>
          </span>
        )}
      </div>
      <p className="tabular mt-2 text-3xl font-semibold leading-none text-ink">
        {error ? "—" : isLoading ? <span className="text-ink-muted">···</span> : value}
      </p>
      <p className="mt-2 truncate text-xs text-ink-secondary" title={error ? error.message : hint}>
        {error ? `Unavailable: ${error.message}` : hint}
      </p>
    </div>
  );
}

/** Threshold helper mirroring the Grafana panels' threshold steps. */
export function levelFor(
  value: number | null,
  steps: { warning: number; critical: number },
  direction: "higher-is-worse" | "higher-is-better" = "higher-is-worse",
): StatusLevel | undefined {
  if (value === null) return undefined;
  if (direction === "higher-is-worse") {
    if (value >= steps.critical) return "critical";
    if (value >= steps.warning) return "warning";
    return "good";
  }
  if (value <= steps.critical) return "critical";
  if (value <= steps.warning) return "warning";
  return "good";
}
