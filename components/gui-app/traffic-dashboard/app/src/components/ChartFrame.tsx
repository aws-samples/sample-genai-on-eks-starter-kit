"use client";

import { ReactNode } from "react";
import { SeriesMeta } from "@/lib/useSeries";

interface ChartFrameProps {
  height?: number;
  isLoading: boolean;
  error?: Error;
  isEmpty: boolean;
  children: ReactNode;
}

/** Loading / error / no-data states so every chart behaves the same way. */
export function ChartFrame({ height = 240, isLoading, error, isEmpty, children }: ChartFrameProps) {
  if (error) {
    return (
      <Placeholder height={height}>
        <span className="text-status-serious">▲</span> Query failed — {error.message}
      </Placeholder>
    );
  }
  if (isLoading && isEmpty) {
    return <Placeholder height={height}>Loading…</Placeholder>;
  }
  if (isEmpty) {
    return (
      <Placeholder height={height}>
        No data in the selected window. The source exporter may not be installed yet.
      </Placeholder>
    );
  }
  return <div style={{ height }}>{children}</div>;
}

function Placeholder({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-gridline px-4 text-center text-xs text-ink-muted"
      style={{ height }}
    >
      <p className="max-w-xs leading-relaxed">{children}</p>
    </div>
  );
}

/** Legend rendered outside the plot. Shown whenever there are 2+ series. */
export function SeriesLegend({ series }: { series: SeriesMeta[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-3 rounded-full"
            style={{ backgroundColor: s.color }}
          />
          <span className="truncate max-w-[16rem]" title={s.key}>
            {s.key}
          </span>
        </li>
      ))}
    </ul>
  );
}
