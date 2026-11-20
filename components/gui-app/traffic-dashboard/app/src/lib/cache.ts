import { CACHE_HIT_WARNING, KV_CAPACITY_PRESSURE, KV_HEADROOM } from "./queries";
import { StatusLevel } from "./theme";

/**
 * Cache-hit diagnosis per engine, following the KCD Token Factory rule of thumb:
 * a low hit ratio means different things depending on KV-cache pressure.
 *
 *  - KV cache saturated or preempting → capacity bottleneck. Blocks are being
 *    evicted before they can be reused; lever is more KV memory (fp8 KV dtype,
 *    more replicas), not prompt work.
 *  - KV cache has headroom → the prefixes simply do not match: a volatile system
 *    prompt (timestamps), template drift, or routing that ignores the cache.
 */
export type CacheVerdict = "healthy" | "capacity" | "prompt-routing" | "degraded" | "idle" | "unsupported";

export interface CacheSignals {
  /** Share of prefix-cache queries that hit, 0..1. */
  hitRatio: number | null;
  /** KV-cache usage, 0..1. */
  kvUsage: number | null;
  preemptionsPerMin: number | null;
  /** Prefix-cache queries per second — below MIN_QUERY_RATE the ratio is noise. */
  queryRate: number | null;
}

/** Below this many cache queries per second a ratio is not worth judging. */
export const MIN_QUERY_RATE = 0.01;

export function cacheVerdict({ hitRatio, kvUsage, preemptionsPerMin, queryRate }: CacheSignals): CacheVerdict {
  if (queryRate === null || queryRate < MIN_QUERY_RATE || hitRatio === null) return "idle";
  if (hitRatio >= CACHE_HIT_WARNING) return "healthy";
  if ((kvUsage !== null && kvUsage >= KV_CAPACITY_PRESSURE) || (preemptionsPerMin !== null && preemptionsPerMin > 0)) {
    return "capacity";
  }
  if (kvUsage !== null && kvUsage <= KV_HEADROOM) return "prompt-routing";
  return "degraded";
}

export const VERDICT_LABEL: Record<CacheVerdict, string> = {
  healthy: "Healthy",
  capacity: "Capacity bottleneck",
  "prompt-routing": "Prompt / routing",
  degraded: "Degraded",
  idle: "No traffic",
  unsupported: "No prefix cache (Neuron)",
};

export const VERDICT_HINT: Record<CacheVerdict, string> = {
  healthy: "Hit ratio above the warning line.",
  capacity: "Low hits while KV cache is saturated or preempting — blocks are evicted before reuse. Lever: KV fp8 dtype, more replicas.",
  "prompt-routing": "Low hits with KV headroom — prefixes are not matching. Check volatile system prompts, template drift, cache-blind routing.",
  degraded: "Low hits with moderate KV pressure — watch for the cliff; split by tenant to find the diluting workload.",
  idle: "Not enough cache queries in the window to judge.",
  unsupported:
    "This engine runs on AWS Neuron (optimum-neuron V0 backend), which does not implement prefix caching; its KV gauge is always 0 and the hit ratio is undefined. Accelerator health is under GPU & Accelerators → AWS Inferentia / Trainium.",
};

export const VERDICT_STATUS: Record<CacheVerdict, StatusLevel | undefined> = {
  healthy: "good",
  capacity: "critical",
  "prompt-routing": "warning",
  degraded: "warning",
  idle: undefined,
  unsupported: undefined,
};

/** Numeric ratio helper: null when the denominator carries no traffic. */
export function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (numerator === undefined || denominator === undefined || denominator <= 0) return null;
  return Math.min(numerator / denominator, 1);
}
