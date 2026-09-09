"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toggleValue } from "@/lib/acceleratorFilter";

export type MultiSelectOption = string | { value: string; label: string; group?: string };

interface Option {
  value: string;
  label: string;
  group?: string;
  /** Selected, but no longer in the data — kept visible so a selection is never invisible. */
  missing?: boolean;
}

/** Above this many options the popover gets a text box; below it, scanning is faster than typing. */
const SEARCH_THRESHOLD = 8;

/**
 * One labelled multi-select of a filter bar: a trigger that reads as a select,
 * and a checkbox list in a popover.
 *
 * Empty means "all", so the trigger summarises rather than enumerating — an
 * operator comparing four model pools should not lose the filter bar's shape to
 * a growing chip list. Selections stay in the list even when the underlying data
 * stops reporting them (marked "not present"), because silently dropping the
 * option would leave a filter in force with nothing on screen explaining it.
 */
export function MultiSelect({
  id,
  label,
  values,
  options,
  onChange,
  disabled,
  emptyHint,
}: {
  id: string;
  label: string;
  values: string[];
  options: MultiSelectOption[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  /** Tooltip for the disabled trigger, explaining why there is nothing to pick. */
  emptyHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = `${id}-popover`;

  const all = useMemo<Option[]>(() => {
    const normalised: Option[] = options.map((option) =>
      typeof option === "string" ? { value: option, label: option } : { ...option },
    );
    const known = new Set(normalised.map((option) => option.value));
    const orphans = values
      .filter((value) => !known.has(value))
      .map((value) => ({ value, label: value, missing: true }));
    return [...normalised, ...orphans];
  }, [options, values]);

  const searchable = all.length > SEARCH_THRESHOLD;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((option) => option.label.toLowerCase().includes(needle));
  }, [all, query]);

  // Same convention as the agent health strip: close on a click anywhere outside
  // and on Escape, and hand focus back to the trigger so the keyboard path works.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const labelOf = (value: string) => all.find((option) => option.value === value)?.label ?? value;
  const summary =
    values.length === 0
      ? "All"
      : values.length === 1
        ? labelOf(values[0])
        : values.length === 2
          ? `${labelOf(values[0])}, ${labelOf(values[1])}`
          : `${values.length} selected`;

  const isDisabled = disabled || (all.length === 0 && values.length === 0);

  // Group headers only when the options carry groups; first-seen order wins so
  // the caller controls it.
  const groups: { name: string | undefined; options: Option[] }[] = [];
  for (const option of visible) {
    const last = groups[groups.length - 1];
    if (last && last.name === option.group) last.options.push(option);
    else groups.push({ name: option.group, options: [option] });
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5 text-[11px] text-ink-secondary">
      <span id={`${id}-label`}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-labelledby={`${id}-label`}
        disabled={isDisabled}
        title={isDisabled ? emptyHint : undefined}
        onClick={() => setOpen((previous) => !previous)}
        className="flex max-w-56 items-center gap-1.5 rounded-lg bg-surface px-2 py-1 text-xs text-ink ring-1 ring-white/10 disabled:opacity-50"
      >
        <span className="truncate">{summary}</span>
        {values.length > 0 && (
          <span className="tabular rounded bg-surface-raised px-1 text-[10px] text-ink-secondary">{values.length}</span>
        )}
        <span aria-hidden="true" className="text-ink-muted">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={popoverId}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={`${id}-label`}
          className="absolute left-0 top-full z-30 mt-1 min-w-56 max-h-72 overflow-auto rounded-xl bg-surface-raised p-1.5 ring-1 ring-white/10 shadow-lg"
        >
          {searchable && (
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter…"
              aria-label={`Filter ${label} options`}
              className="mb-1 w-full rounded-md bg-surface px-2 py-1 text-xs text-ink ring-1 ring-white/10 placeholder:text-ink-muted"
            />
          )}

          {visible.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-ink-muted">No match</p>
          ) : (
            groups.map((group) => (
              <div key={group.name ?? "_"}>
                {group.name && (
                  <p className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-ink-muted">{group.name}</p>
                )}
                {group.options.map((option) => {
                  const checked = values.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      role="option"
                      aria-selected={checked}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-ink hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onChange(toggleValue(values, option.value))}
                        className="accent-current"
                      />
                      <span className="truncate">{option.label}</span>
                      {option.missing && <span className="shrink-0 text-ink-muted">(not present)</span>}
                    </label>
                  );
                })}
              </div>
            ))
          )}

          <div className="mt-1 flex items-center gap-3 border-t border-gridline px-2 pt-1.5">
            <button
              type="button"
              onClick={() => onChange(all.map((option) => option.value).sort((a, b) => a.localeCompare(b)))}
              className="text-[11px] text-ink-secondary hover:text-ink"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-ink-secondary hover:text-ink"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
