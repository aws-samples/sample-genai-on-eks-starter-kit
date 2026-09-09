/**
 * Second level of the service map: one service opened up into its pods.
 *
 * The picture is three columns — the services that call the focused service,
 * the focused service's pods (or AZ groups of them), and the services those
 * pods call. It is assembled from four sources, best first:
 *
 *  1. Tempo's service graph with pod dimensions (source="tempo"): pod-exact
 *     edges for both sides, with each endpoint's node, which is what the
 *     cross-AZ share is computed from.
 *  2. Beyla's server-side RED per pod: the focused pods' own rate / errors /
 *     p95, independent of who called them. Also the pod inventory.
 *  3. Beyla's client-side RED per pod: what each pod calls, by target host —
 *     the fallback for the outbound side when Tempo has no pairing for a hop.
 *  4. The service-level edge split across pods in proportion to their inbound
 *     rate — the fallback for the inbound side, marked as an estimate.
 *
 * Pure functions over instant-vector rows so the assembly is testable and the
 * component stays a renderer.
 */

import { EdgeInput, NodeMeta } from "./graph";
import { InstantRow } from "./useSeries";

/** Above this many pods the default view groups them by AZ. */
export const POD_GROUP_THRESHOLD = 8;

/** Aggregate of everything behind one pod / group node, for its tooltip. */
export interface PodNodeStats {
  id: string;
  kind: "pod" | "group";
  pods: string[];
  nodes: string[];
  azs: string[];
  rate: number;
  errorRate: number;
  latencyP95: number | null;
}

export interface FocusGraph {
  edges: EdgeInput[];
  stats: Map<string, PodNodeStats>;
  podCount: number;
  azCount: number;
  grouped: boolean;
  /** Whether Tempo supplied pod-exact edges for each side. */
  paired: { inbound: boolean; outbound: boolean };
  /** Share of the focused service's inbound requests that crossed an AZ, from
   *  Tempo-paired edges only; null when there are none. */
  inboundCrossAzShare: number | null;
}

export interface FocusSources {
  focus: string;
  showAllPods: boolean;
  /** Beyla service-level edge rates (SERVICE_GRAPH.edgeRate rows). */
  serviceEdges: InstantRow[];
  podEdges: InstantRow[];
  podEdgeErrors: InstantRow[];
  podEdgeLatency: InstantRow[];
  podRate: InstantRow[];
  podErrors: InstantRow[];
  podLatency: InstantRow[];
  podOutbound: InstantRow[];
  azByNode: Map<string, string>;
}

interface PodInfo {
  node: string;
  rate: number;
  errorRate: number;
  latencyP95: number | null;
}

const UNKNOWN_AZ = "unknown AZ";

export function buildFocusGraph(src: FocusSources): FocusGraph {
  const { focus, azByNode } = src;
  const azOf = (node: string | undefined) => (node ? azByNode.get(node) : undefined);

  // Names that are nodes of the service map in their own right. Beyla files a
  // pod's RED under a service name it derives from the pod's labels, which can
  // be broader than the owner (the LiteLLM chart's PostgreSQL pod reports
  // service_name="litellm" while the map, from the callers' side, knows it as
  // "litellm-postgresql"). Such a pod belongs to the node that carries its
  // owner's name, not to the focused one.
  const mapNames = new Set(src.serviceEdges.flatMap((row) => [row.labels.client ?? "", row.labels.server ?? ""]));
  const belongsToFocus = (labels: Record<string, string>) => {
    if (labels.service_name !== focus) return false;
    const owner = labels.k8s_owner_name;
    return !owner || owner === focus || !mapNames.has(owner);
  };

  // --- Pod inventory of the focused service (Beyla server RED, then Tempo) ---
  const pods = new Map<string, PodInfo>();
  for (const row of src.podRate) {
    if (!belongsToFocus(row.labels) || !row.labels.k8s_pod_name) continue;
    pods.set(row.labels.k8s_pod_name, {
      node: row.labels.k8s_node_name ?? "",
      rate: row.value,
      errorRate: 0,
      latencyP95: null,
    });
  }
  for (const row of src.podErrors) {
    if (row.labels.service_name !== focus) continue;
    const pod = pods.get(row.labels.k8s_pod_name ?? "");
    if (pod) pod.errorRate = row.value;
  }
  for (const row of src.podLatency) {
    if (row.labels.service_name !== focus) continue;
    const pod = pods.get(row.labels.k8s_pod_name ?? "");
    if (pod && Number.isFinite(row.value)) pod.latencyP95 = row.value;
  }
  // A pod Tempo has paired but Beyla's RED has not reported (fresh pod, or
  // one whose only traffic is on excluded routes) still belongs in the column.
  for (const row of src.podEdges) {
    const pod = row.labels.server_k8s_pod_name;
    if (row.labels.server !== focus || !pod || pods.has(pod)) continue;
    pods.set(pod, { node: row.labels.server_k8s_node_name ?? "", rate: row.value, errorRate: 0, latencyP95: null });
  }

  const azs = new Set([...pods.values()].map((p) => azOf(p.node) ?? UNKNOWN_AZ));
  const grouped = !src.showAllPods && pods.size > POD_GROUP_THRESHOLD;

  // --- Pod → drawn node (itself, or its AZ group) ---
  const nodeIdOf = (pod: string): string => {
    if (!grouped) return `pod:${pod}`;
    const az = azOf(pods.get(pod)?.node) ?? UNKNOWN_AZ;
    return `group:${focus}@${az}`;
  };
  const metaOf = (pod: string): NodeMeta => {
    const az = azOf(pods.get(pod)?.node) ?? UNKNOWN_AZ;
    if (!grouped) return { kind: "pod", label: podLabel(pod, focus), sublabel: az };
    const members = [...pods.entries()].filter(([, p]) => (azOf(p.node) ?? UNKNOWN_AZ) === az).length;
    return { kind: "group", label: az, sublabel: `${members} pods` };
  };

  const stats = new Map<string, PodNodeStats>();
  for (const [pod, info] of pods) {
    const id = nodeIdOf(pod);
    const entry = stats.get(id) ?? {
      id,
      kind: grouped ? "group" : "pod",
      pods: [],
      nodes: [],
      azs: [],
      rate: 0,
      errorRate: 0,
      latencyP95: null,
    };
    entry.pods.push(pod);
    if (info.node && !entry.nodes.includes(info.node)) entry.nodes.push(info.node);
    const az = azOf(info.node) ?? UNKNOWN_AZ;
    if (!entry.azs.includes(az)) entry.azs.push(az);
    entry.rate += info.rate;
    entry.errorRate += info.errorRate;
    if (info.latencyP95 !== null) entry.latencyP95 = Math.max(entry.latencyP95 ?? 0, info.latencyP95);
    stats.set(id, entry);
  }
  for (const entry of stats.values()) {
    entry.pods.sort();
    entry.nodes.sort();
    entry.azs.sort();
  }

  const edges: EdgeInput[] = [];
  const isProbeClient = (client: string | undefined) => !client || /^i-[0-9a-f]+$/.test(client);

  // --- Inbound: callers → pods ---
  // Zero-rate series are stale (a counter that stopped moving inside the rate
  // window); they would only add edges that say nothing.
  const live = (row: InstantRow) => row.value > 0;
  const inboundRows = src.podEdges.filter(
    (row) =>
      live(row) &&
      row.labels.server === focus &&
      row.labels.client !== focus &&
      !isProbeClient(row.labels.client) &&
      row.labels.server_k8s_pod_name,
  );
  const pairedInbound = inboundRows.length > 0;
  let crossAz = 0;
  let crossAzTotal = 0;
  if (pairedInbound) {
    const errorByKey = new Map(src.podEdgeErrors.map((row) => [podEdgeKey(row.labels), row.value]));
    const latencyByKey = new Map(src.podEdgeLatency.map((row) => [podEdgeKey(row.labels), row.value]));
    for (const row of inboundRows) {
      const pod = row.labels.server_k8s_pod_name!;
      const clientAz = azOf(row.labels.client_k8s_node_name);
      const serverAz = azOf(row.labels.server_k8s_node_name) ?? azOf(pods.get(pod)?.node);
      const crossAzRate = clientAz && serverAz ? (clientAz !== serverAz ? row.value : 0) : undefined;
      if (crossAzRate !== undefined) {
        crossAz += crossAzRate;
        crossAzTotal += row.value;
      }
      const key = podEdgeKey(row.labels);
      const p95 = latencyByKey.get(key);
      edges.push({
        client: row.labels.client!,
        server: nodeIdOf(pod),
        rate: row.value,
        errorRate: errorByKey.get(key) ?? 0,
        latencyP95: p95 !== undefined && Number.isFinite(p95) ? p95 : null,
        crossAzRate,
        origin: "tempo",
        serverMeta: metaOf(pod),
      });
    }
  } else {
    // No pairing yet: split each service-level edge across the pods in
    // proportion to the traffic Beyla saw them serve.
    const totalPodRate = [...pods.values()].reduce((sum, p) => sum + p.rate, 0);
    if (totalPodRate > 0) {
      for (const row of src.serviceEdges) {
        if (!live(row) || row.labels.server !== focus || row.labels.client === focus || isProbeClient(row.labels.client)) continue;
        for (const [pod, info] of pods) {
          if (info.rate <= 0) continue;
          const share = info.rate / totalPodRate;
          edges.push({
            client: row.labels.client!,
            server: nodeIdOf(pod),
            rate: row.value * share,
            errorRate: info.errorRate * share,
            latencyP95: info.latencyP95,
            origin: "estimate",
            serverMeta: metaOf(pod),
          });
        }
      }
    }
  }

  // --- Outbound: pods → callees ---
  const outboundRows = src.podEdges.filter(
    (row) =>
      live(row) && row.labels.client === focus && row.labels.server && row.labels.server !== focus && row.labels.client_k8s_pod_name,
  );
  const pairedOutbound = outboundRows.length > 0;
  if (pairedOutbound) {
    const errorByKey = new Map(src.podEdgeErrors.map((row) => [podEdgeKey(row.labels), row.value]));
    const latencyByKey = new Map(src.podEdgeLatency.map((row) => [podEdgeKey(row.labels), row.value]));
    for (const row of outboundRows) {
      const pod = row.labels.client_k8s_pod_name!;
      if (!pods.has(pod)) {
        pods.set(pod, { node: row.labels.client_k8s_node_name ?? "", rate: 0, errorRate: 0, latencyP95: null });
      }
      const clientAz = azOf(row.labels.client_k8s_node_name) ?? azOf(pods.get(pod)?.node);
      const serverAz = azOf(row.labels.server_k8s_node_name);
      const key = podEdgeKey(row.labels);
      const p95 = latencyByKey.get(key);
      edges.push({
        client: nodeIdOf(pod),
        server: row.labels.server!,
        rate: row.value,
        errorRate: errorByKey.get(key) ?? 0,
        latencyP95: p95 !== undefined && Number.isFinite(p95) ? p95 : null,
        crossAzRate: clientAz && serverAz ? (clientAz !== serverAz ? row.value : 0) : undefined,
        origin: "tempo",
        clientMeta: metaOf(pod),
      });
    }
  } else {
    for (const row of src.podOutbound) {
      const pod = row.labels.k8s_pod_name;
      if (!live(row) || row.labels.service_name !== focus || !pod || !pods.has(pod)) continue;
      const target = serviceFromAddress(row.labels.server_address);
      if (!target || target === focus) continue;
      edges.push({
        client: nodeIdOf(pod),
        server: target,
        rate: row.value,
        errorRate: 0,
        latencyP95: null,
        origin: "beyla-client",
        clientMeta: metaOf(pod),
      });
    }
  }

  // A pod with no edge at all would vanish from the layout — the wrong signal
  // both for an idle replica and for one whose callers Tempo has not paired.
  // Anchor it with an edge from a placeholder that renders as the focused
  // service itself, carrying what Beyla saw the pod serve (0 for a truly idle
  // replica, drawn faint) and marked as an estimate.
  const drawn = new Set(edges.flatMap((e) => [e.client, e.server]));
  for (const [pod, info] of pods) {
    const id = nodeIdOf(pod);
    if (drawn.has(id)) continue;
    drawn.add(id);
    const group = stats.get(id);
    edges.push({
      client: focus,
      server: id,
      rate: group?.rate ?? info.rate,
      errorRate: group?.errorRate ?? info.errorRate,
      latencyP95: group?.latencyP95 ?? info.latencyP95,
      origin: "estimate",
      serverMeta: metaOf(pod),
    });
  }

  return {
    edges,
    stats,
    podCount: pods.size,
    azCount: azs.size,
    grouped,
    paired: { inbound: pairedInbound, outbound: pairedOutbound },
    inboundCrossAzShare: crossAzTotal > 0 ? crossAz / crossAzTotal : null,
  };
}

/** One key per Tempo pod-edge series, shared by the rate / error / latency vectors. */
function podEdgeKey(labels: Record<string, string>): string {
  return [labels.client, labels.server, labels.client_k8s_pod_name, labels.server_k8s_pod_name].map((v) => v ?? "").join("|");
}

/** "gpt-oss-120b-7c9f8d6b5-x2k9q" under focus "gpt-oss-120b" → "7c9f8d6b5-x2k9q". */
export function podLabel(pod: string, focus: string): string {
  const stripped = pod.startsWith(`${focus}-`) ? pod.slice(focus.length + 1) : pod;
  return stripped.length > 22 ? `…${stripped.slice(-21)}` : stripped;
}

/** Beyla's server_address is a host: "gpt-oss-120b.vllm", "litellm.litellm.svc.cluster.local",
 *  an IP, or a public name. Cluster hosts collapse to their Service name; the
 *  rest are kept whole (they appear that way in the service map too). */
export function serviceFromAddress(address: string | undefined): string | null {
  if (!address) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) return null;
  const labels = address.split(".");
  if (labels.length === 1) return address;
  // Public hostnames (stats.vllm.ai, us.api.konghq.com) end in a TLD and are
  // not cluster services; keep them intact so they match Beyla's server name.
  if (!address.endsWith(".svc.cluster.local") && labels.length >= 3 && !/^(svc|cluster|local)$/.test(labels[2])) {
    return address;
  }
  return labels[0];
}
