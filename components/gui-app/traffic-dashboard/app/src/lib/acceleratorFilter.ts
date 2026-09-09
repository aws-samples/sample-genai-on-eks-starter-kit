/**
 * The four dimensions the GPU & Accelerators section can be narrowed by.
 *
 * Every dimension is a list, not a single value: an operator comparing two
 * model pools or two accelerator generations wants both on screen at once, and
 * a single-select bar forces them to look twice and remember the first number.
 * An empty list means "don't constrain this dimension" — there is no "All"
 * sentinel to keep out of the value space.
 *
 * The bar lives at the top of the section and scopes everything below it,
 * including the DCGM / neuron-monitor detail panels, which is why the filter is
 * kept as plain data here: src/lib/acceleratorScope.ts turns it into both
 * client-side row predicates and PromQL label matchers.
 */

/** Sentinel option meaning "don't filter on this dimension".
 *
 *  Only the single-select `FilterSelect` control (the Service Map's filters)
 *  still uses it; the accelerator filter expresses the same thing as an empty
 *  list, so no real accelerator name can ever collide with it. */
export const ALL = "all";

export interface AcceleratorFilter {
  /** Accelerator names as the fleet table shows them: "NVIDIA L40S", "NVIDIA B200", "AWS Inferentia2". Empty = all. */
  accelerators: string[];
  namespaces: string[];
  services: string[];
  tenants: string[];
}

export const EMPTY_FILTER: AcceleratorFilter = { accelerators: [], namespaces: [], services: [], tenants: [] };

/** What a row has to expose for the filter to judge it. */
export interface Filterable {
  namespace: string;
  service: string;
  /** Accelerator model name (DCGM modelName or the Neuron family), if known. */
  accelerator: string | null;
  tenants: string[];
}

/**
 * A row survives when every non-empty dimension contains its value. Tenants are
 * a set on both sides, so the test is a non-empty intersection: a pod serving a
 * pool two selected teams share matches once, not twice.
 *
 * A row whose accelerator is unknown (no exporter has claimed its node) cannot
 * satisfy an accelerator selection, so it drops out rather than passing by
 * default — an unattributed row is not evidence that it runs the chosen silicon.
 */
export function matchesFilter(row: Filterable, filter: AcceleratorFilter): boolean {
  if (filter.accelerators.length > 0 && (row.accelerator === null || !filter.accelerators.includes(row.accelerator))) {
    return false;
  }
  if (filter.namespaces.length > 0 && !filter.namespaces.includes(row.namespace)) return false;
  if (filter.services.length > 0 && !filter.services.includes(row.service)) return false;
  if (filter.tenants.length > 0 && !row.tenants.some((tenant) => filter.tenants.includes(tenant))) return false;
  return true;
}

export function isFiltering(filter: AcceleratorFilter): boolean {
  return (
    filter.accelerators.length > 0 ||
    filter.namespaces.length > 0 ||
    filter.services.length > 0 ||
    filter.tenants.length > 0
  );
}

/** Add or remove one value, keeping the list sorted so two equivalent
 *  selections are the same array and memoised derivations stay stable. */
export function toggleValue(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value].sort((a, b) => a.localeCompare(b));
}
