"use client";

import { useMemo } from "react";
import {
  ACCELERATOR_KIND_LABEL,
  ACCELERATOR_UNIT,
  AcceleratorKind,
  neuronAcceleratorName,
} from "@/lib/accelerator";
import { AcceleratorScope } from "@/lib/acceleratorScope";
import { formatBytes, formatShort } from "@/lib/format";
import { ACCELERATORS, GPU_UTIL_IDLE, NEURON_UTIL_IDLE } from "@/lib/queries";
import { STATUS, STATUS_GLYPH, StatusLevel, colorForIndex } from "@/lib/theme";
import { numCol, sortRows, strCol, useSortState } from "@/lib/sort";
import { useInstantVector } from "@/lib/useSeries";
import { RatioBar } from "./RatioBar";
import { SortableTh } from "./SortableTh";

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

/** Physical GPU identity within the fleet: UUID when the exporter reports it,
 *  the node's GPU index otherwise. Both memory and utilisation series carry it. */
function deviceKey(labels: Record<string, string>): string {
  return `${labels.Hostname ?? ""}|${labels.UUID || labels.gpu || ""}`;
}

/**
 * Builds the fleet rows from the two exporters. Everything is an instant vector
 * joined client-side; the section re-renders as SWR revalidates.
 *
 * The aggregation is per device (NVIDIA) and per node (Neuron) rather than
 * per model, because the section filter has to be able to drop individual GPUs
 * and nodes out of a row: a `by (modelName)` average from Prometheus cannot be
 * un-summed once a namespace or tenant selection excludes some of the pods
 * behind it. A row disappears entirely when nothing in it survives the filter.
 */
export function useAcceleratorFleet(scope: AcceleratorScope): {
  rows: FleetRow[];
  isLoading: boolean;
  error: Error | undefined;
} {
  const gpuDevices = useInstantVector(ACCELERATORS.gpuPerDevice);
  const gpuMemory = useInstantVector(ACCELERATORS.gpuMemoryPerDevice);
  const gpuCapacity = useInstantVector(ACCELERATORS.gpuCapacityByNode);
  const neuronHardware = useInstantVector(ACCELERATORS.neuronHardware);
  const neuronActive = useInstantVector(ACCELERATORS.neuronCoresActiveByNode);
  const neuronUtilSum = useInstantVector(ACCELERATORS.neuronUtilSumByNode);
  const neuronMemory = useInstantVector(ACCELERATORS.neuronMemoryByNode);
  const neuronRequested = useInstantVector(ACCELERATORS.neuronRequestedByNode);

  const all = [gpuDevices, gpuMemory, gpuCapacity, neuronHardware, neuronActive, neuronUtilSum, neuronMemory, neuronRequested];
  const isLoading = all.some((r) => r.isLoading) || scope.isLoading;
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

    /* NVIDIA: one series per physical GPU, so the filter can exclude a single
       device; capacity joined from kube-state-metrics on the node name. */
    const gpuCapacityByNode = byLabel(gpuCapacity.rows, "node");
    const gpuMemoryByDevice = new Map(gpuMemory.rows.map((r) => [deviceKey(r.labels), r.value]));
    const gpuNodesByName = new Map<string, Set<string>>();
    const gpuUtilByName = new Map<string, { sum: number; devices: number }>();
    for (const r of gpuDevices.rows) {
      const name = r.labels.modelName || "NVIDIA GPU";
      const pod = r.labels.pod ?? "";
      const inScope =
        !scope.active || (scope.accelerators.has(name) && (!scope.podBound || (pod !== "" && scope.pods.has(pod))));
      if (!inScope) continue;

      const row = get("gpu", name);
      row.devicesActive += 1;
      if (pod !== "") row.allocated += 1;
      const nodes = gpuNodesByName.get(name) ?? new Set<string>();
      if (r.labels.Hostname) nodes.add(r.labels.Hostname);
      gpuNodesByName.set(name, nodes);
      const util = gpuUtilByName.get(name) ?? { sum: 0, devices: 0 };
      util.sum += r.value;
      util.devices += 1;
      gpuUtilByName.set(name, util);
      const memory = gpuMemoryByDevice.get(deviceKey(r.labels));
      if (memory !== undefined) row.memoryBytes = (row.memoryBytes ?? 0) + memory;
    }
    for (const [name, nodes] of gpuNodesByName) {
      const row = out.get(name);
      if (!row) continue;
      row.nodes = nodes.size;
      for (const node of nodes) {
        const capacity = gpuCapacityByNode.get(node);
        if (capacity !== undefined) row.devicesCapacity = (row.devicesCapacity ?? 0) + capacity;
      }
    }
    for (const [name, util] of gpuUtilByName) {
      const row = out.get(name);
      // DCGM reports 0..100; every other utilisation in the dashboard is 0..1.
      if (row && util.devices > 0) row.util = util.sum / util.devices / 100;
    }

    /* Neuron: per node, folded into the instance family. neuron-monitor has no
       pod label, so the scope hook resolved the filter to a set of nodes. */
    const utilSumByNode = byLabel(neuronUtilSum.rows, "node");
    const activeByNode = byLabel(neuronActive.rows, "node");
    const memoryByNode = byLabel(neuronMemory.rows, "node");
    const requestedByNode = byLabel(neuronRequested.rows, "node");
    const neuronUtilByName = new Map<string, number>();
    for (const r of neuronHardware.rows) {
      const node = r.labels.node ?? "";
      if (scope.active && !scope.neuronNodes.has(node)) continue;
      const type = r.labels.instance_type ?? "";
      const name = neuronAcceleratorName(type);
      const row = get("neuron", name);
      row.nodes += 1;
      if (type && !row.instanceTypes.includes(type)) row.instanceTypes.push(type);
      const cores = Number(r.labels.neuron_device_count) * Number(r.labels.neuroncore_per_device_count);
      if (Number.isFinite(cores)) row.devicesCapacity = (row.devicesCapacity ?? 0) + cores;
      row.devicesActive += activeByNode.get(node) ?? 0;
      neuronUtilByName.set(name, (neuronUtilByName.get(name) ?? 0) + (utilSumByNode.get(node) ?? 0));
      const memory = memoryByNode.get(node);
      if (memory !== undefined) row.memoryBytes = (row.memoryBytes ?? 0) + memory;
      row.allocated += requestedByNode.get(node) ?? 0;
    }
    for (const [name, sum] of neuronUtilByName) {
      const row = out.get(name);
      if (row && row.devicesActive > 0) row.util = sum / row.devicesActive;
    }

    return [...out.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "gpu" ? -1 : 1));
  }, [gpuDevices.rows, gpuMemory.rows, gpuCapacity.rows, neuronHardware.rows, neuronActive.rows, neuronUtilSum.rows, neuronMemory.rows, neuronRequested.rows, scope]);

  return { rows, isLoading, error };
}

type FleetSortKey = "accelerator" | "type" | "nodes" | "devices" | "allocated" | "util" | "memory" | "state";

/** Serving first, then allocated-but-idle, then unallocated — the order an operator triages in. */
const FLEET_STATE_RANK: Record<FleetState, number> = { serving: 0, stranded: 1, unallocated: 2 };

/** Sorting by name keeps the vendors grouped (GPU families before Neuron), as the table has always been laid out. */
const FLEET_COLUMNS = [
  strCol<FleetRow, FleetSortKey>("accelerator", (r) => `${r.kind === "gpu" ? "0" : "1"} ${r.name}`),
  strCol<FleetRow, FleetSortKey>("type", (r) => ACCELERATOR_KIND_LABEL[r.kind]),
  numCol<FleetRow, FleetSortKey>("nodes", (r) => r.nodes),
  numCol<FleetRow, FleetSortKey>("devices", (r) => r.devicesActive),
  numCol<FleetRow, FleetSortKey>("allocated", (r) => r.allocated),
  numCol<FleetRow, FleetSortKey>("util", (r) => r.util),
  numCol<FleetRow, FleetSortKey>("memory", (r) => r.memoryBytes),
  { key: "state" as FleetSortKey, get: (r: FleetRow) => FLEET_STATE_RANK[stateFor(r)], initial: "asc" as const },
];

function fleetTieBreak(a: FleetRow, b: FleetRow): number {
  return a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "gpu" ? -1 : 1;
}

interface AcceleratorFleetTableProps {
  rows: FleetRow[];
  isLoading: boolean;
  error: Error | undefined;
  selected: AcceleratorKind;
  onSelect: (kind: AcceleratorKind) => void;
  /** True when the section filter is on — an empty table then means "nothing matched", not "nothing exists". */
  filtered?: boolean;
}

/**
 * The fleet at a glance: one row per accelerator type, both vendors in the
 * same table so an inf2 pool and an L40S pool are compared on the same
 * columns. Clicking a row opens that family's detail panels below.
 */
export function AcceleratorFleetTable({ rows, isLoading, error, selected, onSelect, filtered }: AcceleratorFleetTableProps) {
  const { sort, toggle } = useSortState<FleetSortKey>({ key: "accelerator", dir: "asc" }, FLEET_COLUMNS);
  // Colour is keyed to the row's name in the hook's order, so sorting never recolours a family.
  const colorByName = useMemo(() => new Map(rows.map((r, i) => [r.name, colorForIndex(i)])), [rows]);
  const sorted = useMemo(() => sortRows(rows, sort, FLEET_COLUMNS, fleetTieBreak), [rows, sort]);

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
          : filtered
            ? "No accelerator matches the current filters — clear a filter to widen the view."
            : "No accelerator is reporting right now — no GPU node (DCGM) and no Inferentia / Trainium node (neuron-monitor) is in the cluster."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <SortableTh label="Accelerator" sortKey="accelerator" sort={sort} onToggle={toggle} />
            <SortableTh label="Type" sortKey="type" sort={sort} onToggle={toggle} />
            <SortableTh label="Nodes" sortKey="nodes" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="Devices" sortKey="devices" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="Allocated" sortKey="allocated" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="Avg util" sortKey="util" sort={sort} onToggle={toggle} />
            <SortableTh label="Memory in use" sortKey="memory" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="State" sortKey="state" sort={sort} onToggle={toggle} className="" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const state = stateFor(row);
            const level = STATE_STATUS[state];
            const unit = ACCELERATOR_UNIT[row.kind];
            const active = row.kind === selected;
            const color = colorByName.get(row.name) ?? colorForIndex(0);
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
                  <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: color }} aria-hidden="true" />
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
                  <RatioBar value={row.util} color={color} />
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
