"use client";

import { ReactNode } from "react";
import { SortState } from "@/lib/sort";

interface SortableThProps<K extends string> {
  label: ReactNode;
  sortKey: K;
  sort: SortState<K>;
  onToggle: (key: K) => void;
  align?: "left" | "right";
  title?: string;
  /** Extra classes on the <th>; pass "last" styling (no right padding) here. */
  className?: string;
}

/**
 * Column header that sorts the table when clicked. The whole cell is one
 * button so keyboard users tab to it; `aria-sort` on the <th> announces the
 * active direction. The idle glyph only shows on hover so a resting table does
 * not read as a row of arrows.
 */
export function SortableTh<K extends string>({ label, sortKey, sort, onToggle, align = "left", title, className }: SortableThProps<K>) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const glyph = active ? (sort.dir === "asc" ? "▲" : "▼") : "↕";
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      title={title}
      className={`py-2 font-medium ${align === "right" ? "text-right" : "text-left"} ${className ?? "pr-4"}`}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={`group flex w-full items-center gap-1 whitespace-nowrap rounded-sm transition-colors hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-ink-muted ${
          align === "right" ? "justify-end" : ""
        } ${active ? "text-ink" : ""}`}
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          className={`text-[10px] transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60"}`}
        >
          {glyph}
        </span>
      </button>
    </th>
  );
}
