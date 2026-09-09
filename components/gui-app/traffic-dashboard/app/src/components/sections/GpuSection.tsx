"use client";

import { Card } from "../Card";
import { GpuByService } from "../GpuByService";
import { GpuEmptyState } from "../GpuEmptyState";
import { StatTile, levelFor } from "../StatTile";
import { TimeSeriesChart } from "../TimeSeriesChart";
import { formatBytes, formatCelsius, formatPercent100, formatWatts } from "@/lib/format";
import { GPU, GPU_TEMP_CRITICAL_C, GPU_TEMP_WARNING_C } from "@/lib/queries";
import { useScalar } from "@/lib/useSeries";

/**
 * GPU telemetry from the DCGM exporter. Metric names match the repo's own
 * dcgm-metrics.json Grafana dashboard, so both views agree.
 */
export function GpuSection({ minutes }: { minutes: number }) {
  const maxTemp = useScalar(GPU.maxTemp);
  const avgUtil = useScalar(GPU.avgUtil);
  const memoryUsed = useScalar(GPU.totalMemoryUsedBytes);
  const power = useScalar(GPU.totalPowerWatts);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Max GPU temp"
          value={formatCelsius(maxTemp.value)}
          hint={`Hottest die across all GPUs (warning ${GPU_TEMP_WARNING_C}°C, critical ${GPU_TEMP_CRITICAL_C}°C)`}
          status={levelFor(maxTemp.value, { warning: GPU_TEMP_WARNING_C, critical: GPU_TEMP_CRITICAL_C })}
          isLoading={maxTemp.isLoading}
          error={maxTemp.error}
        />
        <StatTile
          label="Avg GPU util"
          value={formatPercent100(avgUtil.value)}
          hint="Mean utilization across every reporting GPU"
          isLoading={avgUtil.isLoading}
          error={avgUtil.error}
        />
        <StatTile
          label="GPU memory used"
          value={formatBytes(memoryUsed.value)}
          hint="Framebuffer in use, summed across GPUs"
          isLoading={memoryUsed.isLoading}
          error={memoryUsed.error}
        />
        <StatTile
          label="GPU power draw"
          value={formatWatts(power.value)}
          hint="Instantaneous board power, summed across GPUs"
          isLoading={power.isLoading}
          error={power.error}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title="GPU utilization by pod"
          subtitle="Utilization summed per pod. Beyond eight pods the remainder folds into 'Other'."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(v) => formatPercent100(v)}
            unitLabel="percent"
            height={260}
            emptyState={<GpuEmptyState height={260} />}
            queries={[{ expr: GPU.utilByPod, legend: "{{pod}}" }]}
          />
        </Card>

        <Card
          title="GPU temperature"
          subtitle={`Die temperature per GPU, with the ${GPU_TEMP_CRITICAL_C}°C throttling threshold marked.`}
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={formatCelsius}
            unitLabel="°C"
            height={260}
            threshold={{ value: GPU_TEMP_CRITICAL_C, label: `${GPU_TEMP_CRITICAL_C}°C throttle` }}
            emptyState={<GpuEmptyState height={260} />}
            queries={[{ expr: GPU.tempByGpu, legend: "{{Hostname}}/gpu{{gpu}}" }]}
          />
        </Card>
      </div>

      <Card
        title="GPU usage by service"
        subtitle="Workload names are derived from pod names by stripping ReplicaSet and StatefulSet suffixes, since DCGM labels pods rather than owners. Utilization is summed across each workload's GPUs, so a two-GPU workload can exceed 100%."
      >
        <GpuByService />
      </Card>
    </div>
  );
}
