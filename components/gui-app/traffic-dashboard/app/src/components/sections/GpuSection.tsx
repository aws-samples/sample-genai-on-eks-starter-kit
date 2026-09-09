"use client";

import { Card } from "../Card";
import { FilteredEmptyState } from "../FilteredEmptyState";
import { GpuByService } from "../GpuByService";
import { GpuEmptyState } from "../GpuEmptyState";
import { Portlet, PortletGrid } from "../PortletGrid";
import { StatTile, levelFor } from "../StatTile";
import { TimeSeriesChart } from "../TimeSeriesChart";
import { AcceleratorScope } from "@/lib/acceleratorScope";
import { formatBytes, formatCelsius, formatPercent100, formatWatts } from "@/lib/format";
import { GPU_TEMP_CRITICAL_C, GPU_TEMP_WARNING_C, gpuQueries } from "@/lib/queries";
import { useScalar } from "@/lib/useSeries";

/**
 * GPU telemetry from the DCGM exporter. Metric names match the repo's own
 * dcgm-metrics.json Grafana dashboard, so both views agree.
 *
 * Every query here is built from the section filter's label matcher rather than
 * narrowed after the fact: the tiles are Prometheus aggregates that cannot be
 * re-aggregated client-side, and asking for the whole fleet's samples would also
 * spend the charts' eight-series budget on GPUs the operator filtered out.
 */
export function GpuSection({ minutes, scope }: { minutes: number; scope: AcceleratorScope }) {
  const q = gpuQueries(scope.gpuMatcher);
  const maxTemp = useScalar(q.maxTemp);
  const avgUtil = useScalar(q.avgUtil);
  const memoryUsed = useScalar(q.totalMemoryUsedBytes);
  const power = useScalar(q.totalPowerWatts);

  // A filtered view that matched nothing is not a missing exporter, so it must
  // not offer the scale-to-zero explanation.
  const empty = (height: number) =>
    scope.active ? (
      <FilteredEmptyState message="No GPU matches the current filters." height={height} />
    ) : (
      <GpuEmptyState height={height} />
    );

  return (
    <PortletGrid id="gpu">
      <Portlet id="tile-max-temp" span={3} label="Max GPU temp">
        <StatTile
          label="Max GPU temp"
          value={formatCelsius(maxTemp.value)}
          hint={`Hottest die across all GPUs (warning ${GPU_TEMP_WARNING_C}°C, critical ${GPU_TEMP_CRITICAL_C}°C)`}
          status={levelFor(maxTemp.value, { warning: GPU_TEMP_WARNING_C, critical: GPU_TEMP_CRITICAL_C })}
          isLoading={maxTemp.isLoading}
          error={maxTemp.error}
        />
      </Portlet>
      <Portlet id="tile-avg-util" span={3} label="Avg GPU util">
        <StatTile
          label="Avg GPU util"
          value={formatPercent100(avgUtil.value)}
          hint="Mean utilization across every reporting GPU"
          isLoading={avgUtil.isLoading}
          error={avgUtil.error}
        />
      </Portlet>
      <Portlet id="tile-mem" span={3} label="GPU memory used">
        <StatTile
          label="GPU memory used"
          value={formatBytes(memoryUsed.value)}
          hint="Framebuffer in use, summed across GPUs"
          isLoading={memoryUsed.isLoading}
          error={memoryUsed.error}
        />
      </Portlet>
      <Portlet id="tile-power" span={3} label="GPU power draw">
        <StatTile
          label="GPU power draw"
          value={formatWatts(power.value)}
          hint="Instantaneous board power, summed across GPUs"
          isLoading={power.isLoading}
          error={power.error}
        />
      </Portlet>
      <Portlet id="util-by-pod" span={6} label="GPU utilization by pod">
        <Card
          title="GPU utilization by pod"
          subtitle="Utilization summed per pod. Beyond eight pods the remainder folds into 'Other'."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={(v) => formatPercent100(v)}
            unitLabel="percent"
            height={260}
            emptyState={empty(260)}
            queries={[{ expr: q.utilByPod, legend: "{{pod}}" }]}
          />
        </Card>
      </Portlet>

      <Portlet id="temperature" span={6} label="GPU temperature">
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
            emptyState={empty(260)}
            queries={[{ expr: q.tempByGpu, legend: "{{Hostname}}/gpu{{gpu}}" }]}
          />
        </Card>
      </Portlet>
      <Portlet id="by-service" span={12} label="GPU usage by service">
        <Card
          title="GPU usage by service"
          subtitle="Workload names are derived from pod names by stripping ReplicaSet and StatefulSet suffixes, since DCGM labels pods rather than owners. Utilization is summed across each workload's GPUs, so a two-GPU workload can exceed 100%."
        >
          <GpuByService matcher={scope.gpuMatcher} />
        </Card>
      </Portlet>
    </PortletGrid>
  );
}
