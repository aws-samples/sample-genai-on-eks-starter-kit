"use client";

import { ALL } from "@/lib/acceleratorFilter";

/**
 * One labelled dropdown of a filter bar. Options come from the data, so the
 * list never offers a value that would filter everything away; "All" is the
 * sentinel that lifts the constraint.
 */
export function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  /** Either plain values or value/label pairs (for kinds with display names). */
  options: (string | { value: string; label: string })[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
      {label}
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-48 rounded-lg bg-surface px-2 py-1 text-xs text-ink ring-1 ring-white/10 disabled:opacity-50"
      >
        <option value={ALL}>All</option>
        {options.map((option) => {
          const { value: v, label: l } = typeof option === "string" ? { value: option, label: option } : option;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
    </label>
  );
}
