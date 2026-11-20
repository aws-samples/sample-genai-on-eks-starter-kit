"use client";

import { useEffect, useMemo, useState } from "react";
import { AcceleratorFilterBar } from "../AcceleratorFilterBar";
import { AcceleratorFleetTable, useAcceleratorFleet } from "../AcceleratorFleetTable";
import { AcceleratorPodTable } from "../AcceleratorPodTable";
import { Card } from "../Card";
import { EnginesGrouping, EnginesGroupingToggle, EnginesTable } from "../EnginesTable";
import { GpuSection } from "./GpuSection";
import { NeuronSection } from "./NeuronSection";
import { ACCELERATOR_KIND_LABEL, ACCELERATOR_UNIT, AcceleratorKind } from "@/lib/accelerator";
import { AcceleratorFilter, EMPTY_FILTER } from "@/lib/acceleratorFilter";
import { useAcceleratorPods } from "@/lib/acceleratorPods";
import { formatShort } from "@/lib/format";
import { useTenantsByModel } from "@/lib/tenants";

const KINDS: AcceleratorKind[] = ["gpu", "neuron"];

/**
 * One section for every accelerator in the cluster. Top to bottom: the fleet
 * table (NVIDIA and Neuron on the same columns), a filter bar, the serving
 * signals per model pool / engine pod, every accelerator-holding pod, and then
 * the per-family detail panels (DCGM or neuron-monitor) picked by the
 * segmented control. The default detail tab is the first family that is
 * actually reporting, so a Neuron-only cluster does not open on an empty GPU
 * panel.
 */
export function AcceleratorSection({ minutes }: { minutes: number }) {
  const fleet = useAcceleratorFleet();
  const pods = useAcceleratorPods();
  const tenants = useTenantsByModel();
  const [picked, setPicked] = useState<AcceleratorKind | null>(null);
  const [grouping, setGrouping] = useState<EnginesGrouping>("model");
  const [filter, setFilter] = useState<AcceleratorFilter>(EMPTY_FILTER);

  const devicesByKind = useMemo(() => {
    const totals: Record<AcceleratorKind, number> = { gpu: 0, neuron: 0 };
    for (const row of fleet.rows) totals[row.kind] += row.devicesActive;
    return totals;
  }, [fleet.rows]);

  // Dropdown options come from the pods themselves, so the lists never offer a
  // value that would filter everything away.
  const filterOptions = useMemo(
    () => ({
      namespaces: [...new Set(pods.rows.map((r) => r.namespace))].sort(),
      services: [...new Set(pods.rows.map((r) => r.service))].sort(),
      tenants: tenants.all,
    }),
    [pods.rows, tenants.all],
  );

  const fallback: AcceleratorKind = devicesByKind.gpu === 0 && devicesByKind.neuron > 0 ? "neuron" : "gpu";
  const selected = picked ?? fallback;

  // Once the user has chosen, keep it; before that follow whatever is reporting.
  useEffect(() => {
    if (picked === null) return;
    if (devicesByKind[picked] === 0 && devicesByKind[fallback] > 0) setPicked(null);
  }, [picked, fallback, devicesByKind]);

  return (
    <div className="space-y-4">
      <Card
        title="Accelerator fleet by type"
        subtitle="Every accelerator family the exporters can see, on the same columns. Devices = what the exporter reports vs. what the nodes advertise to the scheduler; Allocated = devices pods have claimed. A row that is allocated but idle is billed capacity doing nothing — click it for the per-node view."
        action={
          <div className="flex shrink-0 rounded-lg bg-surface-raised/60 p-0.5" role="tablist" aria-label="Accelerator type">
            {KINDS.map((kind) => {
              const count = devicesByKind[kind];
              const active = kind === selected;
              return (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPicked(kind)}
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    active ? "bg-surface-raised font-medium text-ink" : "text-ink-secondary hover:text-ink"
                  }`}
                >
                  {ACCELERATOR_KIND_LABEL[kind]}
                  <span className={`tabular ml-1.5 ${active ? "text-ink-secondary" : "text-ink-muted"}`}>
                    {formatShort(count, 0)} {count === 1 ? ACCELERATOR_UNIT[kind].singular : ACCELERATOR_UNIT[kind].plural}
                  </span>
                </button>
              );
            })}
          </div>
        }
      >
        <AcceleratorFleetTable rows={fleet.rows} isLoading={fleet.isLoading} error={fleet.error} selected={selected} onSelect={setPicked} />
      </Card>

      <AcceleratorFilterBar value={filter} onChange={setFilter} options={filterOptions} />

      <Card
        title="Per model & per pod"
        subtitle="The serving signals per model pool and per vLLM engine pod — accelerator utilisation and memory, KV cache, prefix hit, queue and throughput — so a fleet average never hides a pinned or idle engine. NVIDIA columns join DCGM on the pod; Neuron columns join neuron-monitor through the pod's node. Tenants are the LiteLLM teams routed to each pool."
        action={<EnginesGroupingToggle value={grouping} onChange={setGrouping} />}
      >
        <EnginesTable grouping={grouping} filter={filter} />
      </Card>

      <Card
        title="Per-pod accelerator usage"
        subtitle="Every pod holding an accelerator, NVIDIA GPU or AWS Neuron, on the same columns. GPU rows are one per physical GPU with that GPU's own memory, power and temperature (DCGM). Neuron rows are one per pod with the cores it requested; utilisation and memory are the node's, marked * when other Neuron pods share the node. Sorted by utilization."
      >
        <AcceleratorPodTable filter={filter} />
      </Card>

      <div className="flex items-center gap-3 text-xs text-ink-muted">
        <span className="h-px flex-1 bg-gridline" aria-hidden="true" />
        <span>
          {ACCELERATOR_KIND_LABEL[selected]} detail ·{" "}
          {selected === "gpu" ? "DCGM exporter (NVIDIA GPU Operator)" : "neuron-monitor DaemonSet"}
        </span>
        <span className="h-px flex-1 bg-gridline" aria-hidden="true" />
      </div>

      {selected === "gpu" ? <GpuSection minutes={minutes} /> : <NeuronSection minutes={minutes} />}
    </div>
  );
}
