// Per-grid portlet layout: the order the panels appear in, and the span
// (grid columns) and height (px, or null for "as tall as the content") of
// every panel. The defaults come from the section's JSX; the user's edits are
// persisted to localStorage under one key per grid so each section remembers
// its own arrangement. Lives outside any "use client" module so the pure
// helpers can be unit-tested or reused server-side.

export interface PortletDefault {
  id: string;
  /** Default width in grid columns (1..columns). */
  span: number;
  /** Narrowest the user may make it, in columns. */
  minSpan: number;
  /** Shortest the user may make it, in px; also the floor when a fixed height is set. */
  minHeight: number;
}

export interface PortletSize {
  span: number;
  /** null = auto height (intrinsic). */
  height: number | null;
}

/** What is written to storage. Partial so newly added panels fall back to defaults. */
export interface StoredLayout {
  v: 1;
  order: string[];
  sizes: Record<string, Partial<PortletSize>>;
}

export interface ResolvedLayout {
  order: string[];
  sizes: Record<string, PortletSize>;
}

const STORAGE_PREFIX = "ats.layout.v1.";

export function storageKey(gridId: string): string {
  return STORAGE_PREFIX + gridId;
}

export function readStoredLayout(gridId: string): StoredLayout | null {
  try {
    const raw = window.localStorage.getItem(storageKey(gridId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLayout>;
    if (parsed?.v !== 1 || !Array.isArray(parsed.order)) return null;
    return { v: 1, order: parsed.order.filter((x) => typeof x === "string"), sizes: parsed.sizes ?? {} };
  } catch {
    return null;
  }
}

export function writeStoredLayout(gridId: string, layout: ResolvedLayout): void {
  try {
    const stored: StoredLayout = { v: 1, order: layout.order, sizes: layout.sizes };
    window.localStorage.setItem(storageKey(gridId), JSON.stringify(stored));
  } catch {
    // Storage full or disabled: the layout still applies for this page load.
  }
}

export function clearStoredLayout(gridId: string): void {
  try {
    window.localStorage.removeItem(storageKey(gridId));
  } catch {
    // ignore
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Merge stored edits over the defaults. Panels that no longer exist are
 * dropped; panels added since the layout was saved are appended in their
 * default position relative to each other (at the end, so the user's ordering
 * of the panels they know is untouched). Spans are clamped to the current
 * column count so a layout saved on a wider grid still renders.
 */
export function resolveLayout(defaults: PortletDefault[], stored: StoredLayout | null, columns: number): ResolvedLayout {
  const byId = new Map(defaults.map((d) => [d.id, d]));
  const order: string[] = [];
  if (stored) {
    for (const id of stored.order) {
      if (byId.has(id) && !order.includes(id)) order.push(id);
    }
  }
  for (const d of defaults) {
    if (!order.includes(d.id)) order.push(d.id);
  }

  const sizes: Record<string, PortletSize> = {};
  for (const d of defaults) {
    const s = stored?.sizes?.[d.id];
    const span = typeof s?.span === "number" && Number.isFinite(s.span) ? s.span : d.span;
    const height = typeof s?.height === "number" && Number.isFinite(s.height) ? s.height : null;
    sizes[d.id] = {
      span: clamp(Math.round(span), Math.min(d.minSpan, columns), columns),
      height: height === null ? null : Math.max(d.minHeight, Math.round(height)),
    };
  }
  return { order, sizes };
}

export function defaultLayout(defaults: PortletDefault[], columns: number): ResolvedLayout {
  return resolveLayout(defaults, null, columns);
}

export function moveItem(order: string[], id: string, toIndex: number): string[] {
  const from = order.indexOf(id);
  if (from === -1) return order;
  const target = clamp(toIndex, 0, order.length - 1);
  if (from === target) return order;
  const next = order.slice();
  next.splice(from, 1);
  next.splice(target, 0, id);
  return next;
}

/** True when the layout differs from the defaults in order or in any size. */
export function isCustomized(layout: ResolvedLayout, defaults: PortletDefault[]): boolean {
  if (layout.order.some((id, i) => defaults[i]?.id !== id)) return true;
  return defaults.some((d) => {
    const s = layout.sizes[d.id];
    return !s || s.span !== d.span || s.height !== null;
  });
}
