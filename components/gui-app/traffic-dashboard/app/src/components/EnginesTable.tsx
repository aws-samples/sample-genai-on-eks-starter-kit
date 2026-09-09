"use client";

// NOTE: this file is deliberately named EnginesTable, not EngineTable. With the
// path src/components/EngineTable.tsx, `next build` (15.5) emitted a /page
// client-reference manifest with no app client modules at all, so the server
// crashed at request time with "Could not find the module
// .../DashboardBody.tsx#DashboardBody in the React Client Manifest". Renaming
// the module fixed it; the exact collision was not pinned down. scripts/
// check-client-manifest.mjs (postbuild) now fails the build if it recurs.

import { useMemo, useState } from "react";
import { acceleratorLabel, isNeuronAccelerator, useAcceleratorsByNode } from "@/lib/accelerator";
import { AcceleratorFilter, EMPTY_FILTER, isFiltering, matchesFilter } from "@/lib/acceleratorFilter";
import { formatCount, formatPercentUnit, formatSeconds, formatShort } from "@/lib/format";
import { ENGINES, GLANCE_THRESHOLDS as T } from "@/lib/queries";
import { STATUS, STATUS_GLYPH, STATUS_LABEL, StatusLevel, colorForIndex } from "@/lib/theme";
import { useTenantsByModel } from "@/lib/tenants";
import { InstantRow, useInstantVector } from "@/lib/useSeries";
import { workloadFromPod } from "@/lib/workload";
import { levelFor } from "./StatTile";

export type EnginesGrouping = "model" | "pod";

interface EngineRow {
  key: string;
  model: string;
  namespace: string;
  pod: string;
  /** Workload name derived from the pod name — the "service" the filter bar offers. */
  service: string;
  node: string | null;
  /** LiteLLM team aliases with a key routed to this model pool. */
  tenants: string[];
  accelerator: string | null;
  /** GPUs (DCGM) or Neuron cores (neuron-monitor) behind this engine. */
  devices: number | null;
  /** 0..1 — GPU util averaged over the pod's GPUs, or Neuron core util on its node. */
  accelUtil: number | null;
  /** 0..1 — GPU framebuffer used / total across the pod's GPUs. Neuron: unknown. */
  accelMem: number | null;
  kvUsage: number | null;
  cacheHits: number | null;
  cacheQueries: number | null;
  running: number | null;
  waiting: number | null;
  genTps: number | null;
  ttftP95: number | null;
}

interface ModelRow extends Omit<EngineRow, "pod" | "node" | "service"> {
  pods: number;
  accelerators: string[];
  services: string[];
}

/**
 * The fleet table above is totals per accelerator family; this table is the
 * serving signals per model pool and per engine pod, so a fleet average of 52% GPU util can be read
 * as "one pool pinned at 100%, one idle". Rows anchor on
 * vllm:num_requests_running (every engine reports it, GPU or Neuron); the
 * accelerator columns join DCGM on the pod label and neuron-monitor through the
 * pod's node. Model rows aggregate: device-weighted utilisation, summed memory
 * and counters, max KV usage, and the model's own TTFT histogram. The filter
 * applies to engine pods before grouping, so a model row under a tenant or
 * namespace filter aggregates only the pods that matched.
 */
export function EnginesTable({ grouping, filter = EMPTY_FILTER }: { grouping: EnginesGrouping; filter?: AcceleratorFilter }) {
  const running = useInstantVector(ENGINES.running);
  const waiting = useInstantVector(ENGINES.waiting);
  const kv = useInstantVector(ENGINES.kvUsage);
  const hits = useInstantVector(ENGINES.cacheHits);
  const queries = useInstantVector(ENGINES.cacheQueries);
  const genTps = useInstantVector(ENGINES.genTokensPerSec);
  const ttftPod = useInstantVector(ENGINES.ttftP95ByPod);
  const ttftModel = useInstantVector(ENGINES.ttftP95ByModel);
  const podNode = useInstantVector(ENGINES.podNode);
  const gpuUtil = useInstantVector(ENGINES.gpuUtilByPod);
  const gpuCount = useInstantVector(ENGINES.gpuCountByPod);
  const gpuMemUsed = useInstantVector(ENGINES.gpuMemUsedByPod);
  const gpuMemTotal = useInstantVector(ENGINES.gpuMemTotalByPod);
  const neuronUtil = useInstantVector(ENGINES.neuronUtilByNode);
  const neuronCores = useInstantVector(ENGINES.neuronCoresByNode);
  const accelerators = useAcceleratorsByNode();
  const tenants = useTenantsByModel();

  const engines = useMemo<EngineRow[]>(() => {
    const byEngine = (rows: InstantRow[]) => new Map(rows.map((r) => [engineKey(r.labels), r.value]));
    const byPod = (rows: InstantRow[]) => new Map(rows.map((r) => [r.labels.pod, r.value]));
    const byNode = (rows: InstantRow[]) => new Map(rows.map((r) => [r.labels.node, r.value]));
    const waitingBy = byEngine(waiting.rows);
    const kvBy = byEngine(kv.rows);
    const hitsBy = byEngine(hits.rows);
    const queriesBy = byEngine(queries.rows);
    const genBy = byEngine(genTps.rows);
    const ttftBy = byEngine(ttftPod.rows);
    const nodeBy = new Map(podNode.rows.map((r) => [r.labels.pod, r.labels.node]));
    const gpuUtilBy = byPod(gpuUtil.rows);
    const gpuCountBy = byPod(gpuCount.rows);
    const gpuUsedBy = byPod(gpuMemUsed.rows);
    const gpuTotalBy = byPod(gpuMemTotal.rows);
    const neuronUtilBy = byNode(neuronUtil.rows);
    const neuronCoresBy = byNode(neuronCores.rows);

    return running.rows.map((r) => {
      const pod = r.labels.pod ?? "";
      const node = nodeBy.get(pod) ?? null;
      const accelerator = acceleratorLabel(accelerators.byNode, node ?? undefined) ?? null;
      const neuron = isNeuronAccelerator(accelerator ?? undefined);
      const gpus = gpuCountBy.get(pod);
      const used = gpuUsedBy.get(pod);
      const total = gpuTotalBy.get(pod);
      const model = r.labels.model_name || "—";
      return {
        key: engineKey(r.labels),
        model,
        namespace: r.labels.namespace || "—",
        pod,
        service: workloadFromPod(pod),
        node,
        tenants: tenants.byModel.get(model) ?? [],
        accelerator,
        devices: neuron ? (node ? neuronCoresBy.get(node) ?? null : null) : gpus ?? null,
        accelUtil: neuron ? (node ? neuronUtilBy.get(node) ?? null : null) : gpuUtilBy.get(pod) ?? null,
        accelMem: !neuron && used !== undefined && total ? used / total : null,
        kvUsage: kvBy.get(engineKey(r.labels)) ?? null,
        cacheHits: hitsBy.get(engineKey(r.labels)) ?? null,
        cacheQueries: queriesBy.get(engineKey(r.labels)) ?? null,
        running: r.value,
        waiting: waitingBy.get(engineKey(r.labels)) ?? null,
        genTps: genBy.get(engineKey(r.labels)) ?? null,
        ttftP95: ttftBy.get(engineKey(r.labels)) ?? null,
      };
    });
  }, [
    running.rows, waiting.rows, kv.rows, hits.rows, queries.rows, genTps.rows, ttftPod.rows, podNode.rows,
    gpuUtil.rows, gpuCount.rows, gpuMemUsed.rows, gpuMemTotal.rows, neuronUtil.rows, neuronCores.rows,
    accelerators.byNode, tenants.byModel,
  ]);

  const visible = useMemo(() => engines.filter((e) => matchesFilter(e, filter)), [engines, filter]);

  const models = useMemo<ModelRow[]>(() => {
    const ttftBy = new Map(ttftModel.rows.map((r) => [r.labels.model_name, r.value]));
    const groups = new Map<string, EngineRow[]>();
    for (const e of visible) groups.set(e.model, [...(groups.get(e.model) ?? []), e]);
    return [...groups.entries()]
      .map(([model, rows]) => {
        const utilWeighted = weightedMean(rows.map((r) => [r.accelUtil, r.devices]));
        const memWeighted = weightedMean(rows.map((r) => [r.accelMem, r.devices]));
        const hitsSum = sumOrNull(rows.map((r) => r.cacheHits));
        const queriesSum = sumOrNull(rows.map((r) => r.cacheQueries));
        return {
          key: model,
          model,
          namespace: [...new Set(rows.map((r) => r.namespace))].sort().join(", "),
          pods: rows.length,
          accelerators: [...new Set(rows.map((r) => r.accelerator).filter((a): a is string => !!a))].sort(),
          services: [...new Set(rows.map((r) => r.service))].sort(),
          tenants: rows[0]?.tenants ?? [],
          accelerator: null,
          devices: sumOrNull(rows.map((r) => r.devices)),
          accelUtil: utilWeighted,
          accelMem: memWeighted,
          kvUsage: maxOrNull(rows.map((r) => r.kvUsage)),
          cacheHits: hitsSum,
          cacheQueries: queriesSum,
          running: sumOrNull(rows.map((r) => r.running)),
          waiting: sumOrNull(rows.map((r) => r.waiting)),
          genTps: sumOrNull(rows.map((r) => r.genTps)),
          ttftP95: ttftBy.get(model) ?? null,
        };
      })
      .sort((a, b) => (b.genTps ?? -1) - (a.genTps ?? -1) || a.model.localeCompare(b.model));
  }, [visible, ttftModel.rows]);

  // Colour follows the model, not the row position (and not the filter), so a
  // pod keeps its pool's colour in both groupings, across refreshes and when
  // the filter hides its siblings.
  const modelColor = useMemo(() => {
    const all = [...new Set(engines.map((e) => e.model))].sort();
    return new Map(all.map((m, i) => [m, colorForIndex(i)]));
  }, [engines]);

  const error = running.error ?? kv.error ?? gpuUtil.error;
  if (error) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        <span className="text-status-serious">▲</span> Query failed — {error.message}
      </p>
    );
  }
  if (engines.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        {running.isLoading ? "Loading…" : "No vLLM engines are reporting to Prometheus."}
      </p>
    );
  }
  if (visible.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        No engines match the current filters{isFiltering(filter) ? " — clear a filter to widen the view." : "."}
      </p>
    );
  }

  const podRows = [...visible].sort(
    (a, b) => (b.genTps ?? -1) - (a.genTps ?? -1) || a.model.localeCompare(b.model) || a.pod.localeCompare(b.pod),
  );
  const th = "py-2 pr-4 font-medium";
  const thRight = `${th} text-right`;
  const td = "tabular py-2 pr-4 text-right text-ink";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <th className={th}>Model pool</th>
            {grouping === "pod" ? (
              <>
                <th className={th}>Namespace</th>
                <th className={th}>Pod</th>
                <th className={th}>Node</th>
              </>
            ) : (
              <th className={thRight}>Pods</th>
            )}
            <th className={th}>Accelerator</th>
            <th className={thRight} title="GPUs (DCGM) or Neuron cores (neuron-monitor) behind the engine">
              Devices
            </th>
            <th className={th} title="GPU: DCGM utilisation averaged over the pod's GPUs. Neuron: core utilisation on the pod's node. Target ≥ 70%.">
              Accel util
            </th>
            <th className={thRight} title="GPU framebuffer used / total across the pod's GPUs">
              Accel mem
            </th>
            <th className={thRight} title="vLLM KV-cache blocks in use (max across the model's engines)">
              KV cache
            </th>
            <th className={thRight} title="Prefix-cache hits / queries over 5m">
              Prefix hit
            </th>
            <th className={thRight}>Running</th>
            <th className={thRight}>Waiting</th>
            <th className={thRight}>Gen tok/s</th>
            <th className={thRight}>TTFT p95</th>
            <th className="py-2 font-medium" title="LiteLLM teams with a virtual key routed to this model pool">
              Tenants
            </th>
          </tr>
        </thead>
        <tbody>
          {grouping === "model"
            ? models.map((m) => (
                <tr key={m.key} className="border-b border-gridline/60 last:border-0">
                  <td className="py-2 pr-4 font-medium text-ink">
                    <ModelName name={m.model} color={modelColor.get(m.model)!} />
                  </td>
                  <td className={td}>{formatCount(m.pods)}</td>
                  <td className="py-2 pr-4 text-ink-secondary">{m.accelerators.join(", ") || "—"}</td>
                  <td className={td}>{formatCount(m.devices)}</td>
                  <td className="py-2 pr-4">
                    <UtilCell value={m.accelUtil} color={modelColor.get(m.model)!} />
                  </td>
                  <td className={td}>{formatPercentUnit(m.accelMem, 0)}</td>
                  <td className={td}>
                    <StatusValue value={m.kvUsage} text={formatPercentUnit(m.kvUsage, 0)} level={levelFor(m.kvUsage, T.kvCacheMax)} />
                  </td>
                  <td className={td}>
                    <HitRatio hits={m.cacheHits} queries={m.cacheQueries} />
                  </td>
                  <td className={td}>{formatCount(roundOrNull(m.running))}</td>
                  <td className={td}>
                    <StatusValue value={m.waiting} text={formatCount(roundOrNull(m.waiting))} level={levelFor(m.waiting, T.queueDepth)} />
                  </td>
                  <td className={td}>{formatShort(m.genTps, 1)}</td>
                  <td className={td}>
                    <StatusValue value={m.ttftP95} text={formatSeconds(m.ttftP95)} level={levelFor(m.ttftP95, T.ttftP95)} />
                  </td>
                  <td className="py-2 text-ink-muted">
                    <Tenants tenants={m.tenants} />
                  </td>
                </tr>
              ))
            : podRows.map((e) => (
                <tr key={e.key} className="border-b border-gridline/60 last:border-0">
                  <td className="py-2 pr-4 text-ink">
                    <ModelName name={e.model} color={modelColor.get(e.model)!} />
                  </td>
                  <td className="py-2 pr-4 text-ink-secondary">{e.namespace}</td>
                  <td className="max-w-[16rem] truncate py-2 pr-4 font-mono text-[11px] text-ink-secondary" title={e.pod}>
                    {e.pod || "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-[11px] text-ink-secondary">{e.node ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink-secondary">{e.accelerator ?? "—"}</td>
                  <td className={td}>{formatCount(e.devices)}</td>
                  <td className="py-2 pr-4">
                    <UtilCell value={e.accelUtil} color={modelColor.get(e.model)!} />
                  </td>
                  <td className={td}>
                    {e.accelMem === null && isNeuronAccelerator(e.accelerator ?? undefined) ? (
                      <span className="text-ink-muted" title="neuron-monitor reports used bytes per node, not capacity">—</span>
                    ) : (
                      formatPercentUnit(e.accelMem, 0)
                    )}
                  </td>
                  <td className={td}>
                    <StatusValue value={e.kvUsage} text={formatPercentUnit(e.kvUsage, 0)} level={levelFor(e.kvUsage, T.kvCacheMax)} />
                  </td>
                  <td className={td}>
                    <HitRatio hits={e.cacheHits} queries={e.cacheQueries} />
                  </td>
                  <td className={td}>{formatCount(roundOrNull(e.running))}</td>
                  <td className={td}>
                    <StatusValue value={e.waiting} text={formatCount(roundOrNull(e.waiting))} level={levelFor(e.waiting, T.queueDepth)} />
                  </td>
                  <td className={td}>{formatShort(e.genTps, 1)}</td>
                  <td className={td}>
                    <StatusValue value={e.ttftP95} text={formatSeconds(e.ttftP95)} level={levelFor(e.ttftP95, T.ttftP95)} />
                  </td>
                  <td className="py-2 text-ink-muted">
                    <Tenants tenants={e.tenants} />
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

/** Segmented control for the grouping; lives in the block header. */
export function EnginesGroupingToggle({
  value,
  onChange,
}: {
  value: EnginesGrouping;
  onChange: (next: EnginesGrouping) => void;
}) {
  const options: { id: EnginesGrouping; label: string }[] = [
    { id: "model", label: "By model" },
    { id: "pod", label: "By pod" },
  ];
  return (
    <div role="radiogroup" aria-label="Group engines" className="flex rounded-lg bg-surface-raised p-0.5 ring-1 ring-white/10">
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.id)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              selected ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink-secondary"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Tenants({ tenants }: { tenants: string[] }) {
  if (tenants.length === 0) return <span title="No LiteLLM virtual key routes to this pool">—</span>;
  return <>{tenants.join(", ")}</>;
}

function ModelName({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}

/** Inline bar plus the number — the bar is a scan aid, the value is the fact. Glyph marks under-target. */
function UtilCell({ value, color }: { value: number | null; color: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(value, 1)) * 100;
  const level = value === null ? undefined : levelFor(value * 100, T.gpuUtilAvg, "higher-is-better");
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-gridline">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
      <span className="tabular w-10 text-right text-ink">{formatPercentUnit(value, 0)}</span>
      {level && level !== "good" && (
        <span aria-label={STATUS_LABEL[level]} title={`${STATUS_LABEL[level]} — below the 70% target`} style={{ color: STATUS[level] }}>
          {STATUS_GLYPH[level]}
        </span>
      )}
    </span>
  );
}

function HitRatio({ hits, queries }: { hits: number | null; queries: number | null }) {
  if (queries === null || queries <= 0) {
    return <span className="text-ink-muted" title="No prefix-cache queries in the last 5m (idle, or no prefix cache on this engine)">—</span>;
  }
  const ratio = (hits ?? 0) / queries;
  return <StatusValue value={ratio} text={formatPercentUnit(ratio, 0)} level={levelFor(ratio, T.prefixHitRatio, "higher-is-better")} />;
}

/** Number with a status glyph when it is outside the healthy band; colour reinforces, glyph carries. */
function StatusValue({ value, text, level }: { value: number | null; text: string; level: StatusLevel | undefined }) {
  if (value === null) return <span className="text-ink-muted">—</span>;
  if (!level || level === "good") return <>{text}</>;
  return (
    <span className="inline-flex items-center justify-end gap-1" style={{ color: STATUS[level] }} title={STATUS_LABEL[level]}>
      <span aria-hidden="true">{STATUS_GLYPH[level]}</span>
      <span>{text}</span>
      <span className="sr-only">{STATUS_LABEL[level]}</span>
    </span>
  );
}

function engineKey(labels: Record<string, string>): string {
  return `${labels.pod ?? ""}|${labels.model_name ?? ""}`;
}

function sumOrNull(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

function maxOrNull(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length ? Math.max(...nums) : null;
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

/** Mean weighted by device count; falls back to a plain mean when weights are unknown. */
function weightedMean(pairs: [number | null, number | null][]): number | null {
  const valid = pairs.filter((p): p is [number, number | null] => p[0] !== null);
  if (valid.length === 0) return null;
  const weighted = valid.filter((p): p is [number, number] => p[1] !== null && p[1] > 0);
  if (weighted.length === valid.length) {
    const w = weighted.reduce((a, [, d]) => a + d, 0);
    return weighted.reduce((a, [v, d]) => a + v * d, 0) / w;
  }
  return valid.reduce((a, [v]) => a + v, 0) / valid.length;
}
