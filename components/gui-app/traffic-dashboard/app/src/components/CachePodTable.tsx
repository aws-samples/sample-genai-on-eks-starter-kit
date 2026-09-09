"use client";

import { acceleratorLabel, isNeuronAccelerator, useAcceleratorsByNode } from "@/lib/accelerator";
import { VERDICT_HINT, VERDICT_LABEL, VERDICT_STATUS, cacheVerdict, ratio } from "@/lib/cache";
import { formatDuration, formatPercentUnit, formatSeconds, formatShort } from "@/lib/format";
import { CACHE } from "@/lib/queries";
import { STATUS, STATUS_GLYPH, colorForIndex } from "@/lib/theme";
import { useInstantVector } from "@/lib/useSeries";

interface CachePodRow {
  key: string;
  pod: string;
  model: string;
  node: string;
  /** From DCGM / neuron-monitor via the node — vLLM's own metrics do not say. */
  accelerator: string;
  queryRate: number | null;
  hitRatio: number | null;
  cachedTokenShare: number | null;
  kvUsage: number | null;
  preemptionsPerMin: number | null;
  waiting: number | null;
  ttftP95: number | null;
  ageSeconds: number | null;
}

/**
 * One row per vLLM engine. Instant vectors are joined on (pod, model_name):
 * hit ratio and cached-token share say how much prefill is being skipped; KV
 * usage and preemptions say whether a low ratio is a capacity problem or a
 * prompt/routing problem; queue depth and TTFT p95 show what the user feels;
 * engine age bounds how old the cache can be (every restart empties it). The
 * verdict column applies the capacity-vs-prompt rule so the reader does not
 * have to.
 */
export function CachePodTable() {
  const queries = useInstantVector(CACHE.podQueries);
  const hits = useInstantVector(CACHE.podHits);
  const promptTokens = useInstantVector(CACHE.podPromptTokens);
  const cachedTokens = useInstantVector(CACHE.podCachedTokens);
  const kv = useInstantVector(CACHE.podKvUsage);
  const preemptions = useInstantVector(CACHE.podPreemptionsPerMin);
  const nodes = useInstantVector(CACHE.podNode);
  const waiting = useInstantVector(CACHE.podWaiting);
  const ttft = useInstantVector(CACHE.podTtftP95);
  const age = useInstantVector(CACHE.podAgeSeconds);
  const accelerators = useAcceleratorsByNode();

  const byPod = (rows: { labels: Record<string, string>; value: number }[]) =>
    new Map(rows.map((row) => [podKey(row.labels), row.value]));
  const hitsByPod = byPod(hits.rows);
  const promptByPod = byPod(promptTokens.rows);
  const cachedByPod = byPod(cachedTokens.rows);
  const kvByPod = byPod(kv.rows);
  const preemptByPod = byPod(preemptions.rows);
  const waitingByPod = byPod(waiting.rows);
  const ttftByPod = byPod(ttft.rows);
  const ageByPod = new Map(age.rows.map((row) => [row.labels.pod, row.value]));
  const nodeByPod = new Map(nodes.rows.map((row) => [row.labels.pod, row.labels.node]));

  // KV usage is the widest vector (every engine reports it, even idle ones), so
  // it anchors the row set; cache counters fill in where traffic exists.
  const anchor = kv.rows.length > 0 ? kv.rows : queries.rows;
  const rows: CachePodRow[] = anchor
    .map((row) => {
      const key = podKey(row.labels);
      const queryRate = queries.rows.find((q) => podKey(q.labels) === key)?.value ?? null;
      const node = nodeByPod.get(row.labels.pod);
      return {
        key,
        pod: row.labels.pod || "—",
        model: row.labels.model_name || "—",
        node: node ?? "—",
        accelerator: acceleratorLabel(accelerators.byNode, node) ?? "—",
        queryRate,
        hitRatio: ratio(hitsByPod.get(key), queryRate ?? undefined),
        cachedTokenShare: ratio(cachedByPod.get(key), promptByPod.get(key)),
        kvUsage: kvByPod.get(key) ?? null,
        preemptionsPerMin: preemptByPod.get(key) ?? null,
        waiting: waitingByPod.get(key) ?? null,
        ttftP95: ttftByPod.get(key) ?? null,
        ageSeconds: ageByPod.get(row.labels.pod) ?? null,
      };
    })
    .sort((a, b) => (a.hitRatio ?? 2) - (b.hitRatio ?? 2) || a.model.localeCompare(b.model));

  const error = queries.error ?? kv.error;
  if (error) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        <span className="text-status-serious">▲</span> Query failed — {error.message}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        {kv.isLoading || queries.isLoading ? "Loading…" : "No vLLM engines are reporting prefix-cache metrics."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <th className="py-2 pr-4 font-medium">Model pool</th>
            <th className="py-2 pr-4 font-medium">Pod</th>
            <th className="py-2 pr-4 font-medium">Worker node</th>
            <th className="py-2 pr-4 font-medium">Accelerator</th>
            <th className="py-2 pr-4 font-medium">Hit ratio</th>
            <th className="py-2 pr-4 text-right font-medium">Cached tokens</th>
            <th className="py-2 pr-4 text-right font-medium">KV usage</th>
            <th className="py-2 pr-4 text-right font-medium">Preempt /min</th>
            <th className="py-2 pr-4 text-right font-medium">Queries /s</th>
            <th className="py-2 pr-4 text-right font-medium">Waiting</th>
            <th className="py-2 pr-4 text-right font-medium">TTFT p95</th>
            <th className="py-2 pr-4 text-right font-medium">Engine age</th>
            <th className="py-2 font-medium">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            // Neuron engines expose the same vLLM gauges but have no prefix
            // cache, so the capacity-vs-prompt rule does not apply to them.
            const verdict = isNeuronAccelerator(row.accelerator) ? "unsupported" : cacheVerdict(row);
            const level = VERDICT_STATUS[verdict];
            return (
              <tr key={row.key} className="border-b border-gridline/60 last:border-0">
                <td className="py-2 pr-4 text-ink">{row.model}</td>
                <td className="max-w-[16rem] truncate py-2 pr-4 font-mono text-[11px] text-ink-secondary" title={row.pod}>
                  {row.pod}
                </td>
                <td className="py-2 pr-4 font-mono text-[11px] text-ink-secondary">{row.node}</td>
                <td className="py-2 pr-4 text-ink-secondary">{row.accelerator}</td>
                <td className="py-2 pr-4">
                  <RatioBar value={row.hitRatio} color={colorForIndex(index)} />
                </td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatPercentUnit(row.cachedTokenShare, 1)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatPercentUnit(row.kvUsage, 1)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatShort(row.preemptionsPerMin)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatShort(row.queryRate)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatShort(row.waiting, 0)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatSeconds(row.ttftP95)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink" title="Time since the engine pod started — the prefix cache cannot be older than this">
                  {formatDuration(row.ageSeconds)}
                </td>
                <td className="py-2">
                  <span
                    className="inline-flex items-center gap-1"
                    style={{ color: level ? STATUS[level] : undefined }}
                    title={VERDICT_HINT[verdict]}
                  >
                    {level && level !== "good" && <span aria-hidden="true">{STATUS_GLYPH[level]}</span>}
                    <span className={level ? undefined : "text-ink-muted"}>{VERDICT_LABEL[verdict]}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function podKey(labels: Record<string, string>): string {
  return `${labels.pod ?? ""}|${labels.model_name ?? ""}`;
}

/** Inline bar plus the number — the bar is a scan aid, the value is the fact. */
function RatioBar({ value, color }: { value: number | null; color: string }) {
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
