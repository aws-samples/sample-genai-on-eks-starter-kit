"use client";

import { Card } from "../Card";
import { NeuronEmptyState } from "../NeuronEmptyState";
import { NeuronNodeTable } from "../NeuronNodeTable";
import { StatTile, levelFor } from "../StatTile";
import { TimeSeriesChart } from "../TimeSeriesChart";
import { formatBytes, formatPercentUnit, formatSeconds, formatShort } from "@/lib/format";
import { NEURON, NEURON_UTIL_IDLE } from "@/lib/queries";
import { useScalar } from "@/lib/useSeries";

/**
 * AWS Neuron (Inferentia / Trainium) telemetry from the neuron-monitor
 * DaemonSet — the Neuron tab of the GPU & Accelerators section. The vLLM
 * panels above cannot tell Neuron from NVIDIA; this and the GPU tab can.
 */
export function NeuronSection({ minutes }: { minutes: number }) {
  const avgUtil = useScalar(NEURON.avgCoreUtil);
  const coresActive = useScalar(NEURON.coresActive);
  const coresCapacity = useScalar(NEURON.coresCapacity);
  const coresRequested = useScalar(NEURON.coresRequested);
  const deviceMemory = useScalar(NEURON.deviceMemoryUsedBytes);
  const execP99 = useScalar(NEURON.execLatencyP99);
  const execErrors = useScalar(NEURON.execErrorsPerMin);

  const cores = `${formatShort(coresActive.value ?? 0, 0)} / ${coresCapacity.value === null ? "—" : formatShort(coresCapacity.value, 0)}`;
  // Allocated-but-idle: cores are requested by pods while the average
  // utilisation is near zero — the accelerator is billed and not computing.
  const stranded =
    (coresRequested.value ?? 0) > 0 && avgUtil.value !== null && avgUtil.value < NEURON_UTIL_IDLE ? "warning" : undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Avg NeuronCore util"
          value={formatPercentUnit(avgUtil.value, 1)}
          hint={stranded ? "Cores allocated to pods but idle — check upstream traffic, model load, I/O" : "Mean across every core with a runtime attached"}
          status={stranded ?? levelFor(avgUtil.value, { warning: 0.85, critical: 0.95 })}
          isLoading={avgUtil.isLoading}
          error={avgUtil.error}
        />
        <StatTile
          label="NeuronCores active / capacity"
          value={cores}
          hint={`Cores with a runtime vs. cores on Neuron nodes · ${formatShort(coresRequested.value ?? 0, 0)} requested by pods`}
          isLoading={coresActive.isLoading || coresCapacity.isLoading}
          error={coresActive.error ?? coresCapacity.error}
        />
        <StatTile
          label="Device memory in use"
          value={formatBytes(deviceMemory.value)}
          hint="Neuron device HBM held by runtimes (weights, KV tensors, scratchpad)"
          isLoading={deviceMemory.isLoading}
          error={deviceMemory.error}
        />
        <StatTile
          label="Execution p99"
          value={formatSeconds(execP99.value)}
          hint={`Slowest runtime's p99 per NEFF execution · errors ${formatShort(execErrors.value ?? 0)} /min`}
          status={(execErrors.value ?? 0) > 0 ? "critical" : undefined}
          isLoading={execP99.isLoading}
          error={execP99.error}
        />
      </div>

      <Card
        title="Per-node Neuron usage"
        subtitle="One row per Inferentia / Trainium node with the model pod scheduled on it. The state column separates a serving accelerator from one that is allocated (and billed) but idle."
      >
        <NeuronNodeTable />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title="NeuronCore utilization"
          subtitle="Per node and core. Tensor-parallel engines drive all their cores together; one core lagging the others is a placement or sharding problem."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(v) => formatPercentUnit(v, 0)}
            unitLabel="utilization"
            height={260}
            emptyState={<NeuronEmptyState height={260} />}
            queries={[{ expr: NEURON.coreUtilByNodeCore, legend: "{{node}} · core {{neuroncore}}" }]}
          />
        </Card>

        <Card
          title="Execution latency"
          subtitle="p50 and p99 per NEFF execution, per node. Fixed-shape Neuron graphs keep p50 flat; a rising p99 with flat utilization points at host-side stalls (input pipeline, I/O), not the accelerator."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={formatSeconds}
            unitLabel="seconds"
            height={260}
            emptyState={<NeuronEmptyState height={260} />}
            queries={[{ expr: NEURON.execLatencyByNode, legend: "{{node}} {{percentile}}" }]}
          />
        </Card>

        <Card
          title="Runtime memory by location"
          subtitle="Bytes held by Neuron runtimes on the device (HBM) versus in host RAM, per node."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(v) => formatBytes(v)}
            unitLabel="bytes"
            height={260}
            emptyState={<NeuronEmptyState height={260} />}
            queries={[{ expr: NEURON.runtimeMemoryByNode, legend: "{{node}} {{memory_location}}" }]}
          />
        </Card>

        <Card
          title="Device memory by kind"
          subtitle="What the HBM is spent on: model tensors (weights + KV), model code, constants, shared scratchpad and runtime bookkeeping."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(v) => formatBytes(v)}
            unitLabel="bytes"
            height={260}
            emptyState={<NeuronEmptyState height={260} />}
            queries={[{ expr: NEURON.coreMemoryByKind, legend: "{{node}} {{kind}}" }]}
          />
        </Card>
      </div>
    </div>
  );
}
