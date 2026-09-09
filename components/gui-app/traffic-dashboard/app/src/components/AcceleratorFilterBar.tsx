"use client";

import { MultiSelect } from "./MultiSelect";
import { AcceleratorFilter, EMPTY_FILTER, isFiltering } from "@/lib/acceleratorFilter";

export interface AcceleratorFilterOptions {
  /** Grouped by family, so "NVIDIA L40S" and "AWS Inferentia2" are visibly different silicon. */
  accelerators: { value: string; label: string; group: string }[];
  namespaces: string[];
  services: string[];
  tenants: string[];
}

/**
 * The filter bar for the whole GPU & Accelerators section. It sits at the very
 * top because it scopes everything below it: the fleet table and its type tabs,
 * the per-model / per-pod engine table, the per-pod accelerator table, and the
 * DCGM or neuron-monitor detail panels.
 *
 * Every dimension is multi-select, so "these two pools on Inferentia" is one
 * selection rather than two passes. Accelerator picks the silicon by name;
 * Namespace and Service come from the pods themselves; Tenant is the LiteLLM
 * team alias with a key on the pod's model pool, so it only narrows vLLM engines
 * — a tenant selection hides pods no gateway route points at.
 */
export function AcceleratorFilterBar({
  value,
  onChange,
  options,
  summary,
}: {
  value: AcceleratorFilter;
  onChange: (next: AcceleratorFilter) => void;
  options: AcceleratorFilterOptions;
  /** Short "what survived the filter" line, e.g. "3 of 11 pods · 2 of 5 nodes". */
  summary?: string;
}) {
  const set = <K extends keyof AcceleratorFilter>(key: K, next: AcceleratorFilter[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-surface-raised/40 px-4 py-2.5 ring-1 ring-white/5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Filter section</span>
      <MultiSelect
        id="accel-filter-accelerator"
        label="Accelerator"
        values={value.accelerators}
        options={options.accelerators}
        onChange={(next) => set("accelerators", next)}
        emptyHint="No accelerator is reporting"
      />
      <MultiSelect
        id="accel-filter-namespace"
        label="Namespace"
        values={value.namespaces}
        options={options.namespaces}
        onChange={(next) => set("namespaces", next)}
        emptyHint="No accelerator pod is reporting"
      />
      <MultiSelect
        id="accel-filter-service"
        label="Service"
        values={value.services}
        options={options.services}
        onChange={(next) => set("services", next)}
        emptyHint="No accelerator pod is reporting"
      />
      <MultiSelect
        id="accel-filter-tenant"
        label="Tenant"
        values={value.tenants}
        options={options.tenants}
        onChange={(next) => set("tenants", next)}
        emptyHint="No LiteLLM tenant traffic seen"
      />
      {summary && <span className="tabular ml-auto text-[11px] text-ink-muted">{summary}</span>}
      {isFiltering(value) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER)}
          className={`rounded-md px-2 py-1 text-[11px] text-ink-secondary ring-1 ring-white/10 hover:text-ink ${
            summary ? "" : "ml-auto"
          }`}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
