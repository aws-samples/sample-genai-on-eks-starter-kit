/**
 * Chart-facing mirror of the CSS custom properties in app/globals.css.
 * Recharts needs literal colour strings at render time, so the values live here
 * too — keep the two files in sync when a token changes.
 */

/** Categorical scale. Fixed order, never cycled: colour follows the entity, not
 *  its rank in the current result set. Charts with more than 8 series fold the
 *  tail into "Other" (see foldSeries). */
export const SERIES = [
  "#3987e5", // 1 blue
  "#d95926", // 2 orange
  "#199e70", // 3 aqua
  "#c98500", // 4 yellow
  "#d55181", // 5 magenta
  "#008300", // 6 green
  "#9085e9", // 7 violet
  "#e66767", // 8 red
] as const;

export const OTHER_COLOR = "#898781";

export const INK = {
  primary: "#ffffff",
  secondary: "#c3c2b7",
  muted: "#898781",
} as const;

export const STRUCTURE = {
  gridline: "#2c2c2a",
  baseline: "#383835",
  surface: "#1a1a19",
  hairline: "rgba(255,255,255,0.10)",
} as const;

export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

export type StatusLevel = keyof typeof STATUS;

/** Status is conveyed by icon + label as well as colour — never colour alone. */
export const STATUS_GLYPH: Record<StatusLevel, string> = {
  good: "●",
  warning: "▲",
  serious: "▲",
  critical: "■",
};

export const STATUS_LABEL: Record<StatusLevel, string> = {
  good: "Healthy",
  warning: "Watch",
  serious: "Degraded",
  critical: "Critical",
};

/** Stable colour per series name: the same entity keeps its colour across
 *  refreshes even when the ordering of the Prometheus response changes. */
export function colorForIndex(index: number): string {
  return SERIES[index % SERIES.length];
}

export const MAX_SERIES = 8;

/** 2px strokes for all line marks, per the design system. */
export const LINE_WIDTH = 2;
