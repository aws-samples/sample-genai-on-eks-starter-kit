"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Click-to-sort state for the data tables. Each table declares its columns as
 * accessors; the hook owns the active key/direction and `sortRows` produces a
 * stable, sorted copy. Missing values ("—" cells) always sink to the bottom so
 * that "sort by temperature" puts the hottest GPU first rather than a Neuron
 * pod that has no temperature at all.
 */

export type SortDir = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

export type SortValue = string | number | null | undefined;
export type SortAccessor<R> = (row: R) => SortValue;

export interface SortColumn<R, K extends string> {
  key: K;
  get: SortAccessor<R>;
  /** Direction on the first click: numbers open with the largest first, text A→Z. */
  initial: SortDir;
}

/** Numeric column — first click sorts largest first. */
export function numCol<R, K extends string>(key: K, get: SortAccessor<R>): SortColumn<R, K> {
  return { key, get, initial: "desc" };
}

/** Text column — first click sorts A→Z. */
export function strCol<R, K extends string>(key: K, get: SortAccessor<R>): SortColumn<R, K> {
  return { key, get, initial: "asc" };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function isMissing(v: SortValue): v is null | undefined {
  return v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));
}

/**
 * Orders two cell values. Missing values sort last in both directions; when a
 * column mixes numbers and strings the numbers come first.
 */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  const sign = dir === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return sign * (a - b);
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return sign * collator.compare(a, b);
}

/**
 * Stable sorted copy of `rows` by the active column. Ties (and rows whose
 * accessor is missing for this key) fall back to `tieBreak`, then to the input
 * order. An unknown key leaves the rows in `tieBreak` order.
 */
export function sortRows<R, K extends string>(
  rows: readonly R[],
  state: SortState<K>,
  columns: readonly SortColumn<R, K>[],
  tieBreak?: (a: R, b: R) => number,
): R[] {
  const column = columns.find((c) => c.key === state.key);
  const indexed = rows.map((row, index) => ({ row, index, value: column ? column.get(row) : null }));
  indexed.sort(
    (a, b) =>
      compareValues(a.value, b.value, state.dir) || (tieBreak ? tieBreak(a.row, b.row) : 0) || a.index - b.index,
  );
  return indexed.map((x) => x.row);
}

export interface SortControls<K extends string> {
  sort: SortState<K>;
  /** Click handler for a header: re-clicking the active column flips it, another column starts at its natural direction. */
  toggle: (key: K) => void;
  ariaSort: (key: K) => "ascending" | "descending" | "none";
}

export function useSortState<K extends string>(
  initial: SortState<K>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: readonly SortColumn<any, K>[],
): SortControls<K> {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const initialDir = useMemo(() => new Map(columns.map((c) => [c.key, c.initial] as const)), [columns]);
  const toggle = useCallback(
    (key: K) =>
      setSort((prev) =>
        prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: initialDir.get(key) ?? "asc" },
      ),
    [initialDir],
  );
  const ariaSort = useCallback(
    (key: K) => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none") as "ascending" | "descending" | "none",
    [sort],
  );
  return { sort, toggle, ariaSort };
}
