// Single source of truth for the dashboard's sections: id (also the URL hash),
// short label for the sidebar, the group it sits under, and the heading shown
// above the panel. Lives outside any "use client" module so it can be imported
// from either side. Icons live in components/SectionIcons.tsx, keyed by id.
export type SectionGroup = "Overview" | "Traffic" | "Inference" | "Resources";

/** Sidebar group order, top to bottom. */
export const SECTION_GROUPS: readonly SectionGroup[] = ["Overview", "Traffic", "Inference", "Resources"];

export interface SectionDef {
  /** Stable identifier; doubles as the URL fragment (`#llm`). */
  id: string;
  /** Short label for the sidebar item. */
  label: string;
  /** Sidebar group heading the item is listed under. */
  group: SectionGroup;
  /** Full heading shown at the top of the panel. */
  title: string;
  /** One-line explanation of what the panel covers. */
  description: string;
}

export const SECTIONS: readonly SectionDef[] = [
  {
    id: "at-a-glance",
    label: "At a Glance",
    group: "Overview",
    title: "At a Glance — cluster overview",
    description:
      "Whole-cluster averages on one screen: nodes & pods, CPU, memory, network, storage, GPU & accelerators, and the serving headline. Sparklines follow the selected time window; the per-model and per-pod detail lives under GPU & Accelerators.",
  },
  {
    id: "network",
    label: "Network & Cost",
    group: "Traffic",
    title: "Network Structure & Cost",
    description: "AZ and VPC flows from AWS Network Flow Monitor Workload Insights.",
  },
  {
    id: "llm",
    label: "LLM Performance",
    group: "Inference",
    title: "LLM Performance & Stability",
    description: "vLLM native metrics — latency, saturation and stability per model.",
  },
  {
    id: "cache",
    label: "Cache Hit Rate",
    group: "Inference",
    title: "Cache Hit Rate",
    description:
      "Prefix-cache hit ratio as an SLI — split by worker node, model pool and tenant mix, paired with KV pressure to separate capacity bottlenecks from prompt/routing problems.",
  },
  {
    id: "l7",
    label: "L7 RED",
    group: "Traffic",
    title: "L7 RED (Beyla eBPF)",
    description: "HTTP-level rate, errors and duration captured without touching application code.",
  },
  {
    id: "service-map",
    label: "Service Map",
    group: "Traffic",
    title: "Service Map",
    description:
      "East-west connectivity and per-edge health, filterable by namespace, service, AZ, architecture, accelerator (NVIDIA GPU or AWS Neuron) and node.",
  },
  {
    id: "gpu",
    label: "GPU & Accelerators",
    group: "Inference",
    title: "GPU & Accelerators",
    description:
      "Every accelerator type in one place: NVIDIA GPUs (DCGM exporter) and AWS Inferentia / Trainium (neuron-monitor) compared on the same fleet table, then utilization, memory, latency and allocated-but-idle detection per type, pod and node.",
  },
  {
    id: "links",
    label: "Deep Links",
    group: "Resources",
    title: "Deep Links",
    description: "Where the underlying detail lives.",
  },
];

export const DEFAULT_SECTION_ID = SECTIONS[0].id;

export function isSectionId(id: string): boolean {
  return SECTIONS.some((s) => s.id === id);
}

export function getSection(id: string): SectionDef {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}
