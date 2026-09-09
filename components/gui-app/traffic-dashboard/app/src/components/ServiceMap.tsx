"use client";

import { useMemo, useState } from "react";
import {
  EdgeInput,
  EdgeOrigin,
  GraphEdge,
  GraphLayout,
  GraphNode,
  HEALTH_LABEL,
  HEALTH_LEGEND,
  layoutServiceGraph,
} from "@/lib/graph";
import { POD_GROUP_THRESHOLD, PodNodeStats, buildFocusGraph } from "@/lib/podGraph";
import { useAcceleratorsByNode } from "@/lib/accelerator";
import { formatPercentUnit, formatReqps, formatSeconds } from "@/lib/format";
import { INK, STATUS, STATUS_GLYPH, STRUCTURE } from "@/lib/theme";
import { POD_GRAPH, SERVICE_GRAPH } from "@/lib/queries";
import { InstantRow, useInstantVector } from "@/lib/useSeries";

/** Unhealthy edges are dashed as well as coloured, so status never rides on
 *  colour alone. Healthy edges stay solid. */
const DASH: Record<string, string | undefined> = {
  good: undefined,
  warning: "10 5",
  serious: "10 5",
  critical: "4 4",
};

/** Estimated edges (service total split across pods) are dotted whatever their
 *  health, so a split is never read as a measurement. */
const ESTIMATE_DASH = "2 5";

const ORIGIN_LABEL: Record<EdgeOrigin, string> = {
  tempo: "Tempo span pairing (pod-exact)",
  "beyla-client": "Beyla client-side RED on the pod",
  estimate: "Estimate — service total split by pod share",
};

interface HoverState {
  edge?: GraphEdge;
  node?: GraphNode;
  x: number;
  y: number;
}

/** Sentinel option meaning "don't filter on this dimension". */
const ALL = "all";

/** AZ out of an EC2 provider id, e.g. aws:///us-east-1a/i-0abc… → us-east-1a */
const AZ_FROM_PROVIDER_ID = /^aws:\/\/\/([^/]+)\//;

/** uname machine values → the arch names Kubernetes users know. */
const ARCH_NAME: Record<string, string> = { x86_64: "amd64", aarch64: "arm64" };

/**
 * East-west service map built from Beyla's service-graph metrics. Rendered as
 * plain SVG: the graphs here are small enough that a layered layout
 * (src/lib/graph.ts) beats the bundle cost of a force-directed library.
 *
 * Two levels. The first is all services, filterable by namespace, service,
 * worker node, AZ, CPU architecture and accelerator (NVIDIA GPU model from
 * DCGM, or AWS Inferentia / Trainium from neuron-monitor). Namespace and
 * service are labels on the edge itself; the rest are attributes of the node
 * whose Beyla DaemonSet pod reported the edge — Beyla observes a call on the
 * node running either endpoint's process, so each of them reads as "edges with
 * an endpoint on a matching node".
 *
 * Clicking a service opens the second level: that service's pods (grouped by
 * AZ when there are many) between the services that call it and the services
 * it calls, with pod-exact edges from Tempo's span pairing where available
 * (src/lib/podGraph.ts explains the sources and fallbacks). A full pod-to-pod
 * graph of the whole platform is deliberately not offered: with tens of
 * near-identical replicas per pool it would carry no more information than
 * this view and far less legibility.
 */
export function ServiceMap() {
  const rate = useInstantVector(SERVICE_GRAPH.edgeRate);
  const errors = useInstantVector(SERVICE_GRAPH.edgeErrors);
  const latency = useInstantVector(SERVICE_GRAPH.edgeLatencyP95);
  const observers = useInstantVector(SERVICE_GRAPH.edgeObservers);
  const observerNodes = useInstantVector(SERVICE_GRAPH.observerNodes);
  const nodeZones = useInstantVector(SERVICE_GRAPH.nodeZones);
  const nodeArch = useInstantVector(SERVICE_GRAPH.nodeArch);
  const archPodNodes = useInstantVector(SERVICE_GRAPH.archPodNodes);
  const accelerators = useAcceleratorsByNode();

  const [namespace, setNamespace] = useState(ALL);
  const [service, setService] = useState(ALL);
  const [az, setAz] = useState(ALL);
  const [node, setNode] = useState(ALL);
  const [arch, setArch] = useState(ALL);
  const [gpu, setGpu] = useState(ALL);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  /** Service opened in the pod drill-down; null shows the service level. */
  const [focus, setFocus] = useState<string | null>(null);
  const [showAllPods, setShowAllPods] = useState(false);

  // Pod-level edges are polled at both levels: the service map uses them for
  // each edge's cross-AZ share. The rest of the drill-down data is only
  // fetched while a service is open.
  const podEdges = useInstantVector(POD_GRAPH.edgeRate);
  const focused = focus !== null;
  const podEdgeErrors = useInstantVector(focused ? POD_GRAPH.edgeErrors : null);
  const podEdgeLatency = useInstantVector(focused ? POD_GRAPH.edgeLatencyP95 : null);
  const podRate = useInstantVector(focused ? POD_GRAPH.podRate : null);
  const podErrors = useInstantVector(focused ? POD_GRAPH.podErrors : null);
  const podLatency = useInstantVector(focused ? POD_GRAPH.podLatencyP95 : null);
  const podOutbound = useInstantVector(focused ? POD_GRAPH.podOutbound : null);

  const azByNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of nodeZones.rows) {
      const zone = row.labels.provider_id?.match(AZ_FROM_PROVIDER_ID)?.[1];
      if (row.labels.node && zone) map.set(row.labels.node, zone);
    }
    return map;
  }, [nodeZones.rows]);

  const archByNode = useMemo(() => {
    const nodeByPod = new Map(archPodNodes.rows.map((row) => [row.labels.pod, row.labels.node]));
    const map = new Map<string, string>();
    for (const row of nodeArch.rows) {
      const nodeName = nodeByPod.get(row.labels.pod ?? "");
      const machine = row.labels.machine;
      if (nodeName && machine) map.set(nodeName, ARCH_NAME[machine] ?? machine);
    }
    return map;
  }, [nodeArch.rows, archPodNodes.rows]);

  /** node → accelerators on it (GPU model or Neuron generation). CPU-only nodes have no entry. */
  const gpusByNode = accelerators.byNode;

  /** (client→server) pair → worker nodes whose Beyla pod saw that edge. */
  const nodesByPair = useMemo(() => {
    const nodeByPod = new Map(observerNodes.rows.map((row) => [row.labels.pod, row.labels.node]));
    const map = new Map<string, Set<string>>();
    for (const row of observers.rows) {
      const nodeName = nodeByPod.get(row.labels.pod ?? "");
      if (!nodeName) continue;
      const key = pairKey(row.labels);
      let seenOn = map.get(key);
      if (!seenOn) {
        seenOn = new Set();
        map.set(key, seenOn);
      }
      seenOn.add(nodeName);
    }
    return map;
  }, [observers.rows, observerNodes.rows]);

  /** (client→server) pair → how much of Tempo's paired traffic crossed an AZ. */
  const crossAzByPair = useMemo(() => crossAzPerPair(podEdges.rows, azByNode), [podEdges.rows, azByNode]);

  /** Does this node satisfy the selected AZ / architecture / GPU constraints? */
  const nodeDimsMatch = useMemo(
    () => (n: string) =>
      (az === ALL || azByNode.get(n) === az) &&
      (arch === ALL || archByNode.get(n) === arch) &&
      (gpu === ALL || (gpusByNode.get(n)?.has(gpu) ?? false)),
    [az, arch, gpu, azByNode, archByNode, gpusByNode],
  );

  // Dropdown options come from the data itself, so they never list a value
  // that would filter the map down to nothing that ever existed. The node
  // list narrows to the AZ/arch/GPU selections; the other lists stay full.
  const options = useMemo(() => {
    const namespaces = new Set<string>();
    const services = new Set<string>();
    for (const row of rate.rows) {
      for (const ns of [row.labels.client_k8s_namespace_name, row.labels.server_k8s_namespace_name]) {
        if (ns) namespaces.add(ns);
      }
      for (const svc of [row.labels.client, row.labels.server]) {
        if (svc) services.add(svc);
      }
    }
    const observed = new Set([...nodesByPair.values()].flatMap((set) => [...set]));
    const azs = new Set([...observed].map((n) => azByNode.get(n)).filter((z): z is string => !!z));
    const archs = new Set([...observed].map((n) => archByNode.get(n)).filter((a): a is string => !!a));
    const gpus = new Set([...observed].flatMap((n) => [...(gpusByNode.get(n) ?? [])]));
    const nodes = [...observed].filter(nodeDimsMatch);
    return {
      namespaces: [...namespaces].sort(),
      services: [...services].sort(),
      azs: [...azs].sort(),
      archs: [...archs].sort(),
      gpus: [...gpus].sort(),
      nodes: nodes.sort(),
    };
  }, [rate.rows, nodesByPair, azByNode, archByNode, gpusByNode, nodeDimsMatch]);

  const layout = useMemo(() => {
    const errorByPair = new Map(errors.rows.map((row) => [pairKey(row.labels), row.value]));
    const latencyByPair = new Map(latency.rows.map((row) => [pairKey(row.labels), row.value]));

    // Filter first, then merge the surviving rows down to one per (client,
    // server) pair. The error/latency series are keyed per pair, so they must
    // attach once after the merge — attaching per row would double-count a
    // pair that spans several namespace-label combinations.
    const ratePerPair = new Map<string, number>();
    for (const row of rate.rows) {
      const client = row.labels.client ?? "";
      const server = row.labels.server ?? "";
      const clientNs = row.labels.client_k8s_namespace_name ?? "";
      const serverNs = row.labels.server_k8s_namespace_name ?? "";
      if (namespace !== ALL && clientNs !== namespace && serverNs !== namespace) continue;
      if (service !== ALL && client !== service && server !== service) continue;
      const key = pairKey(row.labels);
      if (node !== ALL || az !== ALL || arch !== ALL || gpu !== ALL) {
        const seenOn = nodesByPair.get(key);
        if (!seenOn) continue;
        // A pinned node already satisfies the broader dimensions — the change
        // handlers unpin it the moment it stops matching one of them.
        if (node !== ALL) {
          if (!seenOn.has(node)) continue;
        } else if (![...seenOn].some(nodeDimsMatch)) continue;
      }
      ratePerPair.set(key, (ratePerPair.get(key) ?? 0) + row.value);
    }

    const inputs: EdgeInput[] = [...ratePerPair.entries()].map(([key, pairRate]) => {
      const [client, server] = key.split("→");
      const p95 = latencyByPair.get(key);
      const cross = crossAzByPair.get(key);
      return {
        client,
        server,
        rate: pairRate,
        errorRate: errorByPair.get(key) ?? 0,
        latencyP95: p95 !== undefined && Number.isFinite(p95) ? p95 : null,
        // Beyla's rate is the edge's volume; Tempo's pairing only supplies the
        // cross-AZ proportion, applied to it.
        crossAzRate: cross && cross.total > 0 ? pairRate * (cross.cross / cross.total) : undefined,
      };
    });
    return layoutServiceGraph(inputs);
  }, [
    rate.rows,
    errors.rows,
    latency.rows,
    namespace,
    service,
    az,
    node,
    arch,
    gpu,
    nodesByPair,
    nodeDimsMatch,
    crossAzByPair,
  ]);

  const focusGraph = useMemo(() => {
    if (focus === null) return null;
    return buildFocusGraph({
      focus,
      showAllPods,
      serviceEdges: rate.rows,
      podEdges: podEdges.rows,
      podEdgeErrors: podEdgeErrors.rows,
      podEdgeLatency: podEdgeLatency.rows,
      podRate: podRate.rows,
      podErrors: podErrors.rows,
      podLatency: podLatency.rows,
      podOutbound: podOutbound.rows,
      azByNode,
    });
  }, [
    focus,
    showAllPods,
    rate.rows,
    podEdges.rows,
    podEdgeErrors.rows,
    podEdgeLatency.rows,
    podRate.rows,
    podErrors.rows,
    podLatency.rows,
    podOutbound.rows,
    azByNode,
  ]);
  const focusLayout = useMemo(() => (focusGraph ? layoutServiceGraph(focusGraph.edges) : null), [focusGraph]);

  if (rate.error) {
    return (
      <Placeholder>
        <span className="text-status-serious">▲</span> Query failed — {rate.error.message}
      </Placeholder>
    );
  }
  if (rate.rows.length === 0) {
    return (
      <Placeholder>
        {rate.isLoading
          ? "Loading…"
          : "No service-graph series yet. Beyla writes traces_service_graph_request_* once it has reported spans between two services — allow a few minutes after install."}
      </Placeholder>
    );
  }

  const isDimmed = (edge: GraphEdge) =>
    hoveredNode !== null && edge.client !== hoveredNode && edge.server !== hoveredNode;

  // A node pinned under a mismatching AZ/arch/GPU would silently empty the map.
  const handleAz = (value: string) => {
    setAz(value);
    if (node !== ALL && value !== ALL && azByNode.get(node) !== value) setNode(ALL);
  };
  const handleArch = (value: string) => {
    setArch(value);
    if (node !== ALL && value !== ALL && archByNode.get(node) !== value) setNode(ALL);
  };
  const handleGpu = (value: string) => {
    setGpu(value);
    if (node !== ALL && value !== ALL && !gpusByNode.get(node)?.has(value)) setNode(ALL);
  };

  const openService = (id: string) => {
    setFocus(id);
    setShowAllPods(false);
    setHoveredNode(null);
    setHover(null);
  };
  const closeFocus = () => {
    setFocus(null);
    setHoveredNode(null);
    setHover(null);
  };

  /** Clicks: a service opens (or re-targets) the drill-down; an AZ group expands to its pods. */
  const handleNodeClick = (clicked: GraphNode) => {
    if (clicked.kind === "service") openService(clicked.id);
    else if (clicked.kind === "group") setShowAllPods(true);
  };

  if (focus !== null && focusGraph && focusLayout) {
    const podsLoading = podRate.isLoading && podRate.rows.length === 0;
    return (
      <div>
        <FocusHeader
          focus={focus}
          graph={focusGraph}
          onBack={closeFocus}
          onToggleGrouping={() => setShowAllPods((v) => !v)}
        />
        <div className="relative">
          {focusLayout.nodes.length === 0 ? (
            <Placeholder>
              {podsLoading
                ? "Loading pods…"
                : `No pod-level data for ${focus}. Beyla reports pods only for the namespaces it instruments; external or unmanaged endpoints have none.`}
            </Placeholder>
          ) : (
            <MapCanvas
              layout={focusLayout}
              hoveredNode={hoveredNode}
              setHoveredNode={setHoveredNode}
              setHover={setHover}
              isDimmed={isDimmed}
              onNodeClick={handleNodeClick}
              stats={focusGraph.stats}
              footnote={focusFootnote(focusGraph)}
            />
          )}
          {hover?.edge && <EdgeTooltip hover={hover} />}
          {hover?.node && <NodeTooltip hover={hover} stats={focusGraph.stats} />}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterSelect label="Namespace" value={namespace} options={options.namespaces} onChange={setNamespace} />
        <FilterSelect label="Service" value={service} options={options.services} onChange={setService} />
        <FilterSelect label="AZ" value={az} options={options.azs} onChange={handleAz} />
        <FilterSelect label="Arch" value={arch} options={options.archs} onChange={handleArch} />
        <FilterSelect label="Accelerator" value={gpu} options={options.gpus} onChange={handleGpu} />
        <FilterSelect label="Node" value={node} options={options.nodes} onChange={setNode} />
        <span className="text-[11px] text-ink-muted">
          AZ, arch, accelerator and node keep edges with an endpoint observed on a matching node. Click a service to
          open its pods.
        </span>
      </div>

      <div className="relative">
        {layout.nodes.length === 0 ? (
          <Placeholder>No connections match the current filters.</Placeholder>
        ) : (
          <MapCanvas
            layout={layout}
            hoveredNode={hoveredNode}
            setHoveredNode={setHoveredNode}
            setHover={setHover}
            isDimmed={isDimmed}
            onNodeClick={handleNodeClick}
          />
        )}

        {hover?.edge && <EdgeTooltip hover={hover} />}
      </div>
    </div>
  );
}

/**
 * Per (client→server) pair, the Tempo-paired volume and how much of it had its
 * two endpoints in different AZs. Pairs whose node placement is unknown on
 * either side are left out rather than counted as same-AZ.
 */
function crossAzPerPair(rows: InstantRow[], azByNode: Map<string, string>): Map<string, { cross: number; total: number }> {
  const map = new Map<string, { cross: number; total: number }>();
  for (const row of rows) {
    const clientAz = azByNode.get(row.labels.client_k8s_node_name ?? "");
    const serverAz = azByNode.get(row.labels.server_k8s_node_name ?? "");
    if (!clientAz || !serverAz) continue;
    const key = pairKey(row.labels);
    const entry = map.get(key) ?? { cross: 0, total: 0 };
    entry.total += row.value;
    if (clientAz !== serverAz) entry.cross += row.value;
    map.set(key, entry);
  }
  return map;
}

/** Breadcrumb, pod/AZ counts, grouping toggle and the cross-AZ headline. */
function FocusHeader({
  focus,
  graph,
  onBack,
  onToggleGrouping,
}: {
  focus: string;
  graph: ReturnType<typeof buildFocusGraph>;
  onBack: () => void;
  onToggleGrouping: () => void;
}) {
  const canGroup = graph.podCount > POD_GROUP_THRESHOLD;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg bg-surface px-2.5 py-1 text-xs text-ink ring-1 ring-white/10 hover:ring-white/25"
      >
        ← All services
      </button>
      <span className="text-sm font-medium text-ink">{focus}</span>
      <span className="tabular text-[11px] text-ink-secondary">
        {graph.podCount} {graph.podCount === 1 ? "pod" : "pods"} · {graph.azCount} {graph.azCount === 1 ? "AZ" : "AZs"}
      </span>
      {canGroup && (
        <button
          type="button"
          onClick={onToggleGrouping}
          className="rounded-lg bg-surface px-2.5 py-1 text-[11px] text-ink-secondary ring-1 ring-white/10 hover:ring-white/25"
        >
          {graph.grouped ? "Show every pod" : "Group by AZ"}
        </button>
      )}
      <span className="tabular text-[11px] text-ink-secondary">
        Inbound cross-AZ:{" "}
        <span className="font-medium text-ink">
          {graph.inboundCrossAzShare === null ? "—" : formatPercentUnit(graph.inboundCrossAzShare, 0)}
        </span>
      </span>
    </div>
  );
}

/** One line under the map saying where each side's edges came from. */
function focusFootnote(graph: ReturnType<typeof buildFocusGraph>): string {
  const inbound = graph.paired.inbound
    ? "Inbound edges are Tempo span pairs (pod-exact)."
    : "Inbound edges are estimates: the service total split by each pod's share — Tempo has not paired these hops yet.";
  const outbound = graph.paired.outbound
    ? "Outbound edges are Tempo span pairs."
    : "Outbound edges are Beyla's client-side counts on each pod.";
  return `${inbound} ${outbound}`;
}

/** One labelled dropdown of the filter bar. */
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const id = `service-map-filter-${label.toLowerCase()}`;
  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
      {label}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-44 rounded-lg bg-surface px-2 py-1 text-xs text-ink ring-1 ring-white/10"
      >
        <option value={ALL}>All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The SVG map itself plus its health legend. */
function MapCanvas({
  layout,
  hoveredNode,
  setHoveredNode,
  setHover,
  isDimmed,
  onNodeClick,
  stats,
  footnote,
}: {
  layout: GraphLayout;
  hoveredNode: string | null;
  setHoveredNode: (id: string | null) => void;
  setHover: (state: HoverState | null) => void;
  isDimmed: (edge: GraphEdge) => boolean;
  onNodeClick: (node: GraphNode) => void;
  /** Present in the drill-down: pod / group aggregates for the node tooltips. */
  stats?: Map<string, PodNodeStats>;
  footnote?: string;
}) {
  const services = layout.nodes.filter((n) => n.kind === "service").length;
  const pods = layout.nodes.length - services;
  return (
    <>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width="100%"
          height={layout.height}
          role="img"
          aria-label={
            pods > 0
              ? `Pod map: ${pods} pod nodes, ${services} services, ${layout.edges.length} connections`
              : `Service map: ${services} services, ${layout.edges.length} connections`
          }
          style={{ minWidth: Math.min(layout.width, 720) }}
        >
          <defs>
            {/* One arrowhead per health level so the marker matches its edge. */}
            {Object.entries(STATUS).map(([level, color]) => (
              <marker
                key={level}
                id={`arrow-${level}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
              </marker>
            ))}
          </defs>

          <g>
            {layout.edges.map((edge) => {
              const dimmed = isDimmed(edge);
              const estimated = edge.origin === "estimate";
              // Zero-rate anchors (idle replicas) draw as a faint hairline.
              const idle = edge.rate <= 0;
              return (
                <g key={edge.id} opacity={dimmed ? 0.15 : idle ? 0.35 : 1} style={{ transition: "opacity 150ms" }}>
                  {/* Wide invisible hit area — a 2px path is hard to hover. */}
                  <path
                    d={edge.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(edge.strokeWidth + 14, 18)}
                    onMouseEnter={(event) =>
                      setHover({ edge, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })
                    }
                    onMouseMove={(event) =>
                      setHover({ edge, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                  <path
                    d={edge.path}
                    fill="none"
                    stroke={idle ? INK.muted : edge.color}
                    strokeWidth={edge.strokeWidth}
                    strokeDasharray={estimated || idle ? ESTIMATE_DASH : DASH[edge.health]}
                    strokeLinecap="round"
                    markerEnd={idle ? undefined : `url(#arrow-${edge.health})`}
                    pointerEvents="none"
                  />
                  {/* Direction-of-travel shimmer. Separate path so it cannot
                      override the health dash on the stroke above; hidden
                      entirely under prefers-reduced-motion. */}
                  {!idle && (
                    <path
                      className="edge-flow"
                      d={edge.path}
                      fill="none"
                      stroke={INK.primary}
                      strokeOpacity={0.5}
                      strokeWidth={Math.min(edge.strokeWidth, 2.5)}
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                  )}
                  {/* Badge on unhealthy edges: a second non-colour signal. */}
                  {edge.health !== "good" && <EdgeBadge edge={edge} />}
                </g>
              );
            })}
          </g>

          <g>
            {layout.nodes.map((node) => {
              const dimmed = hoveredNode !== null && hoveredNode !== node.id;
              const clickable = node.kind !== "pod";
              const hasTooltip = node.kind !== "service" && stats?.has(node.id);
              return (
                <g
                  key={node.id}
                  opacity={dimmed ? 0.35 : 1}
                  style={{ transition: "opacity 150ms", cursor: clickable ? "pointer" : "default" }}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={clickable ? `${node.kind === "group" ? "Expand" : "Open"} ${node.id}` : undefined}
                  onMouseEnter={(event) => {
                    setHoveredNode(node.id);
                    if (hasTooltip) setHover({ node, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY });
                  }}
                  onMouseMove={(event) => {
                    if (hasTooltip) setHover({ node, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY });
                  }}
                  onMouseLeave={() => {
                    setHoveredNode(null);
                    if (hasTooltip) setHover(null);
                  }}
                  onClick={clickable ? () => onNodeClick(node) : undefined}
                  onKeyDown={
                    clickable
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onNodeClick(node);
                          }
                        }
                      : undefined
                  }
                >
                  {!hasTooltip && <title>{`${node.id} — ${formatReqps(node.totalRate)} inbound`}</title>}
                  <NodeShape node={node} highlighted={hoveredNode === node.id} />
                  <text
                    x={node.x}
                    y={node.y + node.r + 15}
                    textAnchor="middle"
                    fill={INK.primary}
                    fontSize={11}
                    fontWeight={500}
                  >
                    {node.label}
                  </text>
                  {node.sublabel && (
                    <text
                      x={node.x}
                      y={node.y + node.r + 27}
                      textAnchor="middle"
                      fill={INK.secondary}
                      fontSize={10}
                    >
                      {node.sublabel}
                    </text>
                  )}
                  <text
                    x={node.x}
                    y={node.y + node.r + (node.sublabel ? 39 : 28)}
                    textAnchor="middle"
                    fill={INK.muted}
                    fontSize={10}
                    className="tabular"
                  >
                    {formatReqps(node.totalRate)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gridline pt-3">
        {HEALTH_LEGEND.map((item) => (
          <span key={item.level} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
            <span aria-hidden="true" style={{ color: STATUS[item.level] }}>
              {STATUS_GLYPH[item.level]}
            </span>
            <span>
              {item.label} <span className="text-ink-muted">({item.hint})</span>
            </span>
          </span>
        ))}
        <span className="text-[11px] text-ink-muted">
          Line thickness and node size scale with traffic volume.
          {pods > 0 && " Dotted edges are estimates or idle replicas."}
        </span>
        {footnote && <span className="basis-full text-[11px] text-ink-muted">{footnote}</span>}
      </div>
    </>
  );
}

/** Services are plain discs; pods get a filled core; AZ groups a double ring. */
function NodeShape({ node, highlighted }: { node: GraphNode; highlighted: boolean }) {
  const stroke = highlighted ? INK.secondary : STRUCTURE.hairline;
  return (
    <>
      <circle cx={node.x} cy={node.y} r={node.r} fill={STRUCTURE.surface} stroke={stroke} strokeWidth={1} />
      {node.kind === "pod" && <circle cx={node.x} cy={node.y} r={Math.max(node.r * 0.35, 4)} fill={INK.muted} />}
      {node.kind === "group" && (
        <circle
          cx={node.x}
          cy={node.y}
          r={Math.max(node.r - 5, 6)}
          fill="none"
          stroke={highlighted ? INK.secondary : INK.muted}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
    </>
  );
}

/** Warning glyph placed at the midpoint of an unhealthy edge. */
function EdgeBadge({ edge }: { edge: GraphEdge }) {
  const mid = midpoint(edge.path);
  if (!mid) return null;
  return (
    <g pointerEvents="none">
      <circle cx={mid.x} cy={mid.y} r={7.5} fill={STRUCTURE.surface} stroke={edge.color} strokeWidth={1} />
      <text
        x={mid.x}
        y={mid.y + 3.5}
        textAnchor="middle"
        fontSize={9}
        fill={edge.color}
        fontWeight={700}
      >
        !
      </text>
    </g>
  );
}

/** Dark tooltip matching ChartTooltip, positioned over the hovered edge. */
function EdgeTooltip({ hover }: { hover: HoverState }) {
  const edge = hover.edge!;
  const estimated = edge.origin === "estimate";
  return (
    <div
      className="pointer-events-none absolute z-10 w-max max-w-xs rounded-xl bg-surface-raised px-3 py-2 ring-1 ring-white/10 shadow-lg"
      style={{ left: hover.x + 14, top: hover.y + 14 }}
    >
      <p className="mb-1.5 text-[11px] font-medium text-ink">
        {displayName(edge.client)} <span className="text-ink-muted">→</span> {displayName(edge.server)}
      </p>
      <ul className="space-y-1 text-xs">
        <Row label="Status">
          <span style={{ color: edge.color }}>
            <span aria-hidden="true">{STATUS_GLYPH[edge.health]}</span> {HEALTH_LABEL[edge.health]}
          </span>
        </Row>
        <Row label="Requests">
          {formatReqps(edge.rate)}
          {estimated && <span className="text-ink-muted"> est.</span>}
        </Row>
        <Row label="Errors">{formatPercentUnit(edge.errorRatio)}</Row>
        <Row label="p95 latency">{formatSeconds(edge.latencyP95)}</Row>
        {edge.crossAzShare !== null && <Row label="Cross-AZ">{formatPercentUnit(edge.crossAzShare, 0)}</Row>}
        {edge.origin && (
          <li className="mt-1 border-t border-white/10 pt-1 text-[11px] text-ink-muted">{ORIGIN_LABEL[edge.origin]}</li>
        )}
      </ul>
    </div>
  );
}

/** Tooltip for a pod or AZ-group node in the drill-down. */
function NodeTooltip({ hover, stats }: { hover: HoverState; stats: Map<string, PodNodeStats> }) {
  const node = hover.node!;
  const stat = stats.get(node.id);
  if (!stat) return null;
  const errorRatio = stat.rate > 0 ? Math.min(stat.errorRate / stat.rate, 1) : 0;
  const many = stat.pods.length > 6;
  return (
    <div
      className="pointer-events-none absolute z-10 w-max max-w-sm rounded-xl bg-surface-raised px-3 py-2 ring-1 ring-white/10 shadow-lg"
      style={{ left: hover.x + 14, top: hover.y + 14 }}
    >
      <p className="mb-1.5 text-[11px] font-medium text-ink">
        {stat.kind === "pod" ? stat.pods[0] : `${stat.pods.length} pods in ${stat.azs.join(", ")}`}
      </p>
      <ul className="space-y-1 text-xs">
        {stat.kind === "pod" ? (
          <>
            <Row label="Node">{stat.nodes[0] ?? "—"}</Row>
            <Row label="AZ">{stat.azs[0] ?? "—"}</Row>
          </>
        ) : (
          <Row label="Nodes">{many ? `${stat.nodes.length} nodes` : stat.nodes.join(", ") || "—"}</Row>
        )}
        <Row label="Served">{formatReqps(stat.rate)}</Row>
        <Row label="Errors">{formatPercentUnit(errorRatio)}</Row>
        <Row label="p95 latency">{formatSeconds(stat.latencyP95)}</Row>
        {stat.kind === "group" && !many && (
          <li className="mt-1 border-t border-white/10 pt-1 text-[11px] text-ink-muted">{stat.pods.join(", ")}</li>
        )}
        {stat.kind === "group" && <li className="text-[11px] text-ink-muted">Click to show every pod.</li>}
      </ul>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-4">
      <span className="mr-auto text-ink-secondary">{label}</span>
      <span className="tabular font-medium text-ink">{children}</span>
    </li>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-gridline px-4 text-center text-xs text-ink-muted">
      <p className="max-w-md leading-relaxed">{children}</p>
    </div>
  );
}

function pairKey(labels: Record<string, string>): string {
  return `${labels.client ?? ""}→${labels.server ?? ""}`;
}

/** Drill-down node ids carry a kind prefix ("pod:", "group:"); tooltips drop it. */
function displayName(id: string): string {
  const stripped = id.replace(/^(pod|group):/, "");
  return stripped.includes("@") ? stripped.replace("@", " · ") : stripped;
}

/** Midpoint of the cubic in `path` at t=0.5, for badge placement. */
function midpoint(path: string): { x: number; y: number } | null {
  const numbers = path.match(/-?\d+(\.\d+)?/g);
  if (!numbers || numbers.length < 8) return null;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = numbers.slice(0, 8).map(Number);
  // Bezier at t=0.5 reduces to this weighted average.
  return {
    x: (x0 + 3 * x1 + 3 * x2 + x3) / 8,
    y: (y0 + 3 * y1 + 3 * y2 + y3) / 8,
  };
}
