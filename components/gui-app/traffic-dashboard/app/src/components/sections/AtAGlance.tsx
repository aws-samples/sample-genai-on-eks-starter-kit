"use client";

import { SignalTile } from "../SignalTile";
import { formatBytesPerSecond, formatCount, formatPercent100, formatPercentUnit, formatSeconds, formatShort } from "@/lib/format";
import { CLUSTER, CLUSTER_THRESHOLDS as C, GLANCE, GLANCE_THRESHOLDS as G, KPI, NEURON } from "@/lib/queries";

const formatTokensPerSec = (v: number | null) => (v === null ? "—" : `${formatShort(v)} tok/s`);
const pct0 = (v: number | null) => formatPercentUnit(v, 0);
const pct1 = (v: number | null) => formatPercentUnit(v, 1);
/** Gauges that count things: the range step can land between scrapes, so round. */
const formatWhole = (v: number | null) => formatCount(v === null ? null : Math.round(v));

/**
 * Whole-cluster averages, one screen. Each block is one resource — nodes and
 * pods, CPU, memory, network, storage, accelerators, serving — with four
 * cluster-wide figures. Every tile is headline + delta + sparkline over the
 * selected window, so "at a glance" also answers "and which way is it moving".
 * Ratios are 0..1 from Prometheus and rendered as percentages; utilisation is
 * an average over nodes, "busiest node" is the max, and requests are only
 * counted for pods that are actually running.
 */
export function AtAGlance({ minutes }: { minutes: number }) {
  return (
    <div className="space-y-8">
      <Block index="Cluster" title="Nodes & pods" tagline="Is the cluster whole: every node Ready, nothing stuck Pending, nothing crash-looping.">
        <SignalTile label="Nodes ready" expr={CLUSTER.nodesReady} minutes={minutes} format={formatWhole} hint="Nodes with condition Ready=true (kube-state-metrics)" />
        <SignalTile label="Pods running" expr={CLUSTER.podsRunning} minutes={minutes} format={formatWhole} hint="Pods in phase Running, all namespaces" />
        <SignalTile label="Pods pending" expr={CLUSTER.podsPending} minutes={minutes} format={formatWhole} hint="Unschedulable or still pulling — capacity or image problems" thresholds={C.podsPending} />
        <SignalTile label="Container restarts" expr={CLUSTER.restartsPerHour} minutes={minutes} format={(v) => (v === null ? "—" : `${formatShort(v, 0)} /h`)} hint="Restarts across all containers in the last hour" thresholds={C.restartsPerHour} />
      </Block>

      <Block index="CPU" title="CPU" tagline="Average across nodes, what the scheduler has already promised, and the one node that is hottest.">
        <SignalTile label="CPU utilisation" expr={CLUSTER.cpuUtil} minutes={minutes} format={pct1} hint="1 − idle share, averaged over every node's cores (node-exporter)" thresholds={C.utilisation} />
        <SignalTile label="CPU requested" expr={CLUSTER.cpuRequestsRatio} minutes={minutes} format={pct0} hint="Requests of running pods / allocatable cores — what the scheduler sees as taken" thresholds={C.requestsRatio} />
        <SignalTile label="Busiest node CPU" expr={CLUSTER.cpuBusiestNode} minutes={minutes} format={pct0} hint="Highest single-node utilisation — an average can hide one saturated node" thresholds={C.utilisation} />
        <SignalTile label="CPU throttled" expr={CLUSTER.cpuThrottledShare} minutes={minutes} format={pct1} hint="Share of CFS periods in which a container hit its CPU limit" thresholds={C.throttledShare} />
      </Block>

      <Block index="Memory" title="Memory" tagline="Working set versus what is installed, requests versus allocatable, and whether anything has been OOM-killed.">
        <SignalTile label="Memory utilisation" expr={CLUSTER.memUtil} minutes={minutes} format={pct1} hint="1 − MemAvailable / MemTotal, summed over nodes" thresholds={C.utilisation} />
        <SignalTile label="Memory requested" expr={CLUSTER.memRequestsRatio} minutes={minutes} format={pct0} hint="Requests of running pods / allocatable memory" thresholds={C.requestsRatio} />
        <SignalTile label="Busiest node memory" expr={CLUSTER.memBusiestNode} minutes={minutes} format={pct0} hint="Highest single-node memory utilisation" thresholds={C.utilisation} />
        <SignalTile label="OOM-killed containers" expr={CLUSTER.oomKilledContainers} minutes={minutes} format={formatWhole} hint="Containers whose last termination reason is OOMKilled" thresholds={C.oomKilled} />
      </Block>

      <Block index="Network" title="Network" tagline="Bytes moving through the nodes' primary NICs, and how much of it crosses an AZ boundary (billable) or has to be retransmitted.">
        <SignalTile label="Receive" expr={CLUSTER.netReceiveBytes} minutes={minutes} format={formatBytesPerSecond} hint="Inbound on eth0, summed over nodes" />
        <SignalTile label="Transmit" expr={CLUSTER.netTransmitBytes} minutes={minutes} format={formatBytesPerSecond} hint="Outbound on eth0, summed over nodes" />
        <SignalTile label="Inter-AZ ratio" expr={KPI.interAzRatio} minutes={minutes} format={pct1} hint="Bytes crossing AZs / all bytes (Network Flow Monitor)" thresholds={{ warning: 0.3, critical: 0.6 }} />
        <SignalTile label="Retrans / GB" expr={KPI.retransPerGb} minutes={minutes} format={formatShort} hint="TCP retransmits per GB moved (Network Flow Monitor)" thresholds={{ warning: 500, critical: 2000 }} />
      </Block>

      <Block index="Storage" title="Storage" tagline="Node data volumes (images, kubelet, logs), persistent volumes, and how hard the disks are working.">
        <SignalTile label="Node data volume" expr={CLUSTER.nodeDataFsUsed} minutes={minutes} format={pct0} hint="Used share of the Bottlerocket data partition, summed over nodes" thresholds={C.fsUsed} />
        <SignalTile label="Persistent volumes" expr={CLUSTER.pvUsed} minutes={minutes} format={pct0} hint="Used / capacity across mounted PVCs (kubelet volume stats)" thresholds={C.fsUsed} />
        <SignalTile label="Disk read" expr={CLUSTER.diskReadBytes} minutes={minutes} format={formatBytesPerSecond} hint="NVMe reads, summed over nodes" />
        <SignalTile label="Disk write" expr={CLUSTER.diskWriteBytes} minutes={minutes} format={formatBytesPerSecond} hint="NVMe writes, summed over nodes" />
      </Block>

      <Block index="Accel" title="GPU & accelerators" tagline="Are the expensive devices busy: utilisation against the 70% target, memory pressure, and how many devices pods have actually claimed.">
        <SignalTile label="GPU util (avg)" expr={GLANCE.gpuUtilAvg} minutes={minutes} format={(v) => formatPercent100(v, 0)} hint="DCGM, all NVIDIA GPUs — dashed line is the 70% target" thresholds={G.gpuUtilAvg} direction="higher-is-better" reference={70} />
        <SignalTile label="GPU memory used" expr={GLANCE.gpuMemUsedRatio} minutes={minutes} format={pct0} hint="Framebuffer used / total across GPUs" thresholds={G.gpuMemUsedRatio} />
        <SignalTile label="GPUs allocated" expr={CLUSTER.gpusAllocatedRatio} minutes={minutes} format={pct0} hint="GPUs claimed by a pod / GPUs DCGM can see" />
        <SignalTile label="NeuronCore util (avg)" expr={NEURON.avgCoreUtil} minutes={minutes} format={pct0} hint="neuron-monitor, all cores with a runtime attached" />
      </Block>

      <Block index="Serving" title="Serving" tagline="The platform's output in one row; the full Token Factory signal set lives under LLM Performance and Cache Hit Rate.">
        <SignalTile label="Models serving" expr={GLANCE.modelsServing} minutes={minutes} format={formatWhole} hint="Distinct model pools reporting to Prometheus" />
        <SignalTile label="Generation throughput" expr={GLANCE.genTokensPerSec} minutes={minutes} format={formatTokensPerSec} hint="Output tokens per second, all models" />
        <SignalTile label="TTFT p95" expr={GLANCE.ttftP95} minutes={minutes} format={formatSeconds} hint="Time to first token, all vLLM engines" thresholds={G.ttftP95} />
        <SignalTile label="Prefix cache hit" expr={GLANCE.prefixHitRatio} minutes={minutes} format={pct1} hint="Share of prefix-cache queries that hit" thresholds={G.prefixHitRatio} direction="higher-is-better" />
      </Block>
    </div>
  );
}

function Block({ index, title, tagline, children }: { index: string; title: string; tagline: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`glance-${index}`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded-md bg-surface-raised px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-ink-secondary ring-1 ring-white/10">
          {index}
        </span>
        <h3 id={`glance-${index}`} className="text-sm font-semibold text-ink">
          {title}
        </h3>
        <p className="text-xs text-ink-muted">{tagline}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}
