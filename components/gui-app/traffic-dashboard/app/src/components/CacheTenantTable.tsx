"use client";

import { useMemo, useState } from "react";
import { MultiSelect } from "./MultiSelect";
import { SortableTh } from "./SortableTh";
import { formatPercentUnit, formatReqps, formatShort } from "@/lib/format";
import { CACHE, CACHE_HIT_CRITICAL, CACHE_HIT_WARNING } from "@/lib/queries";
import { SortColumn, numCol, sortRows, strCol, useSortState } from "@/lib/sort";
import { STATUS, STATUS_GLYPH } from "@/lib/theme";
import { useInstantVector } from "@/lib/useSeries";

interface TenantRow {
  key: string;
  team: string;
  apiKey: string;
  endUser: string;
  template: string;
  version: string;
  pool: string;
  requestRate: number;
  inputTokenRate: number;
  cachedTokenRate: number;
  cachedShare: number | null;
}

/** The six identity columns a row can be narrowed by. Empty list = no constraint. */
interface TenantFilter {
  teams: string[];
  apiKeys: string[];
  endUsers: string[];
  templates: string[];
  versions: string[];
  pools: string[];
}

const EMPTY_TENANT_FILTER: TenantFilter = { teams: [], apiKeys: [], endUsers: [], templates: [], versions: [], pools: [] };

/** Placeholder for a label LiteLLM did not set ("None" or empty). */
const NONE = "—";

type TenantSortKey =
  | "team"
  | "apiKey"
  | "endUser"
  | "template"
  | "pool"
  | "requestRate"
  | "inputTokenRate"
  | "cachedTokenRate"
  | "cachedShare";

/** Sortable columns. The placeholder "—" counts as missing so unset labels sink to the bottom either way. */
const SORT_COLUMNS: SortColumn<TenantRow, TenantSortKey>[] = [
  strCol("team", (r) => label(r.team)),
  strCol("apiKey", (r) => label(r.apiKey)),
  strCol("endUser", (r) => label(r.endUser)),
  // Template and its version sort as one text ("support v2" before "support v3").
  strCol("template", (r) => (r.template === NONE ? null : r.version === NONE ? r.template : `${r.template} ${r.version}`)),
  strCol("pool", (r) => label(r.pool)),
  numCol("requestRate", (r) => r.requestRate),
  numCol("inputTokenRate", (r) => r.inputTokenRate),
  numCol("cachedTokenRate", (r) => r.cachedTokenRate),
  numCol("cachedShare", (r) => r.cachedShare),
];

/** Lowest cached share first: the tenants losing the cache lead the table, as before sorting was added. */
const DEFAULT_SORT = { key: "cachedShare", dir: "asc" } as const;

/** Rows tied on the sort column keep a stable identity order. */
function tenantTieBreak(a: TenantRow, b: TenantRow): number {
  return a.team.localeCompare(b.team) || a.template.localeCompare(b.template) || a.pool.localeCompare(b.pool);
}

const FILTER_DIMENSIONS: { key: keyof TenantFilter; field: keyof TenantRow; label: string }[] = [
  { key: "teams", field: "team", label: "Team" },
  { key: "apiKeys", field: "apiKey", label: "Key alias" },
  { key: "endUsers", field: "endUser", label: "End user" },
  { key: "templates", field: "template", label: "Template" },
  { key: "versions", field: "version", label: "Version" },
  { key: "pools", field: "pool", label: "Model pool" },
];

/**
 * Tenant × prompt-template × pool view of the cache, from the gateway side.
 *
 * vLLM cannot say who a cache hit belonged to. LiteLLM can: with the Prometheus
 * callback on, every request is counted under the virtual key's team and alias,
 * the `user` field (end_user) and the request's metadata.* fields (custom
 * labels), and the backend's usage.prompt_tokens_details.cached_tokens is
 * accumulated under the same labels. Cached share = cached / input tokens, the
 * per-tenant analogue of the engine's hit ratio. The template version column is
 * what turns a prompt rollout into a visible cache-invalidation event.
 *
 * The table is one row per distinct label combination, so with a handful of
 * tenants, end users and template versions it runs to dozens of rows. The filter
 * bar above it narrows by any of the identity columns; every dimension is
 * multi-select so "v1 against v2 of this template on this pool" is one view.
 * Option lists come from the unfiltered rows, so narrowing never removes the
 * way back out, and a row whose label is unset is selectable as "(none)".
 * Every column header sorts (same SortableTh as the engine and fleet tables);
 * the default order is lowest cached share first.
 */
export function CacheTenantTable() {
  const input = useInstantVector(CACHE.tenantInputTokens);
  const cached = useInstantVector(CACHE.tenantCachedTokens);
  const requests = useInstantVector(CACHE.tenantRequests);
  const [filter, setFilter] = useState<TenantFilter>(EMPTY_TENANT_FILTER);
  const { sort, toggle } = useSortState<TenantSortKey>(DEFAULT_SORT, SORT_COLUMNS);

  const rows: TenantRow[] = useMemo(() => {
    const cachedByKey = new Map(cached.rows.map((row) => [rowKey(row.labels), row.value]));
    const requestsByKey = new Map(requests.rows.map((row) => [rowKey(row.labels), row.value]));
    return input.rows
      .map((row) => {
        const key = rowKey(row.labels);
        const cachedRate = cachedByKey.get(key) ?? 0;
        return {
          key,
          team: clean(row.labels.team_alias),
          apiKey: clean(row.labels.api_key_alias),
          endUser: clean(row.labels.end_user),
          template: clean(row.labels.metadata_prompt_template),
          version: clean(row.labels.metadata_prompt_template_version),
          pool: (row.labels.requested_model || NONE).replace(/^vllm\//, ""),
          requestRate: requestsByKey.get(key) ?? 0,
          inputTokenRate: row.value,
          cachedTokenRate: cachedRate,
          cachedShare: row.value > 0 ? cachedRate / row.value : null,
        };
      });
  }, [input.rows, cached.rows, requests.rows]);

  const options = useMemo(() => {
    const out = {} as Record<keyof TenantFilter, { value: string; label: string }[]>;
    for (const dim of FILTER_DIMENSIONS) {
      const values = [...new Set(rows.map((row) => String(row[dim.field])))].sort(compareOption);
      out[dim.key] = values.map((value) => ({ value, label: value === NONE ? "(none)" : value }));
    }
    return out;
  }, [rows]);

  const visible = useMemo(
    () => sortRows(rows.filter((row) => matchesTenantFilter(row, filter)), sort, SORT_COLUMNS, tenantTieBreak),
    [rows, filter, sort],
  );
  const filtering = isTenantFiltering(filter);
  const sortable = { sort, onToggle: toggle };

  const error = input.error ?? cached.error;
  if (error) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        <span className="text-status-serious">▲</span> Query failed — {error.message}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        {input.isLoading
          ? "Loading…"
          : "No tenant traffic through LiteLLM virtual keys in the window (master-key requests carry no tenant identity)."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-surface-raised/40 px-4 py-2.5 ring-1 ring-white/5"
        role="group"
        aria-label="Filter tenant rows"
      >
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Filter rows</span>
        {FILTER_DIMENSIONS.map((dim) => (
          <MultiSelect
            key={dim.key}
            id={`cache-tenant-filter-${dim.key}`}
            label={dim.label}
            values={filter[dim.key]}
            options={options[dim.key]}
            onChange={(next) => setFilter((previous) => ({ ...previous, [dim.key]: next }))}
            emptyHint="No value reported"
          />
        ))}
        <span className="tabular ml-auto text-[11px] text-ink-muted" aria-live="polite">
          {filtering ? `${visible.length} of ${rows.length} rows` : `${rows.length} rows`}
        </span>
        {filtering && (
          <button
            type="button"
            onClick={() => setFilter(EMPTY_TENANT_FILTER)}
            className="rounded-md px-2 py-1 text-[11px] text-ink-secondary ring-1 ring-white/10 hover:text-ink"
          >
            Clear all
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gridline px-4 py-8 text-center text-xs text-ink-muted">
          No row matches the current filter. Clear a filter to widen the view.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gridline text-left text-ink-muted">
                <SortableTh label="Team" sortKey="team" {...sortable} />
                <SortableTh label="Key alias" sortKey="apiKey" {...sortable} />
                <SortableTh label="End user" sortKey="endUser" {...sortable} />
                <SortableTh label="Prompt template" sortKey="template" {...sortable} title="Template name, then version" />
                <SortableTh label="Model pool" sortKey="pool" {...sortable} />
                <SortableTh label="Requests" sortKey="requestRate" {...sortable} align="right" />
                <SortableTh label="Prompt tok/s" sortKey="inputTokenRate" {...sortable} align="right" />
                <SortableTh label="Cached tok/s" sortKey="cachedTokenRate" {...sortable} align="right" />
                <SortableTh label="Cached share" sortKey="cachedShare" {...sortable} className="" title="Cached ÷ prompt tokens; rows without prompt tokens sort last" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const level = shareLevel(row.cachedShare);
                return (
                  <tr key={row.key} className="border-b border-gridline/60 last:border-0">
                    <td className="py-2 pr-4 text-ink">{row.team}</td>
                    <td className="py-2 pr-4 font-mono text-[11px] text-ink-secondary">{row.apiKey}</td>
                    <td className="py-2 pr-4 font-mono text-[11px] text-ink-secondary">{row.endUser}</td>
                    <td className="py-2 pr-4 text-ink-secondary">
                      {row.template}
                      {row.version !== NONE && (
                        <span className="ml-1 rounded bg-surface-raised px-1 font-mono text-[10px] text-ink">{row.version}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-ink">{row.pool}</td>
                    <td className="tabular py-2 pr-4 text-right text-ink">{formatReqps(row.requestRate)}</td>
                    <td className="tabular py-2 pr-4 text-right text-ink">{formatShort(row.inputTokenRate)}</td>
                    <td className="tabular py-2 pr-4 text-right text-ink">{formatShort(row.cachedTokenRate)}</td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1.5" style={{ color: level ? STATUS[level] : undefined }}>
                        {level && level !== "good" && <span aria-hidden="true">{STATUS_GLYPH[level]}</span>}
                        <span className="tabular">{formatPercentUnit(row.cachedShare, 1)}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A row survives when every non-empty dimension contains its value. */
function matchesTenantFilter(row: TenantRow, filter: TenantFilter): boolean {
  return FILTER_DIMENSIONS.every((dim) => {
    const selected = filter[dim.key];
    return selected.length === 0 || selected.includes(String(row[dim.field]));
  });
}

function isTenantFiltering(filter: TenantFilter): boolean {
  return FILTER_DIMENSIONS.some((dim) => filter[dim.key].length > 0);
}

/** Real values alphabetically, the "(none)" placeholder last. */
function compareOption(a: string, b: string): number {
  if (a === NONE) return b === NONE ? 0 : 1;
  if (b === NONE) return -1;
  return a.localeCompare(b);
}

function rowKey(labels: Record<string, string>): string {
  return [
    labels.team_alias,
    labels.api_key_alias,
    labels.end_user,
    labels.metadata_prompt_template,
    labels.metadata_prompt_template_version,
    labels.requested_model,
  ]
    .map((v) => v ?? "")
    .join("|");
}

/** Sort value for an identity cell: the "—" placeholder is a missing value. */
function label(value: string): string | null {
  return value === NONE ? null : value;
}

/** LiteLLM stringifies missing metadata as "None". */
function clean(value: string | undefined): string {
  return value && value !== "None" ? value : NONE;
}

function shareLevel(share: number | null): keyof typeof STATUS | null {
  if (share === null) return null;
  if (share < CACHE_HIT_CRITICAL) return "critical";
  if (share < CACHE_HIT_WARNING) return "warning";
  return "good";
}
