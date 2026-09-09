"use client";

import {
  Children,
  DragEvent,
  KeyboardEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PortletDefault,
  PortletSize,
  ResolvedLayout,
  clamp,
  clearStoredLayout,
  defaultLayout,
  isCustomized,
  moveItem,
  readStoredLayout,
  resolveLayout,
  writeStoredLayout,
} from "@/lib/layout";

/** Tailwind `xl` breakpoint: the only width at which the full column grid is in effect. */
const XL_QUERY = "(min-width: 80rem)";
const DEFAULT_COLUMNS = 12;
const DEFAULT_MIN_SPAN = 2;
const DEFAULT_MIN_HEIGHT = 160;
const MAX_HEIGHT = 1400;
/** Keyboard resize increments. */
const KEY_HEIGHT_STEP = 40;

// ---------------------------------------------------------------------------
// Contexts

interface GridContextValue {
  columns: number;
  sizes: Record<string, PortletSize>;
  defaults: Map<string, PortletDefault>;
  dragging: string | null;
  gridRef: React.RefObject<HTMLDivElement | null>;
  startDrag: (id: string) => void;
  dragOver: (id: string) => void;
  endDrag: (commit: boolean) => void;
  moveBy: (id: string, delta: number) => void;
  resize: (id: string, patch: Partial<PortletSize>, commit: boolean) => void;
  resetSize: (id: string) => void;
}

const GridContext = createContext<GridContextValue | null>(null);

/**
 * Whether the enclosing portlet has a user-set height. Cards and charts read
 * this to switch from intrinsic sizing (chart at its fixed px height, card as
 * tall as its content) to fill mode (chart stretches, card body scrolls).
 */
const PortletSizedContext = createContext<boolean>(false);

export function usePortletSized(): boolean {
  return useContext(PortletSizedContext);
}

// ---------------------------------------------------------------------------
// Grid

interface PortletGridProps {
  /** Stable key for this grid's saved layout (one per section / sub-grid). */
  id: string;
  /** Columns at the `xl` breakpoint. Spans are expressed in these. */
  columns?: number;
  className?: string;
  children: ReactNode;
}

export interface PortletProps {
  id: string;
  /** Default width in columns; defaults to the full row. */
  span?: number;
  minSpan?: number;
  minHeight?: number;
  /** Name announced to assistive tech for the move/resize controls. */
  label?: string;
  children: ReactNode;
}

function isPortletElement(node: unknown): node is ReactElement<PortletProps> {
  return isValidElement(node) && node.type === Portlet;
}

/**
 * A responsive grid whose children — `Portlet`s — can be reordered by dragging
 * their grip and resized by dragging their corner. One column below `sm`, two
 * up to `xl`, then `columns` (12 by default) so spans map to thirds, quarters
 * and halves. The arrangement is saved per grid id in localStorage; the
 * server render always paints the default layout and the client applies the
 * saved one on mount.
 */
export function PortletGrid({ id, columns = DEFAULT_COLUMNS, className = "", children }: PortletGridProps) {
  const items = useMemo(() => Children.toArray(children).filter(isPortletElement), [children]);
  const defaults = useMemo<PortletDefault[]>(
    () =>
      items.map((el) => ({
        id: el.props.id,
        span: clamp(el.props.span ?? columns, 1, columns),
        minSpan: clamp(el.props.minSpan ?? DEFAULT_MIN_SPAN, 1, columns),
        minHeight: el.props.minHeight ?? DEFAULT_MIN_HEIGHT,
      })),
    [items, columns],
  );
  // Recompute only when the set of panels changes, not on every render.
  const defaultsKey = defaults.map((d) => `${d.id}:${d.span}:${d.minSpan}:${d.minHeight}`).join("|");
  const defaultsMap = useMemo(() => new Map(defaults.map((d) => [d.id, d])), [defaults]);

  const [layout, setLayout] = useState<ResolvedLayout>(() => defaultLayout(defaults, columns));
  const [hydrated, setHydrated] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  // Mirrors of the state for the drag/resize handlers. Drag events arrive in
  // quick succession (dragenter → drop) and React may not have re-rendered in
  // between, so handlers read the refs instead of a possibly stale closure.
  const layoutRef = useRef(layout);
  const draggingRef = useRef<string | null>(null);
  const beforeDrag = useRef<ResolvedLayout | null>(null);
  const lastReorder = useRef(0);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const update = useCallback((next: ResolvedLayout | ((current: ResolvedLayout) => ResolvedLayout)) => {
    const value = typeof next === "function" ? next(layoutRef.current) : next;
    layoutRef.current = value;
    setLayout(value);
  }, []);

  // Apply the stored layout after mount, and re-resolve if the panel set changes.
  useEffect(() => {
    update(resolveLayout(defaults, readStoredLayout(id), columns));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, columns, defaultsKey]);

  const commit = useCallback(
    (next: ResolvedLayout) => {
      update(next);
      if (isCustomized(next, defaults)) writeStoredLayout(id, next);
      else clearStoredLayout(id);
    },
    [id, defaults, update],
  );

  const startDrag = useCallback((pid: string) => {
    beforeDrag.current = layoutRef.current;
    draggingRef.current = pid;
    setDragging(pid);
  }, []);

  const dragOver = useCallback(
    (targetId: string) => {
      const source = draggingRef.current;
      if (!source || source === targetId) return;
      // Live reorder while hovering. Throttled so the two swapped elements do
      // not ping-pong when the pointer sits on the boundary between them; the
      // continuous dragover stream makes sure the last target still wins.
      const now = performance.now();
      if (now - lastReorder.current < 120) return;
      const toIndex = layoutRef.current.order.indexOf(targetId);
      if (toIndex === -1 || toIndex === layoutRef.current.order.indexOf(source)) return;
      lastReorder.current = now;
      update((current) => ({ ...current, order: moveItem(current.order, source, toIndex) }));
    },
    [update],
  );

  const endDrag = useCallback(
    (didCommit: boolean) => {
      if (!draggingRef.current) return;
      if (didCommit) commit(layoutRef.current);
      else if (beforeDrag.current) update(beforeDrag.current);
      beforeDrag.current = null;
      draggingRef.current = null;
      setDragging(null);
    },
    [commit, update],
  );

  const moveBy = useCallback(
    (pid: string, delta: number) => {
      const current = layoutRef.current;
      const from = current.order.indexOf(pid);
      if (from === -1) return;
      commit({ ...current, order: moveItem(current.order, pid, from + delta) });
    },
    [commit],
  );

  const resize = useCallback(
    (pid: string, patch: Partial<PortletSize>, didCommit: boolean) => {
      const d = defaultsMap.get(pid);
      if (!d) return;
      const current = layoutRef.current;
      const prev = current.sizes[pid] ?? { span: d.span, height: null };
      const span = patch.span === undefined ? prev.span : clamp(Math.round(patch.span), d.minSpan, columns);
      const height =
        patch.height === undefined
          ? prev.height
          : patch.height === null
            ? null
            : clamp(Math.round(patch.height), d.minHeight, MAX_HEIGHT);
      if (span === prev.span && height === prev.height) {
        if (didCommit) commit(current);
        return;
      }
      const next = { ...current, sizes: { ...current.sizes, [pid]: { span, height } } };
      if (didCommit) commit(next);
      else update(next);
    },
    [defaultsMap, columns, commit, update],
  );

  const resetSize = useCallback(
    (pid: string) => {
      const d = defaultsMap.get(pid);
      if (!d) return;
      const current = layoutRef.current;
      commit({ ...current, sizes: { ...current.sizes, [pid]: { span: d.span, height: null } } });
    },
    [defaultsMap, commit],
  );

  const reset = useCallback(() => {
    clearStoredLayout(id);
    update(defaultLayout(defaults, columns));
  }, [id, defaults, columns, update]);

  const byId = useMemo(() => new Map(items.map((el) => [el.props.id, el])), [items]);
  const ordered = layout.order.map((pid) => byId.get(pid)).filter((el): el is ReactElement<PortletProps> => Boolean(el));
  const customized = hydrated && isCustomized(layout, defaults);

  const ctx: GridContextValue = {
    columns,
    sizes: layout.sizes,
    defaults: defaultsMap,
    dragging,
    gridRef,
    startDrag,
    dragOver,
    endDrag,
    moveBy,
    resize,
    resetSize,
  };

  return (
    <GridContext.Provider value={ctx}>
      <div className={className}>
        {customized && (
          <div className="mb-2 flex items-center justify-end gap-3 text-[11px] text-ink-muted">
            <span>Custom layout</span>
            <button
              type="button"
              onClick={reset}
              className="rounded-md bg-surface px-2 py-1 font-medium text-ink-secondary ring-1 ring-white/10 transition-colors hover:bg-surface-raised hover:text-ink"
              title="Restore this section's default panel order and sizes"
            >
              Reset layout
            </button>
          </div>
        )}
        <div
          ref={gridRef}
          className="portlet-grid"
          style={{ "--cols": columns } as React.CSSProperties}
          data-dragging={dragging ? "true" : undefined}
        >
          {ordered}
        </div>
      </div>
    </GridContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Portlet

/**
 * One movable, resizable panel. Wraps whatever it is given (Card, StatTile, a
 * link tile) in a grid cell and adds two controls that appear on hover or
 * focus: a grip on the top edge to drag it to a new position, and a corner
 * handle to drag it to a new width (in columns) and height. Both also work
 * from the keyboard on the grip: arrows move the panel, shift+arrows resize
 * it, and Backspace restores its default size. Double-clicking the corner does
 * the same.
 */
export function Portlet({ id, label, children }: PortletProps) {
  const ctx = useContext(GridContext);
  const ref = useRef<HTMLDivElement | null>(null);
  const [resizing, setResizing] = useState(false);

  if (!ctx) {
    // Rendered outside a PortletGrid: behave as a plain wrapper.
    return <div className="min-w-0">{children}</div>;
  }

  const d = ctx.defaults.get(id);
  const size = ctx.sizes[id] ?? { span: d?.span ?? ctx.columns, height: null };
  const isDragging = ctx.dragging === id;
  // At the two-column (sm..xl) breakpoint a panel wider than half the row takes both columns.
  const spanSm = size.span * 2 > ctx.columns ? 2 : 1;
  const name = label ?? id;

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!ctx.dragging || ctx.dragging === id) return;
    e.preventDefault();
    ctx.dragOver(id);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!ctx.dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (ctx.dragging !== id) ctx.dragOver(id);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!ctx.dragging) return;
    e.preventDefault();
    ctx.endDrag(true);
  };

  return (
    <div
      ref={ref}
      className={`portlet group relative min-w-0 ${isDragging ? "opacity-40" : ""} ${
        resizing ? "select-none" : ""
      }`}
      style={
        {
          "--span-xl": size.span,
          "--span-sm": spanSm,
          height: size.height ?? undefined,
        } as React.CSSProperties
      }
      data-portlet={id}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <PortletSizedContext.Provider value={size.height !== null}>{children}</PortletSizedContext.Provider>

      <Grip id={id} name={name} ctx={ctx} hostRef={ref} size={size} />
      <ResizeHandle id={id} name={name} ctx={ctx} hostRef={ref} size={size} onResizing={setResizing} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls

interface ControlProps {
  id: string;
  name: string;
  ctx: GridContextValue;
  hostRef: React.RefObject<HTMLDivElement | null>;
  size: PortletSize;
}

const CONTROL_VISIBILITY =
  "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none";

function Grip({ id, name, ctx, hostRef, size }: ControlProps) {
  const onDragStart = (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    const host = hostRef.current;
    if (host) {
      // Drag the whole panel's picture, anchored where the grip sits.
      const rect = host.getBoundingClientRect();
      e.dataTransfer.setDragImage(host, e.clientX - rect.left, e.clientY - rect.top);
    }
    ctx.startDrag(id);
  };

  const onDragEnd = (e: DragEvent<HTMLButtonElement>) => {
    // dropEffect is "none" when the drag was cancelled (Escape, or dropped
    // outside any portlet); the live preview is then rolled back.
    ctx.endDrag(e.dataTransfer.dropEffect !== "none");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const host = hostRef.current;
    const currentHeight = size.height ?? host?.getBoundingClientRect().height ?? DEFAULT_MIN_HEIGHT;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        if (e.shiftKey) {
          if (e.key === "ArrowLeft") ctx.resize(id, { span: size.span - 1 }, true);
          else ctx.resize(id, { height: currentHeight - KEY_HEIGHT_STEP }, true);
        } else ctx.moveBy(id, -1);
        break;
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        if (e.shiftKey) {
          if (e.key === "ArrowRight") ctx.resize(id, { span: size.span + 1 }, true);
          else ctx.resize(id, { height: currentHeight + KEY_HEIGHT_STEP }, true);
        } else ctx.moveBy(id, 1);
        break;
      case "Backspace":
      case "Delete":
        e.preventDefault();
        ctx.resetSize(id);
        break;
      default:
        return;
    }
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      aria-label={`Move ${name}. Arrow keys reorder; Shift+arrows resize; Backspace restores the default size.`}
      title="Drag to reorder · arrows move · shift+arrows resize"
      className={`absolute left-1/2 top-1 z-10 flex h-4 w-10 -translate-x-1/2 cursor-grab items-center justify-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink active:cursor-grabbing ${CONTROL_VISIBILITY}`}
      style={{ touchAction: "none" }}
    >
      <svg width="16" height="6" viewBox="0 0 16 6" aria-hidden="true" fill="currentColor">
        <circle cx="2" cy="1.5" r="1.2" />
        <circle cx="8" cy="1.5" r="1.2" />
        <circle cx="14" cy="1.5" r="1.2" />
        <circle cx="2" cy="4.5" r="1.2" />
        <circle cx="8" cy="4.5" r="1.2" />
        <circle cx="14" cy="4.5" r="1.2" />
      </svg>
    </button>
  );
}

interface ResizeStart {
  pointerId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** px per column including the gap, at the xl breakpoint; null when spans do not apply. */
  columnPitch: number | null;
  gap: number;
}

function ResizeHandle({ id, name, ctx, hostRef, size, onResizing }: ControlProps & { onResizing: (v: boolean) => void }) {
  const start = useRef<ResizeStart | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const host = hostRef.current;
    const grid = ctx.gridRef.current;
    if (!host || !grid) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = host.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 16;
    const xl = window.matchMedia(XL_QUERY).matches;
    start.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height,
      columnPitch: xl ? (gridRect.width + gap) / ctx.columns : null,
      gap,
    };
    onResizing(true);
  };

  const compute = (e: PointerEvent<HTMLButtonElement>): Partial<PortletSize> | null => {
    const s = start.current;
    if (!s || e.pointerId !== s.pointerId) return null;
    const patch: Partial<PortletSize> = { height: s.height + (e.clientY - s.y) };
    if (s.columnPitch) {
      patch.span = Math.round((s.width + (e.clientX - s.x) + s.gap) / s.columnPitch);
    }
    return patch;
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const patch = compute(e);
    if (patch) ctx.resize(id, patch, false);
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const patch = compute(e);
    if (!patch) return;
    start.current = null;
    onResizing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    ctx.resize(id, patch, true);
  };

  const onPointerCancel = () => {
    start.current = null;
    onResizing(false);
  };

  return (
    <button
      type="button"
      aria-label={`Resize ${name}. Drag to change width and height; double-click to restore the default size.`}
      title="Drag to resize · double-click to reset size"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={() => ctx.resetSize(id)}
      className={`absolute bottom-1 right-1 z-10 grid h-5 w-5 cursor-nwse-resize place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink ${CONTROL_VISIBILITY}`}
      style={{ touchAction: "none" }}
      tabIndex={-1}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" stroke="currentColor" strokeWidth="1.2" fill="none">
        <path d="M9 1 L1 9" />
        <path d="M9 5 L5 9" />
      </svg>
    </button>
  );
}
