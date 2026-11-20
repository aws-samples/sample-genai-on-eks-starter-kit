"use client";

import { Card } from "../Card";
import { TimeSeriesChart } from "../TimeSeriesChart";
import { formatPercentUnit, formatSeconds, formatShort } from "@/lib/format";
import { LLM } from "@/lib/queries";

/**
 * vLLM native metrics — latency measured inside the engine, not at an HTTP hop.
 * Each panel holds one unit; queue depth (count), token throughput (tokens/s),
 * KV-cache (percent) and preemptions (events/s) therefore get their own charts
 * rather than sharing a dual axis as the Grafana panels do.
 */
export function LlmPerformance({ minutes }: { minutes: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card
        title="TTFT & inter-token latency"
        subtitle="Time to first token (p50/p95) and inter-token latency p95, per model."
      >
        <TimeSeriesChart
          minutes={minutes}
          formatValue={formatSeconds}
          unitLabel="seconds"
          queries={[
            { expr: LLM.ttftP50, legend: "TTFT p50 {{model_name}}" },
            { expr: LLM.ttftP95, legend: "TTFT p95 {{model_name}}" },
            { expr: LLM.itlP95, legend: "ITL p95 {{model_name}}" },
          ]}
        />
      </Card>

      <Card
        title="Queue depth"
        subtitle="Requests running vs waiting per model. A growing waiting queue is the leading indicator of saturation — scale out before TTFT degrades."
      >
        <TimeSeriesChart
          minutes={minutes}
          formatValue={formatShort}
          unitLabel="requests"
          queries={[
            { expr: LLM.requestsRunning, legend: "running {{model_name}}" },
            { expr: LLM.requestsWaiting, legend: "waiting {{model_name}}" },
          ]}
        />
      </Card>

      <Card title="Token throughput" subtitle="Generation tokens per second per model.">
        <TimeSeriesChart
          minutes={minutes}
          formatValue={formatShort}
          unitLabel="tokens/s"
          queries={[{ expr: LLM.generationTokens, legend: "{{model_name}}" }]}
        />
      </Card>

      <Card
        title="KV-cache utilisation"
        subtitle="Memory pressure inside the engine. Sustained high usage precedes preemptions."
      >
        <TimeSeriesChart
          minutes={minutes}
          formatValue={(value) => formatPercentUnit(value, 1)}
          unitLabel="utilisation"
          queries={[{ expr: LLM.kvCacheUsage, legend: "{{model_name}}" }]}
        />
      </Card>

      <Card
        title="Preemptions & aborts"
        subtitle="Requests evicted and recomputed (a direct latency hit), plus non-success finishes."
        className="xl:col-span-2"
      >
        <TimeSeriesChart
          minutes={minutes}
          formatValue={formatShort}
          unitLabel="events/s"
          queries={[
            { expr: LLM.preemptions, legend: "preemptions {{model_name}}" },
            { expr: LLM.nonSuccessFinishes, legend: "{{finished_reason}} {{model_name}}" },
          ]}
        />
      </Card>
    </div>
  );
}
