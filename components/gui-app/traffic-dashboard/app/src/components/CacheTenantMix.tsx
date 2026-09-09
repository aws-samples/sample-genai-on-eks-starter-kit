"use client";

import { ratio } from "@/lib/cache";
import { formatPercentUnit, formatReqps } from "@/lib/format";
import { CACHE } from "@/lib/queries";
import { colorForIndex } from "@/lib/theme";
import { useInstantVector } from "@/lib/useSeries";

interface TenantShare {
  tenant: string;
  rate: number;
  share: number;
}

interface PoolRow {
  model: string;
  hitRatio: number | null;
  totalRate: number;
  tenants: TenantShare[];
}

/**
 * Tenant mix per model pool. The cache-hit cliff is usually a mixing problem:
 * several tenants with unrelated prefixes share one pool and evict each other's
 * blocks. vLLM cannot attribute a hit to a caller, but the Beyla service graph
 * can say who is calling — so each pool's hit ratio is shown next to the
 * workloads (client namespace/service) that make up its traffic.
 */
export function CacheTenantMix() {
  const mix = useInstantVector(CACHE.tenantMix);
  const hits = useInstantVector(CACHE.podHits);
  const queries = useInstantVector(CACHE.podQueries);

  // Only servers that are vLLM model pools; everything else in the graph is noise here.
  const hitsByModel = sumBy(hits.rows, "model_name");
  const queriesByModel = sumBy(queries.rows, "model_name");
  const models = new Set([...hitsByModel.keys(), ...queriesByModel.keys()]);

  const byModel = new Map<string, Map<string, number>>();
  for (const row of mix.rows) {
    const model = row.labels.server;
    if (!model || !models.has(model)) continue;
    const tenant = tenantName(row.labels);
    const tenants = byModel.get(model) ?? new Map<string, number>();
    tenants.set(tenant, (tenants.get(tenant) ?? 0) + row.value);
    byModel.set(model, tenants);
  }

  const rows: PoolRow[] = [...models]
    .sort((a, b) => a.localeCompare(b))
    .map((model) => {
      const tenants = byModel.get(model) ?? new Map<string, number>();
      const totalRate = [...tenants.values()].reduce((sum, v) => sum + v, 0);
      return {
        model,
        hitRatio: ratio(hitsByModel.get(model), queriesByModel.get(model)),
        totalRate,
        tenants: [...tenants.entries()]
          .map(([tenant, rate]) => ({ tenant, rate, share: totalRate > 0 ? rate / totalRate : 0 }))
          .sort((a, b) => b.rate - a.rate),
      };
    });

  // Stable colour per tenant name across pools.
  const tenantColor = new Map(
    [...new Set(rows.flatMap((r) => r.tenants.map((t) => t.tenant)))]
      .sort((a, b) => a.localeCompare(b))
      .map((name, index) => [name, colorForIndex(index)] as const),
  );

  const error = mix.error ?? queries.error;
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
        {mix.isLoading || queries.isLoading ? "Loading…" : "No model pools with prefix-cache metrics."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <th className="py-2 pr-4 font-medium">Model pool</th>
            <th className="py-2 pr-4 text-right font-medium">Hit ratio</th>
            <th className="py-2 pr-4 text-right font-medium">Tenants</th>
            <th className="py-2 pr-4 text-right font-medium">Requests</th>
            <th className="py-2 font-medium">Tenant mix (client namespace / workload)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.model} className="border-b border-gridline/60 last:border-0 align-top">
              <td className="py-2 pr-4 text-ink">{row.model}</td>
              <td className="tabular py-2 pr-4 text-right text-ink">{formatPercentUnit(row.hitRatio, 1)}</td>
              <td className="tabular py-2 pr-4 text-right text-ink">{row.tenants.length}</td>
              <td className="tabular py-2 pr-4 text-right text-ink">{formatReqps(row.totalRate)}</td>
              <td className="py-2">
                {row.tenants.length === 0 ? (
                  <span className="text-ink-muted">No client traffic observed by Beyla in the window.</span>
                ) : (
                  <div className="space-y-1">
                    <div className="flex h-1.5 w-full max-w-md overflow-hidden rounded-full bg-gridline">
                      {row.tenants.map((t) => (
                        <span
                          key={t.tenant}
                          className="block h-full"
                          style={{ width: `${t.share * 100}%`, backgroundColor: tenantColor.get(t.tenant) }}
                          title={`${t.tenant}: ${formatPercentUnit(t.share, 0)}`}
                        />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                      {row.tenants.map((t) => (
                        <span key={t.tenant} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: tenantColor.get(t.tenant) }}
                            aria-hidden="true"
                          />
                          <span className="font-mono">{t.tenant}</span>
                          <span className="tabular text-ink-muted">{formatPercentUnit(t.share, 0)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sumBy(rows: { labels: Record<string, string>; value: number }[], key: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const k = row.labels[key];
    if (!k) continue;
    out.set(k, (out.get(k) ?? 0) + row.value);
  }
  return out;
}

function tenantName(labels: Record<string, string>): string {
  const ns = labels.client_k8s_namespace_name;
  const client = labels.client ?? "unknown";
  return ns ? `${ns}/${client}` : client;
}
