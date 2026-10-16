"use client";

import { Card } from "../Card";
import { CategoryBarChart } from "../CategoryBarChart";
import { ContributorsTable } from "../ContributorsTable";
import { TimeSeriesChart } from "../TimeSeriesChart";
import { formatBytes, formatBytesPerSecond, formatShort } from "@/lib/format";
import { AZ_PRICE_PER_GB, NETWORK } from "@/lib/queries";

/**
 * AWS Network Flow Monitor view: where the bytes go, what they cost, and the
 * reliability signals on those paths.
 */
export function NetworkStructure({ minutes }: { minutes: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card
        title="Traffic by category"
        subtitle="Bytes by flow category over the Workload Insights window. inter-az and inter-vpc are the billable categories."
      >
        <CategoryBarChart expr={NETWORK.trafficByCategory} labelKey="category" formatValue={formatBytes} />
      </Card>

      <Card
        title="Top contributors & estimated cost"
        subtitle={`Top 15 flows by bytes. Cost applies $${AZ_PRICE_PER_GB}/GB to billable categories only — an estimate, not billing data.`}
        className="xl:col-span-2"
      >
        <ContributorsTable />
      </Card>

      <Card
        title="AZ traffic by category"
        subtitle="Per-AZ traffic split over time — shows which AZ generates the billable cross-AZ bytes."
      >
        <TimeSeriesChart
          minutes={minutes}
          formatValue={formatBytes}
          unitLabel="bytes"
          queries={[{ expr: NETWORK.azTrafficByCategory, legend: "{{local_az}} · {{category}}" }]}
        />
      </Card>

      {/* Throughput (Bps) and throttling events (events/s) are different units,
          so they are two charts rather than one dual-axis panel. */}
      <Card
        title="Pod throughput"
        subtitle="Per-pod ingress/egress from the Network Flow Monitor agent's open-metrics endpoint."
      >
        <TimeSeriesChart
          minutes={minutes}
          formatValue={formatBytesPerSecond}
          unitLabel="bytes/s"
          queries={[
            { expr: NETWORK.podEgress, legend: "egress {{exported_namespace}}/{{exported_pod}}" },
            { expr: NETWORK.podIngress, legend: "ingress {{exported_namespace}}/{{exported_pod}}" },
          ]}
        />
      </Card>

      <Card
        title="ENA allowance exceeded"
        subtitle="Bandwidth, pps and conntrack throttling events per second, by node. Any sustained value means the instance is hitting a network limit."
      >
        <TimeSeriesChart
          minutes={minutes}
          formatValue={formatShort}
          unitLabel="events/s"
          queries={[{ expr: NETWORK.enaAllowanceExceeded, legend: "{{node}}" }]}
        />
      </Card>

      <Card
        title="Error signals — retransmissions & timeouts"
        subtitle="Network error counters per flow category from Workload Insights."
        className="xl:col-span-3"
      >
        <TimeSeriesChart
          minutes={minutes}
          formatValue={formatShort}
          unitLabel="count"
          height={220}
          queries={[
            { expr: NETWORK.retransmissions, legend: "retransmissions · {{category}}" },
            { expr: NETWORK.timeouts, legend: "timeouts · {{category}}" },
          ]}
        />
      </Card>
    </div>
  );
}
