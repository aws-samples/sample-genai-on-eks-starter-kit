"use client";

import { Card } from "../Card";
import { CachePodTable } from "../CachePodTable";
import { CacheTenantMix } from "../CacheTenantMix";
import { CacheTenantTable } from "../CacheTenantTable";
import { StatTile, levelFor } from "../StatTile";
import { TimeSeriesChart } from "../TimeSeriesChart";
import { formatPercentUnit, formatSeconds, formatShort } from "@/lib/format";
import { CACHE, CACHE_HIT_CRITICAL, CACHE_HIT_WARNING, KV_CAPACITY_PRESSURE, KV_HEADROOM } from "@/lib/queries";
import { STATUS } from "@/lib/theme";
import { useScalar } from "@/lib/useSeries";

/**
 * Prefix-cache hit ratio as an SLI (KCD Token Factory, S7 "cache-hit cliff").
 *
 * The headline number is deliberately not the point: the cliff shows up first
 * in one node, one pool, one tenant or one template version while the average
 * still looks fine, so the section is built around the splits — worker node
 * and pool from vLLM, tenant and template from the LiteLLM gateway — and pairs
 * each low ratio with KV pressure so the reader can tell a capacity bottleneck
 * (evictions) from a prompt/routing problem (prefixes not matching). The
 * consequence side (TTFT, prefill tokens actually computed) sits next to the
 * cause side so "hits went down" and "users got slower" are one glance apart.
 */
export function CacheHitRate({ minutes }: { minutes: number }) {
  const hitRatio = useScalar(CACHE.hitRatio);
  const cachedTokens = useScalar(CACHE.cachedTokenShare);
  const kvMax = useScalar(CACHE.kvUsageMax);
  const preemptions = useScalar(CACHE.preemptionsPerMin);

  const cliff = { value: CACHE_HIT_WARNING, label: "cliff watch", color: STATUS.warning };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Prefix-cache hit ratio"
          value={formatPercentUnit(hitRatio.value, 1)}
          hint="Cache queries that hit, all vLLM engines (5m)"
          status={levelFor(hitRatio.value, { warning: CACHE_HIT_WARNING, critical: CACHE_HIT_CRITICAL }, "higher-is-better")}
          isLoading={hitRatio.isLoading}
          error={hitRatio.error}
        />
        <StatTile
          label="Cached prompt tokens"
          value={formatPercentUnit(cachedTokens.value, 1)}
          hint="Share of prompt tokens whose prefill was skipped"
          status={levelFor(cachedTokens.value, { warning: CACHE_HIT_WARNING, critical: CACHE_HIT_CRITICAL }, "higher-is-better")}
          isLoading={cachedTokens.isLoading}
          error={cachedTokens.error}
        />
        <StatTile
          label="KV-cache usage (max)"
          value={formatPercentUnit(kvMax.value, 1)}
          hint={`Above ${Math.round(KV_CAPACITY_PRESSURE * 100)}% a low hit ratio is a capacity problem`}
          status={levelFor(kvMax.value, { warning: KV_HEADROOM, critical: KV_CAPACITY_PRESSURE })}
          isLoading={kvMax.isLoading}
          error={kvMax.error}
        />
        <StatTile
          label="Preemptions / min"
          value={formatShort(preemptions.value)}
          hint="Requests evicted from KV cache and recomputed"
          status={levelFor(preemptions.value, { warning: 0.01, critical: 1 })}
          isLoading={preemptions.isLoading}
          error={preemptions.error}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          title="Hit ratio by worker node"
          subtitle="KV cache is node-local: a node that drops while others hold steady is a routing or placement problem, not a model problem."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(value) => formatPercentUnit(value, 0)}
            unitLabel="hit ratio"
            threshold={cliff}
            queries={[{ expr: CACHE.hitRatioByNode, legend: "{{node}} · {{model_name}}" }]}
          />
        </Card>

        <Card
          title="Hit ratio by model pool"
          subtitle="Query-weighted hits versus token-weighted cached share. A gap between the two means hits are landing on short prefixes."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(value) => formatPercentUnit(value, 0)}
            unitLabel="ratio"
            threshold={cliff}
            queries={[
              { expr: CACHE.hitRatioByModel, legend: "hits {{model_name}}" },
              { expr: CACHE.cachedTokenShareByModel, legend: "tokens {{model_name}}" },
            ]}
          />
        </Card>

        <Card
          title="TTFT p95 by model pool"
          subtitle="What a miss costs the user. A step up here that lines up with a drop in the hit ratio is the cliff; a step up with a flat ratio is queueing or capacity."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={formatSeconds}
            unitLabel="seconds"
            queries={[{ expr: CACHE.ttftP95ByModel, legend: "{{model_name}}" }]}
          />
        </Card>

        <Card
          title="Prefill tokens per request"
          subtitle="Prompt tokens sent versus tokens prefill actually computed. The distance between the two lines is the work the cache removed."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={formatShort}
            unitLabel="tokens / request"
            queries={[
              { expr: CACHE.promptTokensPerRequest, legend: "prompt {{model_name}}" },
              { expr: CACHE.prefillComputedPerRequest, legend: "computed {{model_name}}" },
            ]}
          />
        </Card>

        <Card
          title="Prefill tokens by source"
          subtitle="Where prompt tokens come from: local cache hit (prefill skipped), external KV transfer (disaggregated), or local compute."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={formatShort}
            unitLabel="tokens/s"
            queries={[{ expr: CACHE.promptTokensBySource, legend: "{{source}} {{model_name}}" }]}
          />
        </Card>

        <Card
          title="Cached prompt-token share by tenant"
          subtitle="Per LiteLLM team / key, from the backend's cached_tokens usage field. Tenants with unrelated prefixes sharing a pool evict each other's blocks — this is where the cliff is first attributable."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(value) => formatPercentUnit(value, 0)}
            unitLabel="cached share"
            threshold={cliff}
            queries={[{ expr: CACHE.tenantCachedShare, legend: "{{team_alias}} / {{api_key_alias}}" }]}
          />
        </Card>

        <Card
          title="Cached share by prompt template version"
          subtitle="A template change is a cache-invalidation event: the new version starts at zero while the old one still reads high. Requests tag themselves via metadata.prompt_template_version."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(value) => formatPercentUnit(value, 0)}
            unitLabel="cached share"
            threshold={cliff}
            queries={[{ expr: CACHE.templateCachedShare, legend: "{{metadata_prompt_template}} {{metadata_prompt_template_version}}" }]}
          />
        </Card>

        <Card
          title="Tenant × template × pool"
          subtitle="One row per LiteLLM key, end user, prompt template version and requested model pool. Sorted worst first."
          className="xl:col-span-2"
        >
          <CacheTenantTable />
        </Card>

        <Card
          title="Per-engine diagnosis"
          subtitle="Hit ratio paired with KV pressure, preemptions, queue depth, TTFT and engine age per vLLM pod. Verdict: capacity bottleneck (saturated KV, evictions) vs prompt/routing (headroom but no matches). The accelerator column comes from DCGM / neuron-monitor — vLLM reports GPU-named gauges on Inferentia too, and Neuron engines have no prefix cache."
          className="xl:col-span-3"
        >
          <CachePodTable />
        </Card>

        <Card
          title="Callers per model pool (all paths)"
          subtitle="From the Beyla service graph, so it also covers traffic that bypasses LiteLLM (kgateway, Kong, direct). Use it to explain a pool's hit ratio when the tenant table only shows part of the load."
          className="xl:col-span-3"
        >
          <CacheTenantMix />
        </Card>
      </div>
    </div>
  );
}
