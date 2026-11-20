/**
 * Layered ("Sugiyama-lite") layout for the service map.
 *
 * Deliberately dependency-free: the graphs Tempo produces for this platform are
 * small (tens of nodes), so a longest-path layering plus barycentre ordering
 * gives a stable, readable left-to-right picture without pulling in a layout
 * library. Stability matters more than optimality here — the map repolls every
 * 15s and nodes must not jump between frames, so every ordering decision breaks
 * ties on the node name.
 *
 * Cycles are common in real service graphs (mutual dependencies, Redis/DB back-
 * references). Before layering, we identify "back edges" to temporarily ignore
 * during layer assignment (they are still rendered). This converts the graph to
 * a DAG for longest-path layering, preventing nodes in cycles from being pushed
 * to the rightmost layer.
 */

import { STATUS, StatusLevel } from "./theme";

export interface EdgeInput {
  client: string;
  server: string;
  rate: number;
  errorRate: number;
  latencyP95: number | null;
}

export interface GraphNode {
  id: string;
  /** Short display label; the full id stays available for the tooltip. */
  label: string;
  x: number;
  y: number;
  /** Radius, scaled by the node's total request rate. */
  r: number;
  totalRate: number;
  layer: number;
}

export interface GraphEdge extends EdgeInput {
  id: string;
  /** Share of requests that failed, 0..1. */
  errorRatio: number;
  health: StatusLevel;
  /** Cubic bezier path between the two node centres. */
  path: string;
  strokeWidth: number;
  color: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

const NODE_MIN_R = 16;
const NODE_MAX_R = 34;
const EDGE_MIN_W = 1.5;
const EDGE_MAX_W = 6;
const LAYER_GAP = 240;
const ROW_GAP = 92;
const MARGIN_X = 90;
const MARGIN_Y = 56;

/** Error-ratio thresholds: <1% healthy, 1-5% degraded, >5% failing. */
export function healthFor(errorRatio: number): StatusLevel {
  if (errorRatio > 0.05) return "critical";
  if (errorRatio >= 0.01) return "warning";
  return "good";
}

export const HEALTH_LEGEND: { level: StatusLevel; label: string; hint: string }[] = [
  { level: "good", label: "Healthy", hint: "under 1% errors" },
  { level: "warning", label: "Degraded", hint: "1-5% errors" },
  { level: "critical", label: "Failing", hint: "over 5% errors" },
];

/** Health labels for the map differ from the generic STATUS_LABEL wording. */
export const HEALTH_LABEL: Record<StatusLevel, string> = {
  good: "Healthy",
  warning: "Degraded",
  serious: "Degraded",
  critical: "Failing",
};

/**
 * Assigns each node to a layer by longest path from a source, orders nodes
 * within a layer by the average position of their predecessors, then emits
 * pixel coordinates and curved edge paths.
 */
export function layoutServiceGraph(inputs: EdgeInput[]): GraphLayout {
  const edges = dedupe(inputs);
  if (edges.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const ids = [...new Set(edges.flatMap((e) => [e.client, e.server]))].sort((a, b) => a.localeCompare(b));

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const id of ids) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of edges) {
    if (edge.client === edge.server) continue; // self-calls carry no layout information
    outgoing.get(edge.client)!.push(edge.server);
    incoming.get(edge.server)!.push(edge.client);
  }

  // Break cycles before layering to prevent nodes in cycles from being pushed
  // to the rightmost layer. Back edges are still rendered but ignored during
  // layer assignment.
  const backEdges = findBackEdges(ids, edges, outgoing);
  const incomingDag = new Map<string, string[]>();
  for (const id of ids) {
    incomingDag.set(
      id,
      (incoming.get(id) ?? []).filter((pred) => !backEdges.has(`${pred}→${id}`))
    );
  }

  const layerOf = assignLayers(ids, incomingDag);
  compactLayers(layerOf);
  const rows = orderWithinLayers(ids, layerOf, incomingDag);

  // Traffic volume drives node size and edge thickness.
  const totalRateById = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    totalRateById.set(edge.server, (totalRateById.get(edge.server) ?? 0) + edge.rate);
    // A pure client (an entry point) would otherwise render at minimum size.
    if (outgoing.get(edge.client)!.length > 0 && incoming.get(edge.client)!.length === 0) {
      totalRateById.set(edge.client, (totalRateById.get(edge.client) ?? 0) + edge.rate);
    }
  }
  const maxNodeRate = Math.max(...totalRateById.values(), 0);
  const maxEdgeRate = Math.max(...edges.map((e) => e.rate), 0);

  const layerCount = Math.max(...[...layerOf.values()]) + 1;
  const tallestLayer = Math.max(...rows.map((r) => r.length), 1);
  const width = MARGIN_X * 2 + (layerCount - 1) * LAYER_GAP;
  const height = MARGIN_Y * 2 + (tallestLayer - 1) * ROW_GAP;

  const nodes: GraphNode[] = [];
  rows.forEach((row, layer) => {
    // Centre each layer vertically so the graph reads as balanced.
    const offset = (height - (row.length - 1) * ROW_GAP) / 2;
    row.forEach((id, index) => {
      nodes.push({
        id,
        label: shortLabel(id),
        x: MARGIN_X + layer * LAYER_GAP,
        y: offset + index * ROW_GAP,
        r: scale(totalRateById.get(id) ?? 0, maxNodeRate, NODE_MIN_R, NODE_MAX_R),
        totalRate: totalRateById.get(id) ?? 0,
        layer,
      });
    });
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const laidOut: GraphEdge[] = edges
    .filter((edge) => nodeById.has(edge.client) && nodeById.has(edge.server))
    .map((edge) => {
      const from = nodeById.get(edge.client)!;
      const to = nodeById.get(edge.server)!;
      const errorRatio = edge.rate > 0 ? Math.min(edge.errorRate / edge.rate, 1) : 0;
      const health = healthFor(errorRatio);
      return {
        ...edge,
        id: `${edge.client}→${edge.server}`,
        errorRatio,
        health,
        path: curve(from, to),
        strokeWidth: scale(edge.rate, maxEdgeRate, EDGE_MIN_W, EDGE_MAX_W),
        color: STATUS[health],
      };
    });

  return { nodes, edges: laidOut, width, height };
}

/** Collapses duplicate (client, server) pairs, summing their rates. */
function dedupe(inputs: EdgeInput[]): EdgeInput[] {
  const byPair = new Map<string, EdgeInput>();
  for (const input of inputs) {
    if (!input.client || !input.server) continue;
    const key = `${input.client}→${input.server}`;
    const existing = byPair.get(key);
    if (!existing) {
      byPair.set(key, { ...input });
      continue;
    }
    existing.rate += input.rate;
    existing.errorRate += input.errorRate;
    existing.latencyP95 = Math.max(existing.latencyP95 ?? 0, input.latencyP95 ?? 0) || null;
  }
  return [...byPair.values()].sort((a, b) => a.client.localeCompare(b.client) || a.server.localeCompare(b.server));
}

/**
 * Identifies edges that close cycles so they can be ignored during layer
 * assignment (they are still rendered). Returns a set of edge keys in the
 * form "client→server".
 *
 * First, for every mutual pair (a→b and b→a both exist), the lower-rate
 * direction is marked as a back edge. Then an iterative DFS visits nodes in
 * sorted order and marks any edge whose target is already on the DFS stack
 * as a back edge. Iteration order is deterministic so output is stable.
 */
function findBackEdges(
  ids: string[],
  edges: EdgeInput[],
  outgoing: Map<string, string[]>
): Set<string> {
  const backEdges = new Set<string>();
  const edgeRate = new Map<string, number>();

  // Build edge rate map
  for (const edge of edges) {
    if (edge.client === edge.server) continue;
    edgeRate.set(`${edge.client}→${edge.server}`, edge.rate);
  }

  // Mark lower-rate direction in mutual pairs as back edges
  const mutualPairs = new Set<string>();
  for (const edge of edges) {
    if (edge.client === edge.server) continue;
    const forward = `${edge.client}→${edge.server}`;
    const reverse = `${edge.server}→${edge.client}`;
    if (edgeRate.has(reverse) && !mutualPairs.has(forward) && !mutualPairs.has(reverse)) {
      mutualPairs.add(forward);
      mutualPairs.add(reverse);
      const forwardRate = edgeRate.get(forward) ?? 0;
      const reverseRate = edgeRate.get(reverse) ?? 0;
      if (forwardRate < reverseRate) {
        backEdges.add(forward);
      } else if (reverseRate < forwardRate) {
        backEdges.add(reverse);
      } else {
        // Tie-break: the direction whose client sorts later
        if (edge.server.localeCompare(edge.client) < 0) {
          backEdges.add(forward);
        } else {
          backEdges.add(reverse);
        }
      }
    }
  }

  // Iterative DFS to find remaining cycle-closing edges
  const visited = new Set<string>();
  const stack = new Set<string>();
  const dfsStack: Array<{ node: string; children: string[]; index: number }> = [];

  for (const start of ids) {
    if (visited.has(start)) continue;

    dfsStack.push({ node: start, children: [], index: -1 });

    while (dfsStack.length > 0) {
      const frame = dfsStack[dfsStack.length - 1];

      // Initialize children on first visit
      if (frame.index === -1) {
        if (visited.has(frame.node)) {
          dfsStack.pop();
          continue;
        }
        visited.add(frame.node);
        stack.add(frame.node);

        // Get outgoing edges that aren't already marked as back edges
        frame.children = (outgoing.get(frame.node) ?? [])
          .filter((target) => !backEdges.has(`${frame.node}→${target}`))
          .sort((a, b) => a.localeCompare(b));
        frame.index = 0;
      }

      // Process next child
      if (frame.index < frame.children.length) {
        const target = frame.children[frame.index];
        frame.index += 1;

        if (stack.has(target)) {
          // Target is on the current DFS stack — this edge closes a cycle
          backEdges.add(`${frame.node}→${target}`);
        } else if (!visited.has(target)) {
          // Push the target onto the DFS stack
          dfsStack.push({ node: target, children: [], index: -1 });
        }
      } else {
        // All children processed, pop this node
        stack.delete(frame.node);
        dfsStack.pop();
      }
    }
  }

  return backEdges;
}

/**
 * Longest-path layering on a DAG (back edges have been removed from the
 * incoming map). The fixed-point iteration remains as a safety net, but
 * should now converge quickly without hitting the cap.
 */
function assignLayers(ids: string[], incoming: Map<string, string[]>): Map<string, number> {
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false;
    for (const id of ids) {
      const preds = incoming.get(id) ?? [];
      if (preds.length === 0) continue;
      const candidate = Math.max(...preds.map((p) => layer.get(p) ?? 0)) + 1;
      if (candidate > (layer.get(id) ?? 0)) {
        layer.set(id, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

/**
 * Compacts layer assignments to remove gaps, mapping the distinct used layer
 * values to a contiguous sequence 0..k-1 while preserving order.
 */
function compactLayers(layerOf: Map<string, number>): void {
  const usedLayers = [...new Set(layerOf.values())].sort((a, b) => a - b);
  const compactMap = new Map(usedLayers.map((layer, index) => [layer, index]));
  for (const [id, layer] of layerOf.entries()) {
    layerOf.set(id, compactMap.get(layer)!);
  }
}

/** Barycentre ordering: a node sits near the average row of its predecessors. */
function orderWithinLayers(
  ids: string[],
  layerOf: Map<string, number>,
  incoming: Map<string, string[]>,
): string[][] {
  const layerCount = Math.max(...[...layerOf.values()]) + 1;
  const rows: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of ids) rows[layerOf.get(id) ?? 0].push(id);

  const rowIndex = new Map<string, number>();
  rows.forEach((row) => {
    row.sort((a, b) => a.localeCompare(b));
    row.forEach((id, index) => rowIndex.set(id, index));
  });

  for (let layer = 1; layer < rows.length; layer += 1) {
    const scored = rows[layer].map((id) => {
      const preds = (incoming.get(id) ?? []).filter((p) => (layerOf.get(p) ?? 0) < layer);
      const barycentre =
        preds.length === 0
          ? Number.MAX_SAFE_INTEGER // no predecessor in an earlier layer — park it last
          : preds.reduce((sum, p) => sum + (rowIndex.get(p) ?? 0), 0) / preds.length;
      return { id, barycentre };
    });
    // Name breaks ties so the ordering is identical on every refresh.
    scored.sort((a, b) => a.barycentre - b.barycentre || a.id.localeCompare(b.id));
    rows[layer] = scored.map((s) => s.id);
    rows[layer].forEach((id, index) => rowIndex.set(id, index));
  }

  return rows;
}

/**
 * Cubic bezier with horizontal control points. Same-layer edges bow outward so
 * they stay distinguishable from a straight line between neighbours.
 */
function curve(from: GraphNode, to: GraphNode): string {
  const dx = to.x - from.x;
  if (Math.abs(dx) < 1) {
    const bow = 60 + Math.abs(to.y - from.y) * 0.25;
    return `M ${from.x} ${from.y} C ${from.x + bow} ${from.y}, ${to.x + bow} ${to.y}, ${to.x} ${to.y}`;
  }
  const control = dx * 0.5;
  return `M ${from.x} ${from.y} C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x} ${to.y}`;
}

/** Square-root scale: area reads closer to the value than radius would. */
function scale(value: number, max: number, min: number, cap: number): number {
  if (max <= 0 || value <= 0) return min;
  return min + (cap - min) * Math.sqrt(value / max);
}

/** Service names arrive fully qualified; keep the leading component. */
function shortLabel(id: string): string {
  const trimmed = id.split(".")[0];
  return trimmed.length > 22 ? `${trimmed.slice(0, 21)}…` : trimmed;
}
