"use client";

import { useMemo } from "react";
import { GpuEmptyState } from "./GpuEmptyState";
import { levelFor } from "./StatTile";
import { ACCELERATOR_KIND_LABEL } from "@/lib/accelerator";
import { AcceleratorFilter, matchesFilter } from "@/lib/acceleratorFilter";
import { AcceleratorPodRow, useAcceleratorPods } from "@/lib/acceleratorPods";
import { formatBytes, formatCelsius, formatPercentUnit, formatWatts } from "@/lib/format";
import { GPU_TEMP_CRITICAL_C, GPU_TEMP_WARNING_C } from "@/lib/queries";
import { numCol, sortRows, strCol, useSortState } from "@/lib/sort";
import { STATUS, STATUS_GLYPH, colorForIndex } from "@/lib/theme";
import { SortableTh } from "./SortableTh";

/**
 * Every accelerator-holding pod in one table, NVIDIA and Neuron on the same
 * columns. GPU rows are one per physical GPU (DCGM), Neuron rows one per pod
 * with the cores it requested. Power and temperature exist only for GPUs;
 * Neuron memory is the node's device memory, flagged when the node is shared.
 * Colour follows the service so a two-GPU workload reads as one block.
 */
type PodSortKey = "accelerator" | "namespace" | "service" | "pod" | "device" | "util" | "memory" | "watts" | "temp" | "tenants";

const POD_COLUMNS = [
  strCol<AcceleratorPodRow, PodSortKey>("accelerator", (r) => r.accelerator),
  strCol<AcceleratorPodRow, PodSortKey>("namespace", (r) => r.namespace),
  strCol<AcceleratorPodRow, PodSortKey>("service", (r) => r.service),
  strCol<AcceleratorPodRow, PodSortKey>("pod", (r) => r.pod),
  strCol<AcceleratorPodRow, PodSortKey>("device", (r) => r.device),
  numCol<AcceleratorPodRow, PodSortKey>("util", (r) => r.util),
  numCol<AcceleratorPodRow, PodSortKey>("memory", (r) => r.memoryBytes),
  numCol<AcceleratorPodRow, PodSortKey>("watts", (r) => r.watts),
  numCol<AcceleratorPodRow, PodSortKey>("temp", (r) => r.tempC),
  strCol<AcceleratorPodRow, PodSortKey>("tenants", (r) => (r.tenants.length ? r.tenants.join(", ") : null)),
];

const podTieBreak = (a: AcceleratorPodRow, b: AcceleratorPodRow) =>
  a.service.localeCompare(b.service) || a.pod.localeCompare(b.pod) || a.device.localeCompare(b.device, undefined, { numeric: true });

export function AcceleratorPodTable({ filter }: { filter: AcceleratorFilter }) {
  const pods = useAcceleratorPods();
  const { sort, toggle } = useSortState<PodSortKey>({ key: "service", dir: "asc" }, POD_COLUMNS);

  const rows = useMemo(
    () => sortRows(pods.rows.filter((r) => matchesFilter(r, filter)), sort, POD_COLUMNS, podTieBreak),
    [pods.rows, filter, sort],
  );
  const serviceColor = useMemo(() => {
    const services = [...new Set(pods.rows.map((r) => r.service))].sort();
    return new Map(services.map((s, i) => [s, colorForIndex(i)]));
  }, [pods.rows]);

  if (pods.error) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        <span className="text-status-serious">▲</span> Query failed — {pods.error.message}
      </p>
    );
  }
  if (pods.rows.length === 0) {
    return <GpuEmptyState isLoading={pods.isLoading} />;
  }
  // Pods exist but none survived, so the filter is on by definition.
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        No accelerator pod matches the current filters — clear a filter to widen the view.
      </p>
    );
  }

  const sortable = { sort, onToggle: toggle };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <SortableTh label="Accelerator" sortKey="accelerator" {...sortable} />
            <SortableTh label="Namespace" sortKey="namespace" {...sortable} />
            <SortableTh label="Service" sortKey="service" {...sortable} />
            <SortableTh label="Pod" sortKey="pod" {...sortable} />
            <SortableTh label="Device" sortKey="device" {...sortable} title="GPU index on the node (DCGM) or NeuronCores requested by the pod" />
            <SortableTh
              label="Utilization"
              sortKey="util"
              {...sortable}
              title="GPU: DCGM utilisation of that GPU. Neuron: core utilisation averaged over the pod's node."
            />
            <SortableTh
              label="Memory used"
              sortKey="memory"
              {...sortable}
              align="right"
              title="GPU: framebuffer used on that GPU. Neuron: device memory held by runtimes on the pod's node."
            />
            <SortableTh label="Power" sortKey="watts" {...sortable} align="right" />
            <SortableTh label="Temp" sortKey="temp" {...sortable} align="right" />
            <SortableTh label="Tenants" sortKey="tenants" {...sortable} className="" title="LiteLLM teams with a virtual key routed to this pod's model pool" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PodRow key={row.key} row={row} color={serviceColor.get(row.service) ?? colorForIndex(0)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PodRow({ row, color }: { row: AcceleratorPodRow; color: string }) {
  const tempLevel = levelFor(row.tempC, { warning: GPU_TEMP_WARNING_C, critical: GPU_TEMP_CRITICAL_C });
  const shared = row.sharedWith > 0;
  const nodeNote = shared
    ? `Node figures — ${row.sharedWith + 1} Neuron pods share this node, so utilisation and memory are the node's, not this pod's alone.`
    : undefined;
  return (
    <tr className="border-b border-gridline/60 last:border-0">
      <td className="py-2 pr-4 text-ink-secondary">
        <span className="inline-flex items-center gap-2">
          <span
            className="rounded-md bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted ring-1 ring-white/10"
            title={ACCELERATOR_KIND_LABEL[row.kind]}
          >
            {row.kind === "gpu" ? "GPU" : "Neuron"}
          </span>
          {row.accelerator}
        </span>
      </td>
      <td className="py-2 pr-4 text-ink-secondary">{row.namespace}</td>
      <td className="py-2 pr-4 text-ink">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          {row.service}
        </span>
      </td>
      <td className="max-w-[16rem] truncate py-2 pr-4 font-mono text-[11px] text-ink-secondary" title={row.node ? `${row.pod} · ${row.node}` : row.pod}>
        {row.pod}
      </td>
      <td className="tabular py-2 pr-4 text-ink-secondary">{row.device}</td>
      <td className="py-2 pr-4">
        <UtilBar value={row.util} color={color} note={nodeNote} />
      </td>
      <td className="tabular py-2 pr-4 text-right text-ink" title={nodeNote}>
        {formatBytes(row.memoryBytes)}
        {shared && <span className="ml-1 text-ink-muted" aria-hidden="true">*</span>}
      </td>
      <td className="tabular py-2 pr-4 text-right text-ink">
        {row.watts === null ? <Dash reason={row.kind === "neuron" ? "neuron-monitor does not report board power" : undefined} /> : formatWatts(row.watts)}
      </td>
      <td className="tabular py-2 pr-4 text-right">
        {row.tempC === null ? (
          <Dash reason={row.kind === "neuron" ? "neuron-monitor does not report die temperature" : undefined} />
        ) : (
          <span
            className="inline-flex items-center gap-1"
            style={{ color: tempLevel && tempLevel !== "good" ? STATUS[tempLevel] : undefined }}
            title={tempLevel === "good" ? "Normal" : tempLevel === "warning" ? "Warm" : "Hot"}
          >
            {tempLevel && tempLevel !== "good" && <span aria-hidden="true">{STATUS_GLYPH[tempLevel]}</span>}
            <span className={tempLevel === "good" ? "text-ink" : undefined}>{formatCelsius(row.tempC)}</span>
          </span>
        )}
      </td>
      <td className="py-2 text-ink-muted">
        {row.tenants.length > 0 ? row.tenants.join(", ") : <Dash reason={row.model ? "No LiteLLM key routes to this pool" : "Not a vLLM engine — no gateway route"} />}
      </td>
    </tr>
  );
}

function Dash({ reason }: { reason?: string }) {
  return (
    <span className="text-ink-muted" title={reason}>
      —
    </span>
  );
}

/** Inline bar plus the number — the bar is a scan aid, the value is the fact. */
function UtilBar({ value, color, note }: { value: number | null; color: string; note?: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(value, 1)) * 100;
  return (
    <span className="flex items-center gap-2" title={note}>
      <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-gridline">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
      <span className="tabular w-10 text-right text-ink">{formatPercentUnit(value, 0)}</span>
      {note && <span className="text-ink-muted" aria-hidden="true">*</span>}
    </span>
  );
}
