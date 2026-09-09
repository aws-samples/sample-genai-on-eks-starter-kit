"use client";

import { useMemo } from "react";
import { AcceleratorKind, acceleratorKind, neuronAcceleratorName } from "./accelerator";
import { AcceleratorFilter, isFiltering, matchesFilter } from "./acceleratorFilter";
import { useAcceleratorPods } from "./acceleratorPods";
import { ACCELERATORS, ACCEL_PODS } from "./queries";
import { useInstantVector } from "./useSeries";

/**
 * Turns the section filter into the two things the panels below it need: sets of
 * pods and nodes for the client-side tables, and PromQL label-matcher fragments
 * for the detail panels.
 *
 * The detail panels are the reason this exists. DCGM and neuron-monitor read
 * hardware, not the Kubernetes object graph: their series carry `modelName` /
 * `Hostname` / `node` and (for DCGM) `pod`, but never a namespace, a workload
 * name or a tenant. So "show me only team X's Inferentia pods" cannot be
 * expressed as a matcher directly — it has to be resolved here, against the pod
 * inventory the section already loads, into the concrete pods and nodes that
 * satisfy it, and only then handed to Prometheus as a matcher. Doing it
 * server-side matters for the time-series panels: narrowing after the fact would
 * still pull every GPU's samples and would break the eight-series "Other" fold.
 */
export interface AcceleratorScope {
  /** True when at least one dimension is selected — panels use it to switch to filtered empty copy. */
  active: boolean;
  filter: AcceleratorFilter;
  /** Namespaces / services / tenants are pod properties, so only pod-attributed data can match. */
  podBound: boolean;
  /** Pod names matching the filter. */
  pods: Set<string>;
  /** NVIDIA hostnames in scope (DCGM's `Hostname` is the Kubernetes node name). */
  gpuNodes: Set<string>;
  /** Neuron node names in scope. */
  neuronNodes: Set<string>;
  /** Accelerator names in scope — the selection, or everything seen when nothing is selected. */
  accelerators: Set<string>;
  /** Every accelerator the exporters report, unfiltered — the option list of the filter bar. */
  allAccelerators: { name: string; kind: AcceleratorKind }[];
  /** Every accelerator node the exporters report, unfiltered — the denominator of the summary line. */
  allNodes: Set<string>;
  /** PromQL label-matcher fragment for DCGM series, "" when not active. */
  gpuMatcher: string;
  /** PromQL label-matcher fragment for neuron-monitor / kube-state-metrics node series, "" when not active. */
  neuronMatcher: string;
  isLoading: boolean;
}

/**
 * Escapes RE2 metacharacters for a PromQL `=~` matcher.
 *
 * Two backslashes on purpose: the value ends up inside a double-quoted PromQL
 * string, which processes Go-style escapes, so the text `\\.` is what decodes to
 * the regex `\.`. A single backslash would be rejected as an unknown escape
 * sequence. Prometheus anchors `=~` at both ends, so no `^`/`$` is added.
 */
export function escapeRe(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\\\$&");
}

function alternation(values: Iterable<string>): string {
  return [...values].map(escapeRe).join("|");
}

/** A matcher that deliberately selects nothing, for "the filter is on and
 *  nothing satisfies it" — an empty fragment would silently mean "everything". */
function noneMatcher(label: string): string {
  return `${label}="__none__"`;
}

export function useAcceleratorScope(filter: AcceleratorFilter): AcceleratorScope {
  const pods = useAcceleratorPods();
  // Accelerator inventory, unfiltered: these two include hardware no pod has
  // claimed, which the pod rows by definition cannot show.
  const gpuDevices = useInstantVector(ACCELERATORS.gpuDevicesByModelNode);
  const neuronNodeType = useInstantVector(ACCEL_PODS.neuronNodeInstanceType);

  const isLoading = pods.isLoading || gpuDevices.isLoading || neuronNodeType.isLoading;

  return useMemo<AcceleratorScope>(() => {
    const active = isFiltering(filter);
    const podBound = filter.namespaces.length > 0 || filter.services.length > 0 || filter.tenants.length > 0;

    /* Inventory: accelerator name → nodes, from the exporters directly. */
    const gpuNodesByName = new Map<string, Set<string>>();
    for (const row of gpuDevices.rows) {
      const name = row.labels.modelName || "NVIDIA GPU";
      const host = row.labels.Hostname;
      if (!host) continue;
      const set = gpuNodesByName.get(name) ?? new Set<string>();
      set.add(host);
      gpuNodesByName.set(name, set);
    }
    const neuronNameByNode = new Map<string, string>();
    for (const row of neuronNodeType.rows) {
      if (!row.labels.node) continue;
      neuronNameByNode.set(row.labels.node, neuronAcceleratorName(row.labels.instance_type));
    }

    const allAccelerators: { name: string; kind: AcceleratorKind }[] = [
      ...[...gpuNodesByName.keys()].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, kind: "gpu" as const })),
      ...[...new Set(neuronNameByNode.values())]
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name, kind: "neuron" as const })),
    ];
    const allNodes = new Set<string>([
      ...[...gpuNodesByName.values()].flatMap((nodes) => [...nodes]),
      ...neuronNameByNode.keys(),
    ]);

    const accelerators = new Set(
      filter.accelerators.length > 0 ? filter.accelerators : allAccelerators.map((entry) => entry.name),
    );

    /* Pods the filter admits, split by family: DCGM matchers key on the pod,
       neuron-monitor's on the pod's node. */
    const matching = pods.rows.filter((row) => matchesFilter(row, filter));
    const podNames = new Set(matching.map((row) => row.pod));
    const gpuPods = new Set(matching.filter((row) => row.kind === "gpu").map((row) => row.pod));
    const gpuPodNodes = new Set(
      matching.filter((row) => row.kind === "gpu" && row.node).map((row) => row.node as string),
    );
    const neuronPodNodes = new Set(
      matching.filter((row) => row.kind === "neuron" && row.node).map((row) => row.node as string),
    );

    /* GPU side. */
    const gpuParts: string[] = [];
    if (filter.accelerators.length > 0) {
      const gpuNames = filter.accelerators.filter((name) => acceleratorKind(name) === "gpu");
      gpuParts.push(gpuNames.length === 0 ? noneMatcher("modelName") : `modelName=~"${alternation(gpuNames)}"`);
    }
    if (podBound) {
      gpuParts.push(gpuPods.size === 0 ? noneMatcher("pod") : `pod=~"${alternation(gpuPods)}"`);
    }
    // Pod-bound scopes can only name nodes a matching pod sits on; otherwise the
    // exporter's own (model, node) inventory answers it, unallocated GPUs included.
    const gpuNodes = active && podBound
      ? gpuPodNodes
      : new Set(
          [...gpuNodesByName]
            .filter(([name]) => !active || accelerators.has(name))
            .flatMap(([, nodes]) => [...nodes]),
        );

    /* Neuron side: start from every Neuron node, then narrow. */
    let neuronNodes = new Set(neuronNameByNode.keys());
    if (filter.accelerators.length > 0) {
      neuronNodes = new Set([...neuronNodes].filter((node) => accelerators.has(neuronNameByNode.get(node) ?? "")));
    }
    if (podBound) {
      neuronNodes = new Set([...neuronNodes].filter((node) => neuronPodNodes.has(node)));
    }
    const neuronMatcher = !active
      ? ""
      : neuronNodes.size === 0
        ? noneMatcher("node")
        : `node=~"${alternation(neuronNodes)}"`;

    return {
      active,
      filter,
      podBound,
      pods: podNames,
      gpuNodes,
      neuronNodes,
      accelerators,
      allAccelerators,
      allNodes,
      gpuMatcher: active ? gpuParts.join(", ") : "",
      neuronMatcher,
      isLoading,
    };
  }, [filter, pods.rows, gpuDevices.rows, neuronNodeType.rows, isLoading]);
}
