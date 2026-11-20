"use client";

import { useMemo } from "react";
import { SERVICE_GRAPH } from "./queries";
import { useInstantVector } from "./useSeries";

/**
 * Accelerator identity per worker node, merged from the two exporters that
 * know about accelerators: DCGM (NVIDIA, `modelName` such as "NVIDIA L40S")
 * and neuron-monitor (AWS Neuron, named here from the instance family).
 *
 * Nothing in vLLM's own metrics says which silicon an engine runs on — the
 * KV-cache gauge is `vllm:gpu_cache_usage_perc` on Inferentia too — so every
 * place the dashboard labels or filters by accelerator resolves through this
 * map instead of through the engine.
 */

/** EC2 instance family → accelerator generation. Unknown families fall back to "AWS Neuron". */
const NEURON_FAMILY_NAME: Record<string, string> = {
  inf1: "AWS Inferentia",
  inf2: "AWS Inferentia2",
  trn1: "AWS Trainium",
  trn1n: "AWS Trainium",
  trn2: "AWS Trainium2",
  trn2u: "AWS Trainium2",
};

export const NEURON_FALLBACK_NAME = "AWS Neuron";

export function neuronAcceleratorName(instanceType: string | undefined): string {
  const family = instanceType?.split(".")[0]?.toLowerCase();
  return (family && NEURON_FAMILY_NAME[family]) || NEURON_FALLBACK_NAME;
}

export function isNeuronAccelerator(name: string | undefined): boolean {
  return !!name && (name === NEURON_FALLBACK_NAME || /Inferentia|Trainium/.test(name));
}

/**
 * The two accelerator families the dashboard knows how to read. They are
 * tabs of one section rather than two sections: an operator asks "is my
 * accelerator fleet busy" first and "which vendor" second.
 */
export type AcceleratorKind = "gpu" | "neuron";

export const ACCELERATOR_KIND_LABEL: Record<AcceleratorKind, string> = {
  gpu: "NVIDIA GPU",
  neuron: "AWS Inferentia / Trainium",
};

/** What one "device" is called per family, for counts such as "4 / 4 cores". */
export const ACCELERATOR_UNIT: Record<AcceleratorKind, { singular: string; plural: string }> = {
  gpu: { singular: "GPU", plural: "GPUs" },
  neuron: { singular: "core", plural: "cores" },
};

export function acceleratorKind(name: string | undefined): AcceleratorKind {
  return isNeuronAccelerator(name) ? "neuron" : "gpu";
}

export interface AcceleratorsByNode {
  /** node → accelerator models present on it (a node may carry only one kind, but keep the set shape). */
  byNode: Map<string, Set<string>>;
  isLoading: boolean;
  error: Error | undefined;
}

export function useAcceleratorsByNode(): AcceleratorsByNode {
  const gpus = useInstantVector(SERVICE_GRAPH.nodeGpus);
  const neuron = useInstantVector(SERVICE_GRAPH.nodeNeuron);

  const byNode = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (node: string | undefined, name: string | undefined) => {
      if (!node || !name) return;
      let set = map.get(node);
      if (!set) {
        set = new Set();
        map.set(node, set);
      }
      set.add(name);
    };
    for (const row of gpus.rows) add(row.labels.Hostname, row.labels.modelName);
    for (const row of neuron.rows) add(row.labels.node, neuronAcceleratorName(row.labels.instance_type));
    return map;
  }, [gpus.rows, neuron.rows]);

  return { byNode, isLoading: gpus.isLoading || neuron.isLoading, error: gpus.error ?? neuron.error };
}

/** First accelerator name on a node, for single-value table cells. */
export function acceleratorLabel(byNode: Map<string, Set<string>>, node: string | undefined): string | undefined {
  if (!node) return undefined;
  const set = byNode.get(node);
  return set ? [...set].sort().join(", ") : undefined;
}
