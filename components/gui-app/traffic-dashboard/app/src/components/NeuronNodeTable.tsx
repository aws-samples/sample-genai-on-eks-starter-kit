"use client";

import { neuronAcceleratorName } from "@/lib/accelerator";
import { formatBytes, formatSeconds, formatShort } from "@/lib/format";
import { NEURON, NEURON_UTIL_IDLE } from "@/lib/queries";
import { STATUS, STATUS_GLYPH, StatusLevel, colorForIndex } from "@/lib/theme";
import { useInstantVector } from "@/lib/useSeries";
import { NeuronEmptyState } from "./NeuronEmptyState";
import { RatioBar } from "./RatioBar";

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

/**
 * One row per Neuron node. neuron-monitor reports per node and per runtime
 * process, not per pod, so the model pods are looked up through kube_pod_info
 * on the same node. The state column is the "is this accelerator actually
 * working" verdict: cores can be allocated to a pod (and billed) while the
 * NeuronCores sit idle.
 */
export function NeuronNodeTable() {
  const hardware = useInstantVector(NEURON.nodeHardware);
  const util = useInstantVector(NEURON.nodeCoreUtil);
  const active = useInstantVector(NEURON.nodeCoresActive);
  const capacity = useInstantVector(NEURON.nodeCoresCapacity);
  const deviceMemory = useInstantVector(NEURON.nodeDeviceMemoryBytes);
  const hostMemory = useInstantVector(NEURON.nodeHostMemoryBytes);
  const execRate = useInstantVector(NEURON.nodeExecPerSecond);
  const execP99 = useInstantVector(NEURON.nodeExecLatencyP99);
  const execErrors = useInstantVector(NEURON.nodeExecErrorsPerMin);
  const ecc = useInstantVector(NEURON.nodeEccEventsHour);
  const pods = useInstantVector(NEURON.nodeModelPods);

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

  const rows: NeuronNodeRow[] = hardware.rows
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
    })
    .sort((a, b) => (a.coreUtil ?? -1) - (b.coreUtil ?? -1) || a.node.localeCompare(b.node));

  const error = hardware.error ?? util.error;
  if (error) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        <span className="text-status-serious">▲</span> Query failed — {error.message}
      </p>
    );
  }
  if (rows.length === 0) {
    return <NeuronEmptyState isLoading={hardware.isLoading} height={160} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <th className="py-2 pr-4 font-medium">Node</th>
            <th className="py-2 pr-4 font-medium">Accelerator</th>
            <th className="py-2 pr-4 font-medium">Model pod</th>
            <th className="py-2 pr-4 text-right font-medium">Cores</th>
            <th className="py-2 pr-4 font-medium">Core util</th>
            <th className="py-2 pr-4 text-right font-medium">Device memory</th>
            <th className="py-2 pr-4 text-right font-medium">Host memory</th>
            <th className="py-2 pr-4 text-right font-medium">Exec /s</th>
            <th className="py-2 pr-4 text-right font-medium">Exec p99</th>
            <th className="py-2 pr-4 text-right font-medium">Errors /min</th>
            <th className="py-2 pr-4 text-right font-medium">ECC (1h)</th>
            <th className="py-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
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
                  <RatioBar value={row.coreUtil} color={colorForIndex(index)} />
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
