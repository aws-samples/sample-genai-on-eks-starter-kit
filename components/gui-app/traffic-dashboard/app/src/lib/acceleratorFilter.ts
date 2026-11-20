import { AcceleratorKind, acceleratorKind } from "./accelerator";

/** Sentinel option meaning "don't filter on this dimension". */
export const ALL = "all";

/**
 * The four dimensions the GPU & Accelerators tables can be narrowed by. One
 * bar drives both the engine table and the per-pod table, so "show me team X
 * on Neuron" is a single selection rather than two.
 */
export interface AcceleratorFilter {
  kind: typeof ALL | AcceleratorKind;
  namespace: string;
  service: string;
  tenant: string;
}

export const EMPTY_FILTER: AcceleratorFilter = { kind: ALL, namespace: ALL, service: ALL, tenant: ALL };

/** What a row has to expose for the filter to judge it. */
export interface Filterable {
  namespace: string;
  service: string;
  /** Accelerator model name (DCGM modelName or the Neuron family), if known. */
  accelerator: string | null;
  tenants: string[];
}

export function matchesFilter(row: Filterable, filter: AcceleratorFilter): boolean {
  if (filter.kind !== ALL && acceleratorKind(row.accelerator ?? undefined) !== filter.kind) return false;
  if (filter.namespace !== ALL && row.namespace !== filter.namespace) return false;
  if (filter.service !== ALL && row.service !== filter.service) return false;
  if (filter.tenant !== ALL && !row.tenants.includes(filter.tenant)) return false;
  return true;
}

export function isFiltering(filter: AcceleratorFilter): boolean {
  return filter.kind !== ALL || filter.namespace !== ALL || filter.service !== ALL || filter.tenant !== ALL;
}
