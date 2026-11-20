/** Shared Prometheus API types + client helpers for /api/prom. */

export type PromMetric = Record<string, string>;

export type PromSample = [number, string];

export interface PromVectorResult {
  metric: PromMetric;
  value: PromSample;
}

export interface PromMatrixResult {
  metric: PromMetric;
  values: PromSample[];
}

export interface PromInstantResponse {
  resultType: "vector" | "scalar" | "string" | "matrix";
  result: PromVectorResult[];
}

export interface PromRangeResponse {
  resultType: "matrix";
  result: PromMatrixResult[];
}

/** SWR fetcher for the instant endpoint. */
export function instantKey(query: string): string {
  return `/api/prom?type=instant&query=${encodeURIComponent(query)}`;
}

/** SWR fetcher for the range endpoint. `minutes` is the lookback window; the
 *  step is derived server-side so the point count stays reasonable. */
export function rangeKey(query: string, minutes = 60): string {
  return `/api/prom?type=range&minutes=${minutes}&query=${encodeURIComponent(query)}`;
}

export async function promFetcher<T>(key: string): Promise<T> {
  const res = await fetch(key);
  if (res.status === 401) {
    throw new Error("Session expired — reload to sign in again");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Prometheus query failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Label-template expansion in the style of Grafana's legendFormat:
 *  "p95 {{model_name}}" against the sample's labels. */
export function formatLegend(template: string, metric: PromMetric): string {
  const label = template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => metric[key] ?? "");
  return label.trim() || "value";
}
