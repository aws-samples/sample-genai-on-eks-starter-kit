"use client";

import { Card } from "../Card";
import { Portlet, PortletGrid } from "../PortletGrid";
import { FilteredEmptyState } from "../FilteredEmptyState";
import { NeuronEmptyState } from "../NeuronEmptyState";
import { NeuronNodeTable } from "../NeuronNodeTable";
import { StatTile, levelFor } from "../StatTile";
import { TimeSeriesChart } from "../TimeSeriesChart";
import { AcceleratorScope } from "@/lib/acceleratorScope";
import { formatBytes, formatPercentUnit, formatSeconds, formatShort } from "@/lib/format";
import { NEURON_UTIL_IDLE, neuronQueries } from "@/lib/queries";
import { useScalar } from "@/lib/useSeries";

/**
 * AWS Neuron (Inferentia / Trainium) telemetry from the neuron-monitor
 * DaemonSet — the Neuron tab of the GPU & Accelerators section. The vLLM
 * panels above cannot tell Neuron from NVIDIA; this and the GPU tab can.
 *
 * The section filter arrives as a `node` matcher rather than as a row predicate:
 * neuron-monitor reports per node and per runtime process, so a namespace,
 * service or tenant selection is resolved to the nodes behind it upstream in
 * lib/acceleratorScope.ts and applied to every query here.
 */
export function NeuronSection({ minutes, scope }: { minutes: number; scope: AcceleratorScope }) {
  const q = neuronQueries(scope.neuronMatcher);
  const avgUtil = useScalar(q.avgCoreUtil);
  const coresActive = useScalar(q.coresActive);
  const coresCapacity = useScalar(q.coresCapacity);
  const coresRequested = useScalar(q.coresRequested);
  const deviceMemory = useScalar(q.deviceMemoryUsedBytes);
  const execP99 = useScalar(q.execLatencyP99);
  const execErrors = useScalar(q.execErrorsPerMin);

  const cores = `${formatShort(coresActive.value ?? 0, 0)} / ${coresCapacity.value === null ? "—" : formatShort(coresCapacity.value, 0)}`;
  // Allocated-but-idle: cores are requested by pods while the average
  // utilisation is near zero — the accelerator is billed and not computing.
  const stranded =
    (coresRequested.value ?? 0) > 0 && avgUtil.value !== null && avgUtil.value < NEURON_UTIL_IDLE ? "warning" : undefined;

  // A filtered view that matched nothing is not a missing DaemonSet, so it must
  // not send anyone off to install one.
  const empty = (height: number) =>
    scope.active ? (
      <FilteredEmptyState message="No Neuron node matches the current filters." height={height} />
    ) : (
      <NeuronEmptyState height={height} />
    );

  return (
    <PortletGrid id="neuron">
      <Portlet id="tile-avg-util" span={3} label="Avg NeuronCore util">
        <StatTile
          label="Avg NeuronCore util"
          value={formatPercentUnit(avgUtil.value, 1)}
          hint={stranded ? "Cores allocated to pods but idle — check upstream traffic, model load, I/O" : "Mean across every core with a runtime attached"}
          status={stranded ?? levelFor(avgUtil.value, { warning: 0.85, critical: 0.95 })}
          isLoading={avgUtil.isLoading}
          error={avgUtil.error}
        />
      </Portlet>
      <Portlet id="tile-cores" span={3} label="NeuronCores active / capacity">
        <StatTile
          label="NeuronCores active / capacity"
          value={cores}
          hint={`Cores with a runtime vs. cores on Neuron nodes · ${formatShort(coresRequested.value ?? 0, 0)} requested by pods`}
          isLoading={coresActive.isLoading || coresCapacity.isLoading}
          error={coresActive.error ?? coresCapacity.error}
        />
      </Portlet>
      <Portlet id="tile-device-mem" span={3} label="Device memory in use">
        <StatTile
          label="Device memory in use"
          value={formatBytes(deviceMemory.value)}
          hint="Neuron device HBM held by runtimes (weights, KV tensors, scratchpad)"
          isLoading={deviceMemory.isLoading}
          error={deviceMemory.error}
        />
      </Portlet>
      <Portlet id="tile-exec-p99" span={3} label="Execution p99">
        <StatTile
          label="Execution p99"
          value={formatSeconds(execP99.value)}
          hint={`Slowest runtime's p99 per NEFF execution · errors ${formatShort(execErrors.value ?? 0)} /min`}
          status={(execErrors.value ?? 0) > 0 ? "critical" : undefined}
          isLoading={execP99.isLoading}
          error={execP99.error}
        />
      </Portlet>
      <Portlet id="per-node" span={12} label="Per-node Neuron usage">
        <Card
          title="Per-node Neuron usage"
          subtitle="One row per Inferentia / Trainium node with the model pod scheduled on it. The state column separates a serving accelerator from one that is allocated (and billed) but idle."
        >
          <NeuronNodeTable matcher={scope.neuronMatcher} />
        </Card>
      </Portlet>

      <Portlet id="core-util" span={6} label="NeuronCore utilization">
        <Card
          title="NeuronCore utilization"
          subtitle="Per node and core. Tensor-parallel engines drive all their cores together; one core lagging the others is a placement or sharding problem."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(v) => formatPercentUnit(v, 0)}
            unitLabel="utilization"
            height={260}
            emptyState={empty(260)}
            queries={[{ expr: q.coreUtilByNodeCore, legend: "{{node}} · core {{neuroncore}}" }]}
          />
        </Card>
      </Portlet>

      <Portlet id="exec-latency" span={6} label="Execution latency">
        <Card
          title="Execution latency"
          subtitle="p50 and p99 per NEFF execution, per node. Fixed-shape Neuron graphs keep p50 flat; a rising p99 with flat utilization points at host-side stalls (input pipeline, I/O), not the accelerator."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={formatSeconds}
            unitLabel="seconds"
            height={260}
            emptyState={empty(260)}
            queries={[{ expr: q.execLatencyByNode, legend: "{{node}} {{percentile}}" }]}
          />
        </Card>
      </Portlet>

      <Portlet id="runtime-memory" span={6} label="Runtime memory by location">
        <Card
          title="Runtime memory by location"
          subtitle="Bytes held by Neuron runtimes on the device (HBM) versus in host RAM, per node."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(v) => formatBytes(v)}
            unitLabel="bytes"
            height={260}
            emptyState={empty(260)}
            queries={[{ expr: q.runtimeMemoryByNode, legend: "{{node}} {{memory_location}}" }]}
          />
        </Card>
      </Portlet>

      <Portlet id="device-memory" span={6} label="Device memory by kind">
        <Card
          title="Device memory by kind"
          subtitle="What the HBM is spent on: model tensors (weights + KV), model code, constants, shared scratchpad and runtime bookkeeping."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(v) => formatBytes(v)}
            unitLabel="bytes"
            height={260}
            emptyState={empty(260)}
            queries={[{ expr: q.coreMemoryByKind, legend: "{{node}} {{kind}}" }]}
          />
        </Card>
      </Portlet>
    </PortletGrid>
  );
}
