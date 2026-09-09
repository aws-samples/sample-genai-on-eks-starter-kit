"use client";

import { useState } from "react";
import { Sparkline } from "./Sparkline";
import { levelFor } from "./StatTile";
import { formatClock } from "@/lib/format";
import { STATUS, STATUS_GLYPH, STATUS_LABEL, StatusLevel } from "@/lib/theme";
import { ChartRow, useRangeSeries } from "@/lib/useSeries";

const SERIES_KEY = "value";

interface SignalTileProps {
  label: string;
  /** PromQL producing exactly one series. */
  expr: string;
  minutes: number;
  format: (value: number | null) => string;
  /** One line on what the number means or which exporter feeds it. */
  hint: string;
  thresholds?: { warning: number; critical: number };
  direction?: "higher-is-worse" | "higher-is-better";
  /** Drawn as a dashed hairline on the sparkline (e.g. a target). */
  reference?: number;
}

/**
 * Stat tile driven by one range query: the headline is the latest point, the
 * delta compares it with the first point of the window, and the sparkline shows
 * the path between them. Status is glyph + label, colour only reinforces it.
 * The hero figure uses proportional digits; tabular-nums are for tables.
 */
export function SignalTile({
  label,
  expr,
  minutes,
  format,
  hint,
  thresholds,
  direction = "higher-is-worse",
  reference,
}: SignalTileProps) {
  const { rows, isLoading, error } = useRangeSeries([{ expr, legend: SERIES_KEY }], minutes);
  const [hovered, setHovered] = useState<ChartRow | null>(null);

  const numeric = rows.map((r) => r[SERIES_KEY]).filter((v): v is number => typeof v === "number");
  const latest = numeric.length > 0 ? numeric[numeric.length - 1] : null;
  const first = numeric.length > 1 ? numeric[0] : null;
  const status: StatusLevel | undefined = thresholds ? levelFor(latest, thresholds, direction) : undefined;

  const shown = hovered && typeof hovered[SERIES_KEY] === "number" ? (hovered[SERIES_KEY] as number) : latest;
  const delta = first !== null && latest !== null && first !== 0 ? (latest - first) / Math.abs(first) : null;
  const deltaImproves =
    delta === null ? null : direction === "higher-is-better" ? delta > 0 : delta < 0;

  let caption: string;
  if (error) caption = `Unavailable: ${error.message}`;
  else if (hovered) caption = `${format(shown)} at ${formatClock(hovered.t)}`;
  else if (latest === null && !isLoading) caption = "No data in window";
  else caption = hint;

  return (
    <div className="rounded-2xl bg-surface px-5 pb-3 pt-4 ring-1 ring-white/10">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
        {status && (
          <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: STATUS[status] }}>
            <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
            <span>{STATUS_LABEL[status]}</span>
          </span>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-3xl font-semibold leading-none text-ink">
          {error ? "—" : isLoading && latest === null ? <span className="text-ink-muted">···</span> : format(shown)}
        </p>
        {delta !== null && !hovered && Math.abs(delta) >= 0.005 && (
          <span
            className="text-[11px] font-medium text-ink-secondary"
            title={`Change over the selected window (${minutes}m)`}
          >
            <span aria-hidden="true">{delta > 0 ? "▲" : "▼"}</span>{" "}
            {Math.abs(delta * 100).toFixed(delta * 100 >= 100 ? 0 : 1)}%
            <span className="sr-only">{deltaImproves ? " (improving)" : " (worsening)"}</span>
          </span>
        )}
      </div>

      <div className="mt-2">
        <Sparkline rows={rows} seriesKey={SERIES_KEY} onHover={setHovered} reference={reference} />
      </div>

      <p className="mt-1 truncate text-xs text-ink-secondary" title={caption}>
        {caption}
      </p>
    </div>
  );
}
