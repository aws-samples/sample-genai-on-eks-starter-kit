"use client";

import { useMemo, useState } from "react";
import {
  EdgeInput,
  GraphEdge,
  HEALTH_LABEL,
  HEALTH_LEGEND,
  layoutServiceGraph,
} from "@/lib/graph";
import { useAcceleratorsByNode } from "@/lib/accelerator";
import { formatPercentUnit, formatReqps, formatSeconds } from "@/lib/format";
import { INK, STATUS, STATUS_GLYPH, STRUCTURE } from "@/lib/theme";
import { SERVICE_GRAPH } from "@/lib/queries";
import { useInstantVector } from "@/lib/useSeries";

/** Unhealthy edges are dashed as well as coloured, so status never rides on
 *  colour alone. Healthy edges stay solid. */
const DASH: Record<string, string | undefined> = {
  good: undefined,
  warning: "10 5",
  serious: "10 5",
  critical: "4 4",
};

interface HoverState {
  edge?: GraphEdge;
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
 * Filterable by namespace, service, worker node, AZ, CPU architecture and
 * accelerator (NVIDIA GPU model from DCGM, or AWS Inferentia / Trainium from
 * neuron-monitor). Namespace and service are labels on the edge itself. The
 * rest are attributes of the node whose Beyla DaemonSet pod reported the edge
 * — Beyla observes a call on the node running either endpoint's process, so
 * each of them reads as "edges with an endpoint on a matching node".
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
      return {
        client,
        server,
        rate: pairRate,
        errorRate: errorByPair.get(key) ?? 0,
        latencyP95: p95 !== undefined && Number.isFinite(p95) ? p95 : null,
      };
    });
    return layoutServiceGraph(inputs);
  }, [rate.rows, errors.rows, latency.rows, namespace, service, az, node, arch, gpu, nodesByPair, nodeDimsMatch]);

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
          AZ, arch, accelerator and node keep edges with an endpoint observed on a matching node.
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
          />
        )}

        {hover?.edge && <EdgeTooltip hover={hover} />}
      </div>
    </div>
  );
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
}: {
  layout: ReturnType<typeof layoutServiceGraph>;
  hoveredNode: string | null;
  setHoveredNode: (id: string | null) => void;
  setHover: (state: HoverState | null) => void;
  isDimmed: (edge: GraphEdge) => boolean;
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width="100%"
          height={layout.height}
          role="img"
          aria-label={`Service map: ${layout.nodes.length} services, ${layout.edges.length} connections`}
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
              return (
                <g key={edge.id} opacity={dimmed ? 0.15 : 1} style={{ transition: "opacity 150ms" }}>
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
                    stroke={edge.color}
                    strokeWidth={edge.strokeWidth}
                    strokeDasharray={DASH[edge.health]}
                    strokeLinecap="round"
                    markerEnd={`url(#arrow-${edge.health})`}
                    pointerEvents="none"
                  />
                  {/* Direction-of-travel shimmer. Separate path so it cannot
                      override the health dash on the stroke above; hidden
                      entirely under prefers-reduced-motion. */}
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
                  {/* Badge on unhealthy edges: a second non-colour signal. */}
                  {edge.health !== "good" && <EdgeBadge edge={edge} />}
                </g>
              );
            })}
          </g>

          <g>
            {layout.nodes.map((node) => {
              const dimmed = hoveredNode !== null && hoveredNode !== node.id;
              return (
                <g
                  key={node.id}
                  opacity={dimmed ? 0.35 : 1}
                  style={{ transition: "opacity 150ms", cursor: "default" }}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  <title>{`${node.id} — ${formatReqps(node.totalRate)} inbound`}</title>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.r}
                    fill={STRUCTURE.surface}
                    stroke={hoveredNode === node.id ? INK.secondary : STRUCTURE.hairline}
                    strokeWidth={1}
                  />
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
                  <text
                    x={node.x}
                    y={node.y + node.r + 28}
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
        </span>
      </div>
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
  return (
    <div
      className="pointer-events-none absolute z-10 w-max max-w-xs rounded-xl bg-surface-raised px-3 py-2 ring-1 ring-white/10 shadow-lg"
      style={{ left: hover.x + 14, top: hover.y + 14 }}
    >
      <p className="mb-1.5 text-[11px] font-medium text-ink">
        {edge.client} <span className="text-ink-muted">→</span> {edge.server}
      </p>
      <ul className="space-y-1 text-xs">
        <Row label="Status">
          <span style={{ color: edge.color }}>
            <span aria-hidden="true">{STATUS_GLYPH[edge.health]}</span> {HEALTH_LABEL[edge.health]}
          </span>
        </Row>
        <Row label="Requests">{formatReqps(edge.rate)}</Row>
        <Row label="Errors">{formatPercentUnit(edge.errorRatio)}</Row>
        <Row label="p95 latency">{formatSeconds(edge.latencyP95)}</Row>
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
