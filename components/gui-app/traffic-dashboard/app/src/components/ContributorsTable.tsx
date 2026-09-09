"use client";

import { formatBytes, formatUsd, prettifyCategory } from "@/lib/format";
import { NETWORK } from "@/lib/queries";
import { useInstantVector } from "@/lib/useSeries";

/**
 * Top NFM flow contributors with estimated transfer cost — the table panel from
 * the Grafana dashboard. The two instant queries are joined on the same label
 * tuple Grafana joins on (local_az / local_subnet / remote_id / category);
 * intra-AZ rows have no billable cost and show "—".
 */
export function ContributorsTable() {
  const bytes = useInstantVector(NETWORK.topContributorsBytes);
  const cost = useInstantVector(NETWORK.topContributorsCost);

  const costByKey = new Map(cost.rows.map((row) => [joinKey(row.labels), row.value]));

  if (bytes.error) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        <span className="text-status-serious">▲</span> Query failed — {bytes.error.message}
      </p>
    );
  }
  if (bytes.rows.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        {bytes.isLoading
          ? "Loading…"
          : "No Workload Insights contributors reported. Install the Network Flow Monitor component to populate this table."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <th className="py-2 pr-4 font-medium">Source AZ</th>
            <th className="py-2 pr-4 font-medium">Subnet</th>
            <th className="py-2 pr-4 font-medium">Remote</th>
            <th className="py-2 pr-4 font-medium">Category</th>
            <th className="py-2 pr-4 text-right font-medium">Bytes</th>
            <th className="py-2 text-right font-medium">Est. cost (window)</th>
          </tr>
        </thead>
        <tbody>
          {bytes.rows.map((row) => {
            const key = joinKey(row.labels);
            const estimated = costByKey.get(key);
            return (
              <tr key={key} className="border-b border-gridline/60 last:border-0">
                <td className="py-2 pr-4 text-ink-secondary">{row.labels.local_az || "—"}</td>
                <td className="py-2 pr-4 font-mono text-[11px] text-ink-muted">{row.labels.local_subnet || "—"}</td>
                <td className="py-2 pr-4 font-mono text-[11px] text-ink-muted">{row.labels.remote_id || "—"}</td>
                <td className="py-2 pr-4 text-ink-secondary">{prettifyCategory(row.labels.category)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatBytes(row.value)}</td>
                <td className="tabular py-2 text-right text-ink">
                  {estimated === undefined ? "—" : formatUsd(estimated, 4)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function joinKey(labels: Record<string, string>): string {
  return [labels.local_az, labels.local_subnet, labels.remote_id, labels.category].join("|");
}
