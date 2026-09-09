"use client";

import { FilterSelect } from "./FilterSelect";
import { ACCELERATOR_KIND_LABEL, AcceleratorKind } from "@/lib/accelerator";
import { ALL, AcceleratorFilter, EMPTY_FILTER, isFiltering } from "@/lib/acceleratorFilter";

const KINDS: AcceleratorKind[] = ["gpu", "neuron"];

/**
 * The filter row shared by the engine table and the per-pod table. Accelerator
 * picks the silicon family; Namespace and Service come from the pods
 * themselves; Tenant is the LiteLLM team alias with a key on the pod's model
 * pool, so it only narrows vLLM engines — a tenant selection hides pods no
 * gateway route points at.
 */
export function AcceleratorFilterBar({
  value,
  onChange,
  options,
}: {
  value: AcceleratorFilter;
  onChange: (next: AcceleratorFilter) => void;
  options: { namespaces: string[]; services: string[]; tenants: string[] };
}) {
  const set = <K extends keyof AcceleratorFilter>(key: K, v: AcceleratorFilter[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-surface-raised/40 px-4 py-2.5 ring-1 ring-white/5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Filter tables</span>
      <FilterSelect
        id="accel-filter-kind"
        label="Accelerator"
        value={value.kind}
        options={KINDS.map((k) => ({ value: k, label: ACCELERATOR_KIND_LABEL[k] }))}
        onChange={(v) => set("kind", v as AcceleratorFilter["kind"])}
      />
      <FilterSelect id="accel-filter-namespace" label="Namespace" value={value.namespace} options={options.namespaces} onChange={(v) => set("namespace", v)} />
      <FilterSelect id="accel-filter-service" label="Service" value={value.service} options={options.services} onChange={(v) => set("service", v)} />
      <FilterSelect
        id="accel-filter-tenant"
        label="Tenant"
        value={value.tenant}
        options={options.tenants}
        onChange={(v) => set("tenant", v)}
        disabled={options.tenants.length === 0 && value.tenant === ALL}
      />
      {isFiltering(value) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER)}
          className="ml-auto rounded-md px-2 py-1 text-[11px] text-ink-secondary ring-1 ring-white/10 hover:text-ink"
        >
          Clear
        </button>
      )}
    </div>
  );
}
