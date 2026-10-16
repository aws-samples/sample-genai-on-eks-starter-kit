"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "./ChartFrame";
import { ChartTooltip } from "./ChartTooltip";
import { GpuEmptyState } from "./GpuEmptyState";
import { formatBytes, formatPercent100, formatWatts } from "@/lib/format";
import { GPU } from "@/lib/queries";
import { INK, STRUCTURE, colorForIndex } from "@/lib/theme";
import { useInstantVector } from "@/lib/useSeries";
import { workloadFromPod } from "@/lib/workload";

interface WorkloadRow {
  name: string;
  util: number;
  memoryBytes: number;
  watts: number;
  gpuCount: number;
}

/**
 * GPU consumption per workload. DCGM only labels pods, so the workload name is
 * derived from the pod name (src/lib/workload.ts) — a naming heuristic, which is
 * why the panel subtitle says "derived".
 *
 * Utilisation is summed across a workload's GPUs, so a 2-GPU replica at 90% on
 * both reads 180%: this is "how much GPU is this workload consuming", not an
 * average. The GPU count column is what makes that number interpretable.
 */
export function GpuByService() {
  const util = useInstantVector(GPU.podUtil);
  const memory = useInstantVector(GPU.podMemoryUsedBytes);
  const power = useInstantVector(GPU.podPowerWatts);

  const rows = aggregate(util.rows, memory.rows, power.rows);

  if (util.error) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        <span className="text-status-serious">▲</span> Query failed — {util.error.message}
      </p>
    );
  }
  if (rows.length === 0) {
    return <GpuEmptyState isLoading={util.isLoading} />;
  }

  // Colour keyed to the workload name, not the bar's position, so a workload
  // keeps its colour as the ranking shifts between refreshes.
  const colorByName = new Map(
    [...rows]
      .map((r) => r.name)
      .sort((a, b) => a.localeCompare(b))
      .map((name, index) => [name, colorForIndex(index)] as const),
  );

  return (
    <div className="space-y-5">
      <ChartFrame height={Math.max(160, rows.length * 34 + 40)} isLoading={util.isLoading} isEmpty={false}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={STRUCTURE.gridline} strokeDasharray="2 4" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(value: number) => formatPercent100(value)}
              stroke={STRUCTURE.baseline}
              tick={{ fill: INK.muted, fontSize: 11 }}
              tickLine={false}
              className="tabular"
              label={{
                value: "GPU utilization (summed across GPUs)",
                position: "insideBottom",
                fill: INK.muted,
                fontSize: 11,
                dy: 14,
              }}
            />
            <YAxis
              type="category"
              dataKey="name"
              stroke={STRUCTURE.baseline}
              tick={{ fill: INK.secondary, fontSize: 11 }}
              tickLine={false}
              width={150}
            />
            <Tooltip
              content={<ChartTooltip formatValue={(v) => formatPercent100(v)} formatLabel={(l) => String(l)} />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar dataKey="util" name="GPU utilization" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={row.name} fill={colorByName.get(row.name) ?? colorForIndex(0)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-gridline text-left text-ink-muted">
              <th className="py-2 pr-4 font-medium">Workload</th>
              <th className="py-2 pr-4 text-right font-medium">GPUs</th>
              <th className="py-2 pr-4 text-right font-medium">Memory used</th>
              <th className="py-2 text-right font-medium">Power</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-b border-gridline/60 last:border-0">
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colorByName.get(row.name) }}
                    />
                    <span className="truncate text-ink" title={row.name}>
                      {row.name}
                    </span>
                  </span>
                </td>
                <td className="tabular py-2 pr-4 text-right text-ink-secondary">{row.gpuCount}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatBytes(row.memoryBytes)}</td>
                <td className="tabular py-2 text-right text-ink">{formatWatts(row.watts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Row = { labels: Record<string, string>; value: number };

function aggregate(util: Row[], memory: Row[], power: Row[]): WorkloadRow[] {
  const byName = new Map<string, WorkloadRow>();
  const seenGpus = new Map<string, Set<string>>();

  const bucket = (pod: string): WorkloadRow => {
    const name = workloadFromPod(pod);
    const existing = byName.get(name);
    if (existing) return existing;
    const created = { name, util: 0, memoryBytes: 0, watts: 0, gpuCount: 0 };
    byName.set(name, created);
    seenGpus.set(name, new Set());
    return created;
  };

  for (const row of util) {
    const target = bucket(row.labels.pod ?? "");
    target.util += row.value;
    // Count distinct physical GPUs, not series: a pod can report several gauges
    // for the same device.
    seenGpus.get(target.name)!.add(row.labels.UUID || `${row.labels.pod}/${row.labels.gpu}`);
  }
  for (const row of memory) bucket(row.labels.pod ?? "").memoryBytes += row.value;
  for (const row of power) bucket(row.labels.pod ?? "").watts += row.value;

  for (const [name, gpus] of seenGpus) {
    const target = byName.get(name);
    if (target) target.gpuCount = gpus.size;
  }

  return [...byName.values()].sort((a, b) => b.util - a.util);
}
