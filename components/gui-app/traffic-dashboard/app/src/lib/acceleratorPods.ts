"use client";

import { useMemo } from "react";
import { AcceleratorKind, neuronAcceleratorName } from "./accelerator";
import { ACCEL_PODS, GPU } from "./queries";
import { useTenantsByModel } from "./tenants";
import { useInstantVector } from "./useSeries";
import { workloadFromPod } from "./workload";

export interface AcceleratorPodRow {
  key: string;
  kind: AcceleratorKind;
  namespace: string;
  pod: string;
  /** Workload name derived from the pod name (see lib/workload.ts). */
  service: string;
  node: string | null;
  /** vLLM model pool served by this pod, if it is an engine. */
  model: string | null;
  tenants: string[];
  /** DCGM modelName ("NVIDIA L40S") or the Neuron family ("AWS Inferentia2"). */
  accelerator: string;
  /** GPU index on the node, or "N cores" for a Neuron pod. */
  device: string;
  /** 0..1 */
  util: number | null;
  memoryBytes: number | null;
  watts: number | null;
  tempC: number | null;
  /** Neuron only: the node's cores/memory are reported per node and this many pods share it. */
  sharedWith: number;
}

export interface AcceleratorPods {
  rows: AcceleratorPodRow[];
  isLoading: boolean;
  error: Error | undefined;
}

/**
 * One row per (pod, physical GPU) for NVIDIA and one row per Neuron pod. The
 * two exporters see the world differently — DCGM labels each GPU with its pod,
 * neuron-monitor knows nodes and runtimes but not pods — so the Neuron side is
 * built from the scheduler: pods that requested NeuronCores, on which node,
 * joined with that node's utilisation and device memory. When several Neuron
 * pods share a node the node figures are shown against each and flagged.
 */
export function useAcceleratorPods(): AcceleratorPods {
  const gpuUtil = useInstantVector(GPU.podUtil);
  const gpuMemory = useInstantVector(GPU.podMemoryUsedBytes);
  const gpuPower = useInstantVector(GPU.podPowerWatts);
  const gpuTemp = useInstantVector(GPU.podTemp);
  const neuronPodNode = useInstantVector(ACCEL_PODS.neuronPodNode);
  const neuronPodCores = useInstantVector(ACCEL_PODS.neuronPodCores);
  const neuronNodeUtil = useInstantVector(ACCEL_PODS.neuronNodeUtil);
  const neuronNodeMemory = useInstantVector(ACCEL_PODS.neuronNodeDeviceMemoryBytes);
  const neuronNodeType = useInstantVector(ACCEL_PODS.neuronNodeInstanceType);
  const podModel = useInstantVector(ACCEL_PODS.podModel);
  const tenants = useTenantsByModel();

  const rows = useMemo<AcceleratorPodRow[]>(() => {
    const modelByPod = new Map(podModel.rows.map((r) => [podKey(r.labels), r.labels.model_name]));
    const tenantsFor = (model: string | null) => (model ? tenants.byModel.get(model) ?? [] : []);

    const memoryByGpu = new Map(gpuMemory.rows.map((r) => [gpuKey(r.labels), r.value]));
    const powerByGpu = new Map(gpuPower.rows.map((r) => [gpuKey(r.labels), r.value]));
    const tempByGpu = new Map(gpuTemp.rows.map((r) => [gpuKey(r.labels), r.value]));
    const gpuRows = gpuUtil.rows.map((r): AcceleratorPodRow => {
      const key = gpuKey(r.labels);
      const namespace = r.labels.namespace || "—";
      const pod = r.labels.pod || "—";
      const model = modelByPod.get(podKey(r.labels)) ?? null;
      return {
        key: `gpu|${key}`,
        kind: "gpu",
        namespace,
        pod,
        service: workloadFromPod(pod),
        node: r.labels.Hostname || null,
        model,
        tenants: tenantsFor(model),
        accelerator: r.labels.modelName || "NVIDIA GPU",
        device: r.labels.gpu ? `GPU ${r.labels.gpu}` : "—",
        util: r.value === null ? null : r.value / 100,
        memoryBytes: memoryByGpu.get(key) ?? null,
        watts: powerByGpu.get(key) ?? null,
        tempC: tempByGpu.get(key) ?? null,
        sharedWith: 0,
      };
    });

    const coresByPod = new Map(neuronPodCores.rows.map((r) => [podKey(r.labels), r.value]));
    const utilByNode = new Map(neuronNodeUtil.rows.map((r) => [r.labels.node, r.value]));
    const memoryByNode = new Map(neuronNodeMemory.rows.map((r) => [r.labels.node, r.value]));
    const typeByNode = new Map(neuronNodeType.rows.map((r) => [r.labels.node, r.labels.instance_type]));
    const podsPerNode = new Map<string, number>();
    for (const r of neuronPodNode.rows) podsPerNode.set(r.labels.node, (podsPerNode.get(r.labels.node) ?? 0) + 1);
    const neuronRows = neuronPodNode.rows.map((r): AcceleratorPodRow => {
      const namespace = r.labels.namespace || "—";
      const pod = r.labels.pod || "—";
      const node = r.labels.node || null;
      const model = modelByPod.get(podKey(r.labels)) ?? null;
      const cores = coresByPod.get(podKey(r.labels));
      return {
        key: `neuron|${namespace}|${pod}`,
        kind: "neuron",
        namespace,
        pod,
        service: workloadFromPod(pod),
        node,
        model,
        tenants: tenantsFor(model),
        accelerator: neuronAcceleratorName(node ? typeByNode.get(node) : undefined),
        device: cores === undefined ? "—" : `${cores} ${cores === 1 ? "core" : "cores"}`,
        util: node ? utilByNode.get(node) ?? null : null,
        memoryBytes: node ? memoryByNode.get(node) ?? null : null,
        watts: null,
        tempC: null,
        sharedWith: node ? Math.max((podsPerNode.get(node) ?? 1) - 1, 0) : 0,
      };
    });

    return [...gpuRows, ...neuronRows].sort(
      (a, b) => (b.util ?? -1) - (a.util ?? -1) || a.namespace.localeCompare(b.namespace) || a.pod.localeCompare(b.pod),
    );
  }, [
    gpuUtil.rows, gpuMemory.rows, gpuPower.rows, gpuTemp.rows,
    neuronPodNode.rows, neuronPodCores.rows, neuronNodeUtil.rows, neuronNodeMemory.rows, neuronNodeType.rows,
    podModel.rows, tenants.byModel,
  ]);

  return {
    rows,
    isLoading: gpuUtil.isLoading || neuronPodNode.isLoading,
    error: gpuUtil.error ?? neuronPodNode.error ?? podModel.error,
  };
}

function podKey(labels: Record<string, string>): string {
  return `${labels.namespace ?? ""}|${labels.pod ?? ""}`;
}

/** Physical GPU identity. UUID is authoritative; gpu index is the fallback for
 *  exporters configured without it. */
function gpuKey(labels: Record<string, string>): string {
  return [labels.pod ?? "", labels.UUID || labels.gpu || "", labels.gpu ?? ""].join("|");
}
