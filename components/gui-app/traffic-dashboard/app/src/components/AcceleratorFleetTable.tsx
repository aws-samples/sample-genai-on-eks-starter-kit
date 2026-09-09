"use client";

import { useMemo } from "react";
import {
  ACCELERATOR_KIND_LABEL,
  ACCELERATOR_UNIT,
  AcceleratorKind,
  neuronAcceleratorName,
} from "@/lib/accelerator";
import { formatBytes, formatShort } from "@/lib/format";
import { ACCELERATORS, GPU_UTIL_IDLE, NEURON_UTIL_IDLE } from "@/lib/queries";
import { STATUS, STATUS_GLYPH, StatusLevel, colorForIndex } from "@/lib/theme";
import { useInstantVector } from "@/lib/useSeries";
import { RatioBar } from "./RatioBar";

export interface FleetRow {
  kind: AcceleratorKind;
  /** "NVIDIA L40S", "AWS Inferentia2" — the same names the Accelerator filter and column use. */
  name: string;
  /** Instance types behind the row (Neuron) — DCGM does not know the instance type. */
  instanceTypes: string[];
  nodes: number;
  /** GPUs the DCGM exporter sees / NeuronCores with a runtime attached. */
  devicesActive: number;
  /** Devices the nodes advertise to the scheduler (kube-state-metrics node capacity). */
  devicesCapacity: number | null;
  /** GPUs a pod is scheduled on / NeuronCores requested by pods. */
  allocated: number;
  util: number | null;
  memoryBytes: number | null;
}

type FleetState = "serving" | "stranded" | "unallocated";

const STATE_LABEL: Record<FleetState, string> = {
  serving: "Serving",
  stranded: "Allocated, idle",
  unallocated: "Unallocated",
};

const STATE_STATUS: Record<FleetState, StatusLevel | undefined> = {
  serving: "good",
  stranded: "warning",
  unallocated: undefined,
};

function stateFor(row: FleetRow): FleetState {
  if (row.allocated <= 0) return "unallocated";
  const idle = row.kind === "gpu" ? GPU_UTIL_IDLE : NEURON_UTIL_IDLE;
  if (row.util !== null && row.util < idle) return "stranded";
  return "serving";
}

function stateHint(row: FleetRow, state: FleetState): string {
  const unit = ACCELERATOR_UNIT[row.kind].plural;
  switch (state) {
    case "serving":
      return `${unit} are allocated to pods and computing.`;
    case "stranded":
      return `${unit} are allocated to pods (and billed) but the fleet averages under ${Math.round(
        (row.kind === "gpu" ? GPU_UTIL_IDLE : NEURON_UTIL_IDLE) * 100,
      )}% utilisation. Check whether the model is still loading, starved of requests upstream, or stalled on storage / network I/O.`;
    default:
      return `No pod has requested any of these ${unit}.`;
  }
}

/**
 * Builds the fleet rows from the two exporters. Everything is an instant
 * vector joined client-side; the section re-renders as SWR revalidates.
 */
export function useAcceleratorFleet(): { rows: FleetRow[]; isLoading: boolean; error: Error | undefined } {
  const gpuDevices = useInstantVector(ACCELERATORS.gpuDevicesByModelNode);
  const gpuAllocated = useInstantVector(ACCELERATORS.gpuAllocatedByModel);
  const gpuUtil = useInstantVector(ACCELERATORS.gpuUtilByModel);
  const gpuMemory = useInstantVector(ACCELERATORS.gpuMemoryByModel);
  const gpuCapacity = useInstantVector(ACCELERATORS.gpuCapacityByNode);
  const neuronHardware = useInstantVector(ACCELERATORS.neuronHardware);
  const neuronActive = useInstantVector(ACCELERATORS.neuronCoresActiveByType);
  const neuronUtilSum = useInstantVector(ACCELERATORS.neuronUtilSumByType);
  const neuronMemory = useInstantVector(ACCELERATORS.neuronMemoryByType);
  const neuronRequested = useInstantVector(ACCELERATORS.neuronRequestedByNode);

  const all = [gpuDevices, gpuAllocated, gpuUtil, gpuMemory, gpuCapacity, neuronHardware, neuronActive, neuronUtilSum, neuronMemory, neuronRequested];
  const isLoading = all.some((r) => r.isLoading);
  const error = all.find((r) => r.error)?.error;

  const rows = useMemo(() => {
    const out = new Map<string, FleetRow>();
    const get = (kind: AcceleratorKind, name: string): FleetRow => {
      let row = out.get(name);
      if (!row) {
        row = { kind, name, instanceTypes: [], nodes: 0, devicesActive: 0, devicesCapacity: null, allocated: 0, util: null, memoryBytes: null };
        out.set(name, row);
      }
      return row;
    };
    const byLabel = (rows: { labels: Record<string, string>; value: number }[], key: string) =>
      new Map(rows.map((r) => [r.labels[key] ?? "", r.value]));

    /* NVIDIA: (model, node) → devices; capacity joined from KSM on the node name. */
    const gpuCapacityByNode = byLabel(gpuCapacity.rows, "node");
    for (const r of gpuDevices.rows) {
      const name = r.labels.modelName || "NVIDIA GPU";
      const row = get("gpu", name);
      row.nodes += 1;
      row.devicesActive += r.value;
      const cap = gpuCapacityByNode.get(r.labels.Hostname ?? "");
      if (cap !== undefined) row.devicesCapacity = (row.devicesCapacity ?? 0) + cap;
    }
    for (const r of gpuAllocated.rows) if (out.has(r.labels.modelName ?? "")) get("gpu", r.labels.modelName!).allocated = r.value;
    for (const r of gpuUtil.rows) if (out.has(r.labels.modelName ?? "")) get("gpu", r.labels.modelName!).util = r.value;
    for (const r of gpuMemory.rows) if (out.has(r.labels.modelName ?? "")) get("gpu", r.labels.modelName!).memoryBytes = r.value;

    /* Neuron: node → generation via instance family; per-type series folded into the generation. */
    const familyOfType = new Map<string, string>();
    const nodeType = new Map<string, string>();
    for (const r of neuronHardware.rows) {
      const type = r.labels.instance_type ?? "";
      const name = neuronAcceleratorName(type);
      familyOfType.set(type, name);
      nodeType.set(r.labels.node ?? "", type);
      const row = get("neuron", name);
      row.nodes += 1;
      if (type && !row.instanceTypes.includes(type)) row.instanceTypes.push(type);
      const cores = Number(r.labels.neuron_device_count) * Number(r.labels.neuroncore_per_device_count);
      if (Number.isFinite(cores)) row.devicesCapacity = (row.devicesCapacity ?? 0) + cores;
    }
    const utilSum = new Map<string, number>();
    for (const r of neuronActive.rows) {
      const name = familyOfType.get(r.labels.instance_type ?? "");
      if (name) get("neuron", name).devicesActive += r.value;
    }
    for (const r of neuronUtilSum.rows) {
      const name = familyOfType.get(r.labels.instance_type ?? "");
      if (name) utilSum.set(name, (utilSum.get(name) ?? 0) + r.value);
    }
    for (const [name, sum] of utilSum) {
      const row = out.get(name);
      if (row && row.devicesActive > 0) row.util = sum / row.devicesActive;
    }
    for (const r of neuronMemory.rows) {
      const name = familyOfType.get(r.labels.instance_type ?? "");
      if (name) {
        const row = get("neuron", name);
        row.memoryBytes = (row.memoryBytes ?? 0) + r.value;
      }
    }
    for (const r of neuronRequested.rows) {
      const name = familyOfType.get(nodeType.get(r.labels.node ?? "") ?? "");
      if (name) get("neuron", name).allocated += r.value;
    }

    return [...out.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "gpu" ? -1 : 1));
  }, [gpuDevices.rows, gpuAllocated.rows, gpuUtil.rows, gpuMemory.rows, gpuCapacity.rows, neuronHardware.rows, neuronActive.rows, neuronUtilSum.rows, neuronMemory.rows, neuronRequested.rows]);

  return { rows, isLoading, error };
}

interface AcceleratorFleetTableProps {
  rows: FleetRow[];
  isLoading: boolean;
  error: Error | undefined;
  selected: AcceleratorKind;
  onSelect: (kind: AcceleratorKind) => void;
}

/**
 * The fleet at a glance: one row per accelerator type, both vendors in the
 * same table so an inf2 pool and an L40S pool are compared on the same
 * columns. Clicking a row opens that family's detail panels below.
 */
export function AcceleratorFleetTable({ rows, isLoading, error, selected, onSelect }: AcceleratorFleetTableProps) {
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
        {isLoading
          ? "Loading…"
          : "No accelerator is reporting right now — no GPU node (DCGM) and no Inferentia / Trainium node (neuron-monitor) is in the cluster."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <th className="py-2 pr-4 font-medium">Accelerator</th>
            <th className="py-2 pr-4 font-medium">Type</th>
            <th className="py-2 pr-4 text-right font-medium">Nodes</th>
            <th className="py-2 pr-4 text-right font-medium">Devices</th>
            <th className="py-2 pr-4 text-right font-medium">Allocated</th>
            <th className="py-2 pr-4 font-medium">Avg util</th>
            <th className="py-2 pr-4 text-right font-medium">Memory in use</th>
            <th className="py-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const state = stateFor(row);
            const level = STATE_STATUS[state];
            const unit = ACCELERATOR_UNIT[row.kind];
            const active = row.kind === selected;
            return (
              <tr
                key={row.name}
                onClick={() => onSelect(row.kind)}
                className={`cursor-pointer border-b border-gridline/60 last:border-0 transition-colors hover:bg-surface-raised/60 ${
                  active ? "bg-surface-raised/40" : ""
                }`}
                title={`Show ${ACCELERATOR_KIND_LABEL[row.kind]} detail`}
              >
                <td className="py-2 pr-4 text-ink">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: colorForIndex(index) }} aria-hidden="true" />
                  {row.name}
                  {row.instanceTypes.length > 0 && (
                    <span className="ml-1 rounded bg-surface-raised px-1 font-mono text-[10px] text-ink-secondary">{row.instanceTypes.join(", ")}</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-ink-secondary">{ACCELERATOR_KIND_LABEL[row.kind]}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatShort(row.nodes, 0)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">
                  {formatShort(row.devicesActive, 0)}
                  <span className="text-ink-muted"> / {row.devicesCapacity === null ? "—" : formatShort(row.devicesCapacity, 0)} {unit.plural}</span>
                </td>
                <td className="tabular py-2 pr-4 text-right text-ink">
                  {formatShort(row.allocated, 0)} <span className="text-ink-muted">{row.allocated === 1 ? unit.singular : unit.plural}</span>
                </td>
                <td className="py-2 pr-4">
                  <RatioBar value={row.util} color={colorForIndex(index)} />
                </td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatBytes(row.memoryBytes)}</td>
                <td className="py-2">
                  <span className="inline-flex items-center gap-1" style={{ color: level ? STATUS[level] : undefined }} title={stateHint(row, state)}>
                    {level && level !== "good" && <span aria-hidden="true">{STATUS_GLYPH[level]}</span>}
                    <span className={level ? undefined : "text-ink-muted"}>{STATE_LABEL[state]}</span>
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
