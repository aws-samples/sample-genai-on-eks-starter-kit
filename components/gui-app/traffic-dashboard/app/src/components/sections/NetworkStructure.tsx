"use client";

import { Card } from "../Card";
import { CategoryBarChart } from "../CategoryBarChart";
import { ContributorsTable } from "../ContributorsTable";
import { Portlet, PortletGrid } from "../PortletGrid";
import { TimeSeriesChart } from "../TimeSeriesChart";
import { formatBytes, formatBytesPerSecond, formatShort } from "@/lib/format";
import { AZ_PRICE_PER_GB, NETWORK } from "@/lib/queries";

/**
 * AWS Network Flow Monitor view: where the bytes go, what they cost, and the
 * reliability signals on those paths.
 */
export function NetworkStructure({ minutes }: { minutes: number }) {
  return (
    <PortletGrid id="network">
      <Portlet id="by-category" span={4} label="Traffic by category">
        <Card
          title="Traffic by category"
          subtitle="Bytes by flow category over the Workload Insights window. inter-az and inter-vpc are the billable categories."
        >
          <CategoryBarChart expr={NETWORK.trafficByCategory} labelKey="category" formatValue={formatBytes} />
        </Card>
      </Portlet>

      <Portlet id="contributors" span={8} label="Top contributors & estimated cost">
        <Card
          title="Top contributors & estimated cost"
          subtitle={`Top 15 flows by bytes. Cost applies $${AZ_PRICE_PER_GB}/GB to billable categories only — an estimate, not billing data.`}
        >
          <ContributorsTable />
        </Card>
      </Portlet>

      <Portlet id="az-traffic" span={4} label="AZ traffic by category">
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
      </Portlet>

      {/* Throughput (Bps) and throttling events (events/s) are different units,
          so they are two charts rather than one dual-axis panel. */}
      <Portlet id="pod-throughput" span={4} label="Pod throughput">
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
      </Portlet>

      <Portlet id="ena" span={4} label="ENA allowance exceeded">
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
      </Portlet>

      <Portlet id="errors" span={12} label="Error signals">
        <Card
          title="Error signals — retransmissions & timeouts"
          subtitle="Network error counters per flow category from Workload Insights."
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
      </Portlet>
    </PortletGrid>
  );
}
