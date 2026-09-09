"use client";

import { useMemo } from "react";
import { buildAgentQueries } from "./queries";
import { StatusLevel } from "./theme";
import { useInstantVector } from "./useSeries";
import { workloadFromPod } from "./workload";

/**
 * The collectors and agents the dashboard depends on. Every panel here is only
 * as good as the exporters behind it, so the header shows whether each one is
 * rolled out (ready / desired from kube-state-metrics), being scraped (`up` for
 * its Prometheus job) and stable (container restarts in the last hour).
 *
 * This is a curated list, not a discovery: a component that is not installed
 * in a given cluster simply shows as "Not installed" rather than failing.
 */
export type WorkloadKind = "daemonset" | "deployment" | "statefulset";

export interface AgentDef {
  /** Short label for the chip. */
  label: string;
  namespace: string;
  kind: WorkloadKind;
  /** Workload (DaemonSet / Deployment / StatefulSet) name. */
  name: string;
  /** Prometheus `job` label(s) that scrape this component, if any. */
  jobs?: string[];
  /** One line for the tooltip: what breaks in the dashboard if this is down. */
  role: string;
}

export interface AgentGroup {
  id: string;
  label: string;
  agents: AgentDef[];
}

export const AGENT_GROUPS: readonly AgentGroup[] = [
  {
    id: "node",
    label: "Node agents",
    agents: [
      { label: "node-exporter", namespace: "monitoring", kind: "daemonset", name: "prometheus-prometheus-node-exporter", jobs: ["node-exporter"], role: "CPU, memory, network and disk figures on At a Glance" },
      { label: "Beyla eBPF", namespace: "beyla", kind: "daemonset", name: "beyla", jobs: ["beyla"], role: "L7 RED metrics and the service map" },
      { label: "NFM agent", namespace: "amazon-network-flow-monitor", kind: "daemonset", name: "aws-network-flow-monitor-agent", jobs: ["nfm-agent-metrics"], role: "AWS Network Flow Monitor flow capture per node" },
      { label: "DCGM exporter", namespace: "gpu-operator", kind: "daemonset", name: "nvidia-dcgm-exporter", jobs: ["nvidia-dcgm-exporter"], role: "NVIDIA GPU utilisation, memory, power and temperature" },
      { label: "neuron-monitor", namespace: "neuron-monitor", kind: "daemonset", name: "neuron-monitor", jobs: ["neuron-monitor/neuron-monitor"], role: "AWS Inferentia / Trainium NeuronCore metrics" },
      { label: "NFD worker", namespace: "gpu-operator", kind: "daemonset", name: "gpu-operator-node-feature-discovery-worker", role: "Labels nodes with hardware features so the GPU operator can place its stack" },
      { label: "GPU feature discovery", namespace: "gpu-operator", kind: "daemonset", name: "gpu-feature-discovery", role: "Publishes GPU model and count labels used to schedule engines" },
      { label: "GPU validator", namespace: "gpu-operator", kind: "daemonset", name: "nvidia-operator-validator", role: "Checks driver, toolkit and device plugin on every GPU node" },
      { label: "EFS CSI node", namespace: "kube-system", kind: "daemonset", name: "efs-csi-node", role: "Mounts shared model storage on every node" },
    ],
  },
  {
    id: "metrics",
    label: "Metrics",
    agents: [
      { label: "Prometheus", namespace: "monitoring", kind: "statefulset", name: "prometheus-prometheus-kube-prometheus-prometheus", jobs: ["prometheus-kube-prometheus-prometheus"], role: "Every number on this dashboard" },
      { label: "Prometheus Operator", namespace: "monitoring", kind: "deployment", name: "prometheus-kube-prometheus-operator", jobs: ["prometheus-kube-prometheus-operator"], role: "Turns ServiceMonitors / PodMonitors into scrape configs" },
      { label: "kube-state-metrics", namespace: "monitoring", kind: "deployment", name: "prometheus-kube-state-metrics", jobs: ["kube-state-metrics"], role: "Pod, node, requests and rollout state — including this strip" },
      { label: "Grafana", namespace: "monitoring", kind: "deployment", name: "prometheus-grafana", jobs: ["prometheus-grafana"], role: "Deep Links target for the full Grafana dashboards" },
      { label: "Pushgateway", namespace: "monitoring", kind: "deployment", name: "pushgateway-prometheus-pushgateway", jobs: ["pushgateway-prometheus-pushgateway"], role: "Batch and job metrics that cannot be scraped directly" },
      { label: "NFM exporter", namespace: "amazon-network-flow-monitor", kind: "deployment", name: "nfm-wi-exporter", jobs: ["nfm-wi-exporter"], role: "Network Flow Monitor Workload Insights — inter-AZ ratio and retransmits" },
      { label: "metrics-server", namespace: "kube-system", kind: "deployment", name: "metrics-server", role: "Resource metrics for HPA and kubectl top" },
    ],
  },
  {
    id: "traces",
    label: "Traces (Tempo)",
    agents: [
      { label: "distributor", namespace: "tempo", kind: "deployment", name: "tempo-distributor", role: "Receives spans from Beyla" },
      { label: "ingester", namespace: "tempo", kind: "statefulset", name: "tempo-ingester", role: "Batches spans into blocks" },
      { label: "metrics-generator", namespace: "tempo", kind: "deployment", name: "tempo-metrics-generator", role: "Service-graph and span metrics from traces" },
      { label: "querier", namespace: "tempo", kind: "deployment", name: "tempo-querier", role: "Serves trace lookups" },
      { label: "query-frontend", namespace: "tempo", kind: "deployment", name: "tempo-query-frontend", role: "Grafana's Tempo data source endpoint" },
      { label: "compactor", namespace: "tempo", kind: "deployment", name: "tempo-compactor", role: "Compacts and retires trace blocks" },
      { label: "memcached", namespace: "tempo", kind: "statefulset", name: "tempo-memcached", role: "Query cache" },
    ],
  },
  {
    id: "llm-tracing",
    label: "LLM tracing (Langfuse)",
    agents: [
      { label: "langfuse-web", namespace: "langfuse", kind: "deployment", name: "langfuse-web", role: "Langfuse UI and ingestion API" },
      { label: "langfuse-worker", namespace: "langfuse", kind: "deployment", name: "langfuse-worker", role: "Processes ingested traces" },
      { label: "ClickHouse", namespace: "langfuse", kind: "statefulset", name: "langfuse-clickhouse-shard0", role: "Langfuse trace store" },
    ],
  },
];

/** Namespaces the strip queries — keeps the kube-state-metrics payload small. */
export const AGENT_NAMESPACES = [...new Set(AGENT_GROUPS.flatMap((g) => g.agents.map((a) => a.namespace)))];

const AGENTS = buildAgentQueries(AGENT_NAMESPACES.join("|"));

export type AgentState = StatusLevel | "absent";

export interface AgentStatus {
  def: AgentDef;
  state: AgentState;
  /** Short reason shown next to the label when the state is not healthy. */
  reason: string | null;
  desired: number | null;
  ready: number | null;
  /** Scrape targets up / total for the component's jobs; null when it has no job. */
  scrapeUp: number | null;
  scrapeTargets: number | null;
  /** Container restarts across the workload's pods in the last hour. */
  restarts1h: number;
}

export interface AgentHealth {
  groups: { group: AgentGroup; statuses: AgentStatus[] }[];
  counts: Record<AgentState, number>;
  isLoading: boolean;
  error: Error | undefined;
}

const AGENT_STATE_ORDER: AgentState[] = ["critical", "serious", "warning", "good", "absent"];

function worst(a: AgentState, b: AgentState): AgentState {
  return AGENT_STATE_ORDER.indexOf(a) <= AGENT_STATE_ORDER.indexOf(b) ? a : b;
}

/**
 * Rollout state from ready vs desired, then scrape health and restarts can only
 * make it worse, never better. "absent" means kube-state-metrics has no series
 * for the workload — not installed in this cluster.
 */
export function evaluate(def: AgentDef, desired: number | null, ready: number | null, scrapeUp: number | null, scrapeTargets: number | null, restarts1h: number): AgentStatus {
  let state: AgentState;
  let reason: string | null = null;

  if (desired === null) {
    state = "absent";
    reason = "Not installed";
  } else if (desired === 0) {
    state = "warning";
    reason = def.kind === "daemonset" ? "No matching nodes" : "Scaled to 0";
  } else if (ready === null || ready === 0) {
    state = "critical";
    reason = "0 ready";
  } else if (ready < desired) {
    state = ready / desired < 0.5 ? "serious" : "warning";
    reason = `${ready}/${desired} ready`;
  } else {
    state = "good";
  }

  if (state !== "absent" && scrapeTargets !== null && scrapeTargets > 0 && (scrapeUp ?? 0) < scrapeTargets) {
    state = worst(state, (scrapeUp ?? 0) === 0 ? "serious" : "warning");
    reason = reason ?? `scrape ${scrapeUp ?? 0}/${scrapeTargets}`;
  }

  if (state !== "absent" && restarts1h >= 1) {
    state = worst(state, restarts1h >= 10 ? "serious" : "warning");
    reason = reason ?? `${Math.round(restarts1h)} restarts/h`;
  }

  return { def, state, reason, desired, ready, scrapeUp, scrapeTargets, restarts1h };
}

export function useAgentHealth(): AgentHealth {
  const desired = useInstantVector(AGENTS.desired);
  const ready = useInstantVector(AGENTS.ready);
  const scrape = useInstantVector(AGENTS.scrape);
  const restarts = useInstantVector(AGENTS.restarts1h);

  const isLoading = desired.isLoading || ready.isLoading;
  const error = desired.error ?? ready.error;

  return useMemo(() => {
    const key = (ns: string, kind: string, name: string) => `${ns}/${kind}/${name}`;
    const desiredBy = new Map<string, number>();
    for (const r of desired.rows) desiredBy.set(key(r.labels.namespace, r.labels.kind, r.labels.workload), r.value);
    const readyBy = new Map<string, number>();
    for (const r of ready.rows) readyBy.set(key(r.labels.namespace, r.labels.kind, r.labels.workload), r.value);

    const upByJob = new Map<string, number>();
    const targetsByJob = new Map<string, number>();
    for (const r of scrape.rows) {
      (r.labels.m === "targets" ? targetsByJob : upByJob).set(r.labels.job, r.value);
    }

    // Pod → workload is the naming heuristic from workload.ts; good enough for a
    // restart hint, and it avoids a three-way owner join in PromQL.
    const restartsBy = new Map<string, number>();
    for (const r of restarts.rows) {
      const k = `${r.labels.namespace}/${workloadFromPod(r.labels.pod)}`;
      restartsBy.set(k, (restartsBy.get(k) ?? 0) + r.value);
    }

    const counts: Record<AgentState, number> = { good: 0, warning: 0, serious: 0, critical: 0, absent: 0 };
    const groups = AGENT_GROUPS.map((group) => {
      const statuses = group.agents.map((def) => {
        const k = key(def.namespace, def.kind, def.name);
        let scrapeUp: number | null = null;
        let scrapeTargets: number | null = null;
        if (def.jobs) {
          for (const job of def.jobs) {
            if (targetsByJob.has(job)) {
              scrapeTargets = (scrapeTargets ?? 0) + (targetsByJob.get(job) ?? 0);
              scrapeUp = (scrapeUp ?? 0) + (upByJob.get(job) ?? 0);
            }
          }
        }
        const status = evaluate(
          def,
          desiredBy.get(k) ?? null,
          readyBy.get(k) ?? null,
          scrapeUp,
          scrapeTargets,
          restartsBy.get(`${def.namespace}/${def.name}`) ?? 0,
        );
        counts[status.state] += 1;
        return status;
      });
      return { group, statuses };
    });

    return { groups, counts, isLoading, error };
  }, [desired.rows, ready.rows, scrape.rows, restarts.rows, isLoading, error]);
}
