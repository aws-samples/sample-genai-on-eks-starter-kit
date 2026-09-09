"use client";

import { useMemo } from "react";
import { ACCEL_PODS } from "./queries";
import { useInstantVector } from "./useSeries";

/**
 * Tenant attribution for accelerator rows. Neither DCGM nor vLLM knows who a
 * request belonged to; the gateway does. LiteLLM counts every request under
 * the virtual key's team alias and the model it was routed to (`vllm/<pool>`),
 * so a model pool — and through it every engine pod serving that pool — maps
 * to the set of teams with a key on it. A pod that is not a vLLM engine (a
 * video model, a training job) has no tenants.
 */
export interface TenantsByModel {
  byModel: Map<string, string[]>;
  /** Every tenant seen, sorted — the option list of the tenant filter. */
  all: string[];
  isLoading: boolean;
  error: Error | undefined;
}

export function useTenantsByModel(): TenantsByModel {
  const rows = useInstantVector(ACCEL_PODS.tenantsByModel);
  return useMemo(() => {
    const byModel = new Map<string, Set<string>>();
    const all = new Set<string>();
    for (const row of rows.rows) {
      const team = row.labels.team_alias;
      const model = row.labels.requested_model?.replace(/^vllm\//, "");
      if (!team || team === "None" || !model) continue;
      all.add(team);
      let set = byModel.get(model);
      if (!set) {
        set = new Set();
        byModel.set(model, set);
      }
      set.add(team);
    }
    return {
      byModel: new Map([...byModel].map(([m, set]) => [m, [...set].sort()])),
      all: [...all].sort(),
      isLoading: rows.isLoading,
      error: rows.error,
    };
  }, [rows.rows, rows.isLoading, rows.error]);
}
