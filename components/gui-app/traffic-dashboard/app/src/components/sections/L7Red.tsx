"use client";

import { Card } from "../Card";
import { Portlet, PortletGrid } from "../PortletGrid";
import { TimeSeriesChart } from "../TimeSeriesChart";
import { formatReqps, formatSeconds } from "@/lib/format";
import { L7 } from "@/lib/queries";

/**
 * RED metrics from Beyla's eBPF instrumentation. Comparing these HTTP-level
 * percentiles against the in-engine vLLM TTFT isolates network from engine
 * latency.
 */
export function L7Red({ minutes }: { minutes: number }) {
  return (
    <PortletGrid id="l7">
      <Portlet id="duration" span={6} label="Request duration percentiles">
        <Card
          title="Request duration percentiles"
          subtitle="p50/p95/p99 HTTP server duration per service, from Beyla eBPF RED metrics."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={formatSeconds}
            unitLabel="seconds"
            height={260}
            queries={[
              { expr: L7.durationP50, legend: "p50 {{service_name}}" },
              { expr: L7.durationP95, legend: "p95 {{service_name}}" },
              { expr: L7.durationP99, legend: "p99 {{service_name}}" },
            ]}
          />
        </Card>
      </Portlet>

      <Portlet id="rate" span={6} label="Request rate & 5xx errors">
        <Card
          title="Request rate & 5xx errors"
          subtitle="Throughput and server-error rate per service. Both are requests/second, so they share one axis."
        >
          <TimeSeriesChart
            minutes={minutes}
            formatValue={formatReqps}
            unitLabel="req/s"
            height={260}
            queries={[
              { expr: L7.requestRate, legend: "req/s {{service_name}}" },
              { expr: L7.errorRate, legend: "5xx/s {{service_name}}" },
            ]}
          />
        </Card>
      </Portlet>
    </PortletGrid>
  );
}
