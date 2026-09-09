"use client";

import { useMemo } from "react";
import { neuronAcceleratorName } from "@/lib/accelerator";
import { formatBytes, formatSeconds, formatShort } from "@/lib/format";
import { NEURON_UTIL_IDLE, neuronQueries } from "@/lib/queries";
import { numCol, sortRows, strCol, useSortState } from "@/lib/sort";
import { STATUS, STATUS_GLYPH, StatusLevel, colorForIndex } from "@/lib/theme";
import { useInstantVector } from "@/lib/useSeries";
import { FilteredEmptyState } from "./FilteredEmptyState";
import { NeuronEmptyState } from "./NeuronEmptyState";
import { RatioBar } from "./RatioBar";
import { SortableTh } from "./SortableTh";

interface NeuronNodeRow {
  node: string;
  instanceType: string;
  accelerator: string;
  zone: string;
  pods: string[];
  coresActive: number | null;
  coresCapacity: number | null;
  coreUtil: number | null;
  deviceMemoryBytes: number | null;
  deviceMemoryCapacityBytes: number | null;
  hostMemoryBytes: number | null;
  execPerSecond: number | null;
  execLatencyP99: number | null;
  execErrorsPerMin: number | null;
  eccEventsHour: number | null;
}

type NodeState = "busy" | "stranded" | "unallocated" | "errors";

const STATE_LABEL: Record<NodeState, string> = {
  busy: "Serving",
  stranded: "Allocated, idle",
  unallocated: "No runtime",
  errors: "Execution errors",
};

const STATE_HINT: Record<NodeState, string> = {
  busy: "Cores are attached to a runtime and doing work.",
  stranded: `Cores are attached to a runtime but utilisation is below ${Math.round(NEURON_UTIL_IDLE * 100)}% — the instance is paid for and not computing. Check whether the model pod is still loading, starved upstream, or stuck on I/O.`,
  unallocated: "No Neuron runtime is attached to any core on this node.",
  errors: "The runtime is reporting execution errors — see the error-type breakdown in Prometheus (execution_errors_total).",
};

const STATE_STATUS: Record<NodeState, StatusLevel | undefined> = {
  busy: "good",
  stranded: "warning",
  unallocated: undefined,
  errors: "critical",
};

/** Sort order for the State column: what needs attention first — errors, then paid-for idle cores, then serving, then no runtime. */
const STATE_RANK: Record<NodeState, number> = { errors: 0, stranded: 1, busy: 2, unallocated: 3 };

type NodeSortKey =
  | "node" | "accelerator" | "pods" | "cores" | "coreUtil" | "deviceMemory" | "hostMemory" | "exec" | "execP99" | "errors" | "ecc" | "state";

const NODE_COLUMNS = [
  strCol<NeuronNodeRow, NodeSortKey>("node", (r) => r.node),
  strCol<NeuronNodeRow, NodeSortKey>("accelerator", (r) => `${r.accelerator} ${r.instanceType}`),
  strCol<NeuronNodeRow, NodeSortKey>("pods", (r) => (r.pods.length ? r.pods.join(", ") : null)),
  numCol<NeuronNodeRow, NodeSortKey>("cores", (r) => r.coresActive),
  numCol<NeuronNodeRow, NodeSortKey>("coreUtil", (r) => r.coreUtil),
  numCol<NeuronNodeRow, NodeSortKey>("deviceMemory", (r) => r.deviceMemoryBytes),
  numCol<NeuronNodeRow, NodeSortKey>("hostMemory", (r) => r.hostMemoryBytes),
  numCol<NeuronNodeRow, NodeSortKey>("exec", (r) => r.execPerSecond),
  numCol<NeuronNodeRow, NodeSortKey>("execP99", (r) => r.execLatencyP99),
  numCol<NeuronNodeRow, NodeSortKey>("errors", (r) => r.execErrorsPerMin),
  numCol<NeuronNodeRow, NodeSortKey>("ecc", (r) => r.eccEventsHour),
  { key: "state" as NodeSortKey, get: (r: NeuronNodeRow) => STATE_RANK[nodeState(r)], initial: "asc" as const },
];

/**
 * One row per Neuron node. neuron-monitor reports per node and per runtime
 * process, not per pod, so the model pods are looked up through kube_pod_info
 * on the same node. The state column is the "is this accelerator actually
 * working" verdict: cores can be allocated to a pod (and billed) while the
 * NeuronCores sit idle.
 *
 * `matcher` is the section filter's `node` fragment, so a namespace, service or
 * tenant selection removes rows here too — resolved to nodes upstream in
 * lib/acceleratorScope.ts, since neuron-monitor knows nothing about pods.
 */
export function NeuronNodeTable({ matcher = "" }: { matcher?: string }) {
  const q = neuronQueries(matcher);
  // Idle-most node first, as the table has always opened: the stranded capacity is what this panel is for.
  const { sort, toggle } = useSortState<NodeSortKey>({ key: "coreUtil", dir: "asc" }, NODE_COLUMNS);
  const hardware = useInstantVector(q.nodeHardware);
  const util = useInstantVector(q.nodeCoreUtil);
  const active = useInstantVector(q.nodeCoresActive);
  const capacity = useInstantVector(q.nodeCoresCapacity);
  const deviceMemory = useInstantVector(q.nodeDeviceMemoryBytes);
  const hostMemory = useInstantVector(q.nodeHostMemoryBytes);
  const execRate = useInstantVector(q.nodeExecPerSecond);
  const execP99 = useInstantVector(q.nodeExecLatencyP99);
  const execErrors = useInstantVector(q.nodeExecErrorsPerMin);
  const ecc = useInstantVector(q.nodeEccEventsHour);
  const pods = useInstantVector(q.nodeModelPods);

  const byNode = (rows: { labels: Record<string, string>; value: number }[]) =>
    new Map(rows.map((row) => [row.labels.node, row.value]));
  const utilByNode = byNode(util.rows);
  const activeByNode = byNode(active.rows);
  const capacityByNode = byNode(capacity.rows);
  const deviceByNode = byNode(deviceMemory.rows);
  const hostByNode = byNode(hostMemory.rows);
  const execByNode = byNode(execRate.rows);
  const p99ByNode = byNode(execP99.rows);
  const errorsByNode = byNode(execErrors.rows);
  const eccByNode = byNode(ecc.rows);
  const podsByNode = new Map<string, string[]>();
  for (const row of pods.rows) {
    if (!row.labels.node || !row.labels.pod) continue;
    podsByNode.set(row.labels.node, [...(podsByNode.get(row.labels.node) ?? []), row.labels.pod].sort());
  }

  const unsorted: NeuronNodeRow[] = hardware.rows
    .filter((row) => !!row.labels.node)
    .map((row) => {
      const node = row.labels.node;
      const devices = Number(row.labels.neuron_device_count);
      const perDevice = Number(row.labels.neuron_device_memory_size);
      return {
        node,
        instanceType: row.labels.instance_type || "—",
        accelerator: neuronAcceleratorName(row.labels.instance_type),
        zone: row.labels.availability_zone || "—",
        pods: podsByNode.get(node) ?? [],
        coresActive: activeByNode.get(node) ?? 0,
        coresCapacity: capacityByNode.get(node) ?? null,
        coreUtil: utilByNode.get(node) ?? null,
        deviceMemoryBytes: deviceByNode.get(node) ?? null,
        deviceMemoryCapacityBytes: Number.isFinite(devices * perDevice) && devices * perDevice > 0 ? devices * perDevice : null,
        hostMemoryBytes: hostByNode.get(node) ?? null,
        execPerSecond: execByNode.get(node) ?? null,
        execLatencyP99: p99ByNode.get(node) ?? null,
        execErrorsPerMin: errorsByNode.get(node) ?? null,
        eccEventsHour: eccByNode.get(node) ?? null,
      };
    });
  const rows = sortRows(unsorted, sort, NODE_COLUMNS, (a, b) => a.node.localeCompare(b.node));
  // Colour follows the node name, not the row position, so re-sorting does not repaint the bars.
  const colorByNode = useMemo(() => {
    const names = hardware.rows.map((r) => r.labels.node).filter((n): n is string => !!n).sort();
    return new Map(names.map((n, i) => [n, colorForIndex(i)]));
  }, [hardware.rows]);

  const error = hardware.error ?? util.error;
  if (error) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        <span className="text-status-serious">▲</span> Query failed — {error.message}
      </p>
    );
  }
  if (rows.length === 0) {
    if (matcher && !hardware.isLoading) {
      return <FilteredEmptyState message="No Neuron node matches the current filters." height={160} />;
    }
    return <NeuronEmptyState isLoading={hardware.isLoading} height={160} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <SortableTh label="Node" sortKey="node" sort={sort} onToggle={toggle} />
            <SortableTh label="Accelerator" sortKey="accelerator" sort={sort} onToggle={toggle} />
            <SortableTh label="Model pod" sortKey="pods" sort={sort} onToggle={toggle} />
            <SortableTh label="Cores" sortKey="cores" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="Core util" sortKey="coreUtil" sort={sort} onToggle={toggle} />
            <SortableTh label="Device memory" sortKey="deviceMemory" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="Host memory" sortKey="hostMemory" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="Exec /s" sortKey="exec" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="Exec p99" sortKey="execP99" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="Errors /min" sortKey="errors" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="ECC (1h)" sortKey="ecc" sort={sort} onToggle={toggle} align="right" />
            <SortableTh label="State" sortKey="state" sort={sort} onToggle={toggle} className="" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const state = nodeState(row);
            const level = STATE_STATUS[state];
            return (
              <tr key={row.node} className="border-b border-gridline/60 last:border-0">
                <td className="py-2 pr-4 font-mono text-[11px] text-ink-secondary" title={row.zone}>
                  {row.node}
                </td>
                <td className="py-2 pr-4 text-ink">
                  {row.accelerator}
                  <span className="ml-1 rounded bg-surface-raised px-1 font-mono text-[10px] text-ink-secondary">{row.instanceType}</span>
                </td>
                <td className="max-w-[18rem] truncate py-2 pr-4 font-mono text-[11px] text-ink-secondary" title={row.pods.join("\n")}>
                  {row.pods.length > 0 ? row.pods.join(", ") : "—"}
                </td>
                <td className="tabular py-2 pr-4 text-right text-ink">
                  {formatShort(row.coresActive, 0)}
                  <span className="text-ink-muted"> / {row.coresCapacity === null ? "—" : formatShort(row.coresCapacity, 0)}</span>
                </td>
                <td className="py-2 pr-4">
                  <RatioBar value={row.coreUtil} color={colorByNode.get(row.node) ?? colorForIndex(0)} />
                </td>
                <td className="tabular py-2 pr-4 text-right text-ink">
                  {formatBytes(row.deviceMemoryBytes)}
                  {row.deviceMemoryCapacityBytes !== null && (
                    <span className="text-ink-muted"> / {formatBytes(row.deviceMemoryCapacityBytes, 0)}</span>
                  )}
                </td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatBytes(row.hostMemoryBytes)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatShort(row.execPerSecond)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatSeconds(row.execLatencyP99)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatShort(row.execErrorsPerMin)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatShort(row.eccEventsHour, 0)}</td>
                <td className="py-2">
                  <span
                    className="inline-flex items-center gap-1"
                    style={{ color: level ? STATUS[level] : undefined }}
                    title={STATE_HINT[state]}
                  >
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

function nodeState(row: NeuronNodeRow): NodeState {
  if (row.execErrorsPerMin !== null && row.execErrorsPerMin > 0) return "errors";
  if (!row.coresActive) return "unallocated";
  if (row.coreUtil !== null && row.coreUtil < NEURON_UTIL_IDLE) return "stranded";
  return "busy";
}
