"use client";

import { formatPercentUnit, formatReqps, formatShort } from "@/lib/format";
import { CACHE, CACHE_HIT_CRITICAL, CACHE_HIT_WARNING } from "@/lib/queries";
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
 */
export function CacheTenantTable() {
  const input = useInstantVector(CACHE.tenantInputTokens);
  const cached = useInstantVector(CACHE.tenantCachedTokens);
  const requests = useInstantVector(CACHE.tenantRequests);

  const cachedByKey = new Map(cached.rows.map((row) => [rowKey(row.labels), row.value]));
  const requestsByKey = new Map(requests.rows.map((row) => [rowKey(row.labels), row.value]));

  const rows: TenantRow[] = input.rows
    .map((row) => {
      const key = rowKey(row.labels);
      const cachedRate = cachedByKey.get(key) ?? 0;
      return {
        key,
        team: row.labels.team_alias || "—",
        apiKey: row.labels.api_key_alias || "—",
        endUser: clean(row.labels.end_user),
        template: clean(row.labels.metadata_prompt_template),
        version: clean(row.labels.metadata_prompt_template_version),
        pool: (row.labels.requested_model || "—").replace(/^vllm\//, ""),
        requestRate: requestsByKey.get(key) ?? 0,
        inputTokenRate: row.value,
        cachedTokenRate: cachedRate,
        cachedShare: row.value > 0 ? cachedRate / row.value : null,
      };
    })
    .sort((a, b) => (a.cachedShare ?? 2) - (b.cachedShare ?? 2) || a.team.localeCompare(b.team));

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
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <th className="py-2 pr-4 font-medium">Team</th>
            <th className="py-2 pr-4 font-medium">Key alias</th>
            <th className="py-2 pr-4 font-medium">End user</th>
            <th className="py-2 pr-4 font-medium">Prompt template</th>
            <th className="py-2 pr-4 font-medium">Model pool</th>
            <th className="py-2 pr-4 text-right font-medium">Requests</th>
            <th className="py-2 pr-4 text-right font-medium">Prompt tok/s</th>
            <th className="py-2 pr-4 text-right font-medium">Cached tok/s</th>
            <th className="py-2 font-medium">Cached share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const level = shareLevel(row.cachedShare);
            return (
              <tr key={row.key} className="border-b border-gridline/60 last:border-0">
                <td className="py-2 pr-4 text-ink">{row.team}</td>
                <td className="py-2 pr-4 font-mono text-[11px] text-ink-secondary">{row.apiKey}</td>
                <td className="py-2 pr-4 font-mono text-[11px] text-ink-secondary">{row.endUser}</td>
                <td className="py-2 pr-4 text-ink-secondary">
                  {row.template}
                  {row.version !== "—" && <span className="ml-1 rounded bg-surface-raised px-1 font-mono text-[10px] text-ink">{row.version}</span>}
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
  );
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

/** LiteLLM stringifies missing metadata as "None". */
function clean(value: string | undefined): string {
  return value && value !== "None" ? value : "—";
}

function shareLevel(share: number | null): keyof typeof STATUS | null {
  if (share === null) return null;
  if (share < CACHE_HIT_CRITICAL) return "critical";
  if (share < CACHE_HIT_WARNING) return "warning";
  return "good";
}
