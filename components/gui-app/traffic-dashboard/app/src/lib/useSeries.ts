"use client";

import useSWR from "swr";
import { useMemo } from "react";
import {
  PromInstantResponse,
  PromRangeResponse,
  formatLegend,
  instantKey,
  promFetcher,
  rangeKey,
} from "./prom";
import { MAX_SERIES, OTHER_COLOR, colorForIndex } from "./theme";

/** Every panel polls on the same 15s cadence. */
export const REFRESH_MS = 15_000;

const SWR_OPTIONS = {
  refreshInterval: REFRESH_MS,
  revalidateOnFocus: false,
  keepPreviousData: true,
} as const;

export interface RangeQuery {
  /** PromQL expression. */
  expr: string;
  /** Grafana-style legend template, e.g. "p95 {{model_name}}". */
  legend: string;
}

export interface SeriesMeta {
  key: string;
  color: string;
}

/** Row shape Recharts consumes: one object per timestamp, one key per series. */
export type ChartRow = { t: number } & Record<string, number | null>;

export interface RangeResult {
  rows: ChartRow[];
  series: SeriesMeta[];
  isLoading: boolean;
  error: Error | undefined;
}

/**
 * Runs one or more range queries and pivots the matrices into the row-per-
 * timestamp shape Recharts wants. Series keep a stable colour by name (sorted),
 * so a series does not change colour when its rank shifts between refreshes;
 * anything past the 8th series folds into "Other" (summed).
 */
export function useRangeSeries(queries: RangeQuery[], minutes = 60): RangeResult {
  // One hook for the whole panel regardless of how many expressions it holds:
  // fetching per query with a hook each would make the hook count depend on the
  // argument length.
  const cacheKey = `range:${minutes}:${queries.map((q) => q.expr).join("||")}`;
  const { data, isLoading, error } = useSWR<PromRangeResponse[]>(
    cacheKey,
    () => Promise.all(queries.map((q) => promFetcher<PromRangeResponse>(rangeKey(q.expr, minutes)))),
    SWR_OPTIONS,
  );
  const payloads: (PromRangeResponse | undefined)[] = data ?? queries.map(() => undefined);

  return useMemo(() => {
    // Collect (name → timestamp → value) across all queries.
    const byName = new Map<string, Map<number, number>>();
    payloads.forEach((payload, queryIndex) => {
      const legend = queries[queryIndex]?.legend ?? "value";
      for (const entry of payload?.result ?? []) {
        const name = formatLegend(legend, entry.metric);
        const points = byName.get(name) ?? new Map<number, number>();
        for (const [ts, raw] of entry.values) {
          const value = Number(raw);
          if (Number.isFinite(value)) {
            points.set(ts, (points.get(ts) ?? 0) + value);
          }
        }
        byName.set(name, points);
      }
    });

    if (byName.size === 0) {
      return { rows: [], series: [], isLoading, error };
    }

    // Rank by peak magnitude to decide what survives as its own series, then
    // assign colours in name order so the mapping is stable across refreshes.
    const ranked = [...byName.entries()]
      .map(([name, points]) => ({ name, peak: Math.max(...points.values(), 0) }))
      .sort((a, b) => b.peak - a.peak);
    const kept = ranked.slice(0, MAX_SERIES).map((s) => s.name).sort((a, b) => a.localeCompare(b));
    const folded = ranked.slice(MAX_SERIES).map((s) => s.name);

    const series: SeriesMeta[] = kept.map((key, index) => ({ key, color: colorForIndex(index) }));
    if (folded.length > 0) {
      series.push({ key: "Other", color: OTHER_COLOR });
    }

    const timestamps = [...new Set([...byName.values()].flatMap((points) => [...points.keys()]))].sort(
      (a, b) => a - b,
    );

    const rows: ChartRow[] = timestamps.map((t) => {
      const row: ChartRow = { t };
      for (const name of kept) {
        row[name] = byName.get(name)?.get(t) ?? null;
      }
      if (folded.length > 0) {
        let sum: number | null = null;
        for (const name of folded) {
          const value = byName.get(name)?.get(t);
          if (value !== undefined) sum = (sum ?? 0) + value;
        }
        row.Other = sum;
      }
      return row;
    });

    return { rows, series, isLoading, error };
    // `cacheKey` already encodes the query list, so it stands in for `queries`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, cacheKey, isLoading, error]);
}

export interface InstantRow {
  labels: Record<string, string>;
  value: number;
}

export interface InstantResult {
  rows: InstantRow[];
  isLoading: boolean;
  error: Error | undefined;
}

/** Instant vector as a flat list of {labels, value}, descending by value. */
export function useInstantVector(expr: string): InstantResult {
  const { data, isLoading, error } = useSWR<PromInstantResponse>(instantKey(expr), promFetcher, SWR_OPTIONS);

  const rows = useMemo(() => {
    return (data?.result ?? [])
      .map((entry) => ({ labels: entry.metric, value: Number(entry.value[1]) }))
      .filter((row) => Number.isFinite(row.value))
      .sort((a, b) => b.value - a.value);
  }, [data]);

  return { rows, isLoading, error: error as Error | undefined };
}

export interface ScalarResult {
  value: number | null;
  isLoading: boolean;
  error: Error | undefined;
}

/** Single headline number for the stat tiles. */
export function useScalar(expr: string): ScalarResult {
  const { data, isLoading, error } = useSWR<PromInstantResponse>(instantKey(expr), promFetcher, SWR_OPTIONS);
  const raw = data?.result?.[0]?.value?.[1];
  const parsed = raw === undefined ? null : Number(raw);
  return {
    value: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    isLoading,
    error: error as Error | undefined,
  };
}
