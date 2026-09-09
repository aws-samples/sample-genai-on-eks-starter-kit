/**
 * PromQL ported from the Grafana dashboard
 * components/nvidia-platform/monitoring/dashboards/agentic-traffic-overview.json
 * so both views answer with the same numbers.
 *
 * Grafana variables are resolved to fixed values here:
 *   $__rate_interval   → 5m
 *   $az_price_per_gb   → 0.01   (AZ_PRICE_PER_GB below)
 *   $namespace         → .*     (all namespaces)
 */

const RATE = "5m";
export const AZ_PRICE_PER_GB = 0.01;
const NS = ".*";

/**
 * Joins non-empty label-matcher fragments into a PromQL selector, "" when all
 * are empty — so one query template serves both the whole-cluster panels and
 * the same panels narrowed by the accelerator filter, without a second copy of
 * the expression that could drift from the first.
 */
export function sel(...parts: (string | undefined)[]): string {
  const present = parts.filter((part): part is string => !!part);
  return present.length ? `{${present.join(", ")}}` : "";
}

/** Section 1 — At a Glance */
export const KPI = {
  successRate: `1 - (sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[${RATE}])) or vector(0)) / sum(rate(http_server_request_duration_seconds_count[${RATE}]))`,
  ttftP95: `histogram_quantile(0.95, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket[${RATE}])))`,
  retransPerGb: `sum(nfm_wi_top_contributor_value{metric="retransmissions"}) / clamp_min(sum(nfm_wi_top_contributor_value{metric="data_transferred"}) / 1e9, 0.001)`,
  interAzRatio: `sum(nfm_wi_top_contributor_value{metric="data_transferred",category="inter_az"}) / clamp_min(sum(nfm_wi_top_contributor_value{metric="data_transferred"}), 1)`,
  interAzCostMonth: `sum(nfm_wi_top_contributor_value{metric="data_transferred",category="inter_az"}) / scalar(nfm_wi_query_window_seconds) * 2592000 / 1e9 * ${AZ_PRICE_PER_GB}`,
  nfmCollectorsUp: `count(up{namespace="amazon-network-flow-monitor"} == 1)`,
} as const;

/**
 * At a Glance — the KCD 2026 Token Factory signal set, mirroring the
 * "Token Factory — At a Glance (KCD LLM-native signals)" row of
 * components/nvidia-platform/monitoring/dashboards/token-factory-overview.json
 * ($model → all models). Grouped by the talk's four blocks: B1 routing & prefix
 * cache, B2 per-token throughput & latency, B3 GPU & KV cache, B4 scale signals
 * (LLM-native, not CPU%). Each expression yields one series so it can drive a
 * stat tile plus its sparkline from a single range query.
 */
export const GLANCE = {
  // B1 — routing & prefix cache (TTFT is what a cache miss costs)
  ttftP95: `histogram_quantile(0.95, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket[${RATE}])))`,
  prefixHitRatio: `(sum(rate(vllm:prefix_cache_hits_total[${RATE}])) or vector(0)) / clamp_min(sum(rate(vllm:prefix_cache_queries_total[${RATE}])), 1e-9)`,
  cachedPromptShare: `(sum(rate(vllm:prompt_tokens_cached_total[${RATE}])) or vector(0)) / clamp_min(sum(rate(vllm:prompt_tokens_total[${RATE}])), 1e-9)`,
  queueTimeP95: `histogram_quantile(0.95, sum by (le) (rate(vllm:request_queue_time_seconds_bucket[${RATE}])))`,
  // B2 — token throughput & per-token latency
  genTokensPerSec: `sum(rate(vllm:generation_tokens_total[${RATE}]))`,
  promptTokensPerSec: `sum(rate(vllm:prompt_tokens_total[${RATE}]))`,
  tpotP95: `histogram_quantile(0.95, sum by (le) (rate(vllm:request_time_per_output_token_seconds_bucket[${RATE}])))`,
  e2eP95: `histogram_quantile(0.95, sum by (le) (rate(vllm:e2e_request_latency_seconds_bucket[${RATE}])))`,
  // B3 — GPU & KV cache (resources and isolation)
  kvCacheMax: `max(vllm:kv_cache_usage_perc)`,
  gpuUtilAvg: `avg(DCGM_FI_DEV_GPU_UTIL)`,
  gpuMemUsedRatio: `sum(DCGM_FI_DEV_FB_USED) / clamp_min(sum(DCGM_FI_DEV_FB_USED) + sum(DCGM_FI_DEV_FB_FREE), 1)`,
  preemptionsPerMin: `sum(rate(vllm:num_preemptions_total[${RATE}])) * 60`,
  // B4 — scale signals
  queueDepth: `sum(vllm:num_requests_waiting)`,
  inFlight: `sum(vllm:num_requests_running)`,
  modelsServing: `count(count by (model_name) (vllm:num_requests_running))`,
  abortErrorRate: `(sum(rate(vllm:request_success_total{finished_reason=~"abort|error"}[${RATE}])) or vector(0)) / clamp_min(sum(rate(vllm:request_success_total[${RATE}])), 1e-9)`,
} as const;

/** Thresholds copied from the Grafana stat panels' threshold steps. */
export const GLANCE_THRESHOLDS = {
  ttftP95: { warning: 0.2, critical: 1 },
  tpotP95: { warning: 0.05, critical: 0.2 },
  e2eP95: { warning: 5, critical: 15 },
  queueTimeP95: { warning: 0.5, critical: 5 },
  queueDepth: { warning: 1, critical: 10 },
  kvCacheMax: { warning: 0.7, critical: 0.9 },
  gpuMemUsedRatio: { warning: 0.85, critical: 0.95 },
  preemptionsPerMin: { warning: 0.1, critical: 1 },
  abortErrorRate: { warning: 0.01, critical: 0.05 },
  // higher-is-better
  prefixHitRatio: { warning: 0.5, critical: 0.2 },
  cachedPromptShare: { warning: 0.5, critical: 0.2 },
  /** KCD target: GPU utilisation above 70% (DCGM reports 0-100). */
  gpuUtilAvg: { warning: 70, critical: 50 },
} as const;

/** Section 2 — Network Structure & Cost (NFM Workload Insights) */
export const NETWORK = {
  trafficByCategory: `sum by (category) (nfm_wi_top_contributor_value{metric="data_transferred"})`,
  topContributorsBytes: `topk(15, sum by (local_az, local_subnet, remote_id, category) (nfm_wi_top_contributor_value{metric="data_transferred"}))`,
  topContributorsCost: `sum by (local_az, local_subnet, remote_id, category) (nfm_wi_top_contributor_value{metric="data_transferred",category=~"inter_az|inter_vpc"}) / 1e9 * ${AZ_PRICE_PER_GB}`,
  azTrafficByCategory: `sum by (local_az, category) (nfm_wi_top_contributor_value{metric="data_transferred"})`,
  podEgress: `sum by (exported_namespace, exported_pod) (rate(egress_bytes{exported_namespace=~"${NS}"}[${RATE}]))`,
  podIngress: `sum by (exported_namespace, exported_pod) (rate(ingress_bytes{exported_namespace=~"${NS}"}[${RATE}]))`,
  enaAllowanceExceeded: `sum by (node) (rate(bw_out_allowance_exceeded[${RATE}]) + rate(bw_in_allowance_exceeded[${RATE}]) + rate(pps_allowance_exceeded[${RATE}]) + rate(conntrack_allowance_exceeded[${RATE}]))`,
  retransmissions: `sum by (category) (nfm_wi_top_contributor_value{metric="retransmissions"})`,
  timeouts: `sum by (category) (nfm_wi_top_contributor_value{metric="timeouts"})`,
} as const;

/** Section 3 — LLM Performance & Stability (vLLM native metrics) */
export const LLM = {
  ttftP50: `histogram_quantile(0.50, sum by (le, model_name) (rate(vllm:time_to_first_token_seconds_bucket[${RATE}])))`,
  ttftP95: `histogram_quantile(0.95, sum by (le, model_name) (rate(vllm:time_to_first_token_seconds_bucket[${RATE}])))`,
  itlP95: `histogram_quantile(0.95, sum by (le, model_name) (rate(vllm:inter_token_latency_seconds_bucket[${RATE}])))`,
  requestsRunning: `sum by (model_name) (vllm:num_requests_running)`,
  requestsWaiting: `sum by (model_name) (vllm:num_requests_waiting)`,
  generationTokens: `sum by (model_name) (rate(vllm:generation_tokens_total[${RATE}]))`,
  kvCacheUsage: `max by (model_name) (vllm:kv_cache_usage_perc)`,
  preemptions: `sum by (model_name) (rate(vllm:num_preemptions_total[${RATE}]))`,
  nonSuccessFinishes: `sum by (model_name, finished_reason) (rate(vllm:request_success_total{finished_reason=~"abort|error"}[${RATE}]))`,
} as const;

/**
 * Section — Cache Hit Rate (KCD Token Factory S7: the prefix-cache hit ratio is
 * an SLI, and it has to be split — by worker node, by model pool and by tenant —
 * because a single average hides the cache-hit cliff).
 *
 * vLLM only reports cache counters per engine (pod), so the node view is a join
 * against kube_pod_info and the tenant view attributes traffic to each model
 * pool from the Beyla service graph. Per-tenant hit ratios need a gateway that
 * exports cached-token counters per key (e.g. LiteLLM's
 * litellm_input_cached_tokens_metric); that is not scraped on this platform.
 */
const VLLM_POD_NODE = `max by (pod, node) (kube_pod_info{namespace="vllm"})`;
/** Scrapers and kubelet probes call vLLM too; they are not tenants. */
// LiteLLM virtual keys carry the tenant identity (team_alias / api_key_alias);
// the master key and health probes have neither and are excluded.
const LITELLM_TENANT = `api_key_alias!="", api_key_alias!="None"`;
const LITELLM_TEMPLATE = `metadata_prompt_template!="", metadata_prompt_template!="None"`;
const LITELLM_KEY = "team_alias, api_key_alias, end_user, metadata_prompt_template, metadata_prompt_template_version, requested_model";
const TENANT_CLIENT = `client!~"i-[0-9a-f]+", client_k8s_namespace_name!~"monitoring|adot|beyla|kube-system"`;

export const CACHE = {
  hitRatio: `sum(rate(vllm:prefix_cache_hits_total[${RATE}])) / sum(rate(vllm:prefix_cache_queries_total[${RATE}]))`,
  cachedTokenShare: `sum(rate(vllm:prompt_tokens_cached_total[${RATE}])) / sum(rate(vllm:prompt_tokens_total[${RATE}]))`,
  kvUsageMax: `max(vllm:kv_cache_usage_perc)`,
  preemptionsPerMin: `sum(rate(vllm:num_preemptions_total[${RATE}])) * 60`,
  hitRatioByNode: `sum by (node, model_name) (sum by (pod, model_name) (rate(vllm:prefix_cache_hits_total[${RATE}])) * on (pod) group_left (node) ${VLLM_POD_NODE}) / sum by (node, model_name) (sum by (pod, model_name) (rate(vllm:prefix_cache_queries_total[${RATE}])) * on (pod) group_left (node) ${VLLM_POD_NODE})`,
  hitRatioByModel: `sum by (model_name) (rate(vllm:prefix_cache_hits_total[${RATE}])) / sum by (model_name) (rate(vllm:prefix_cache_queries_total[${RATE}]))`,
  cachedTokenShareByModel: `sum by (model_name) (rate(vllm:prompt_tokens_cached_total[${RATE}])) / sum by (model_name) (rate(vllm:prompt_tokens_total[${RATE}]))`,
  promptTokensBySource: `sum by (model_name, source) (rate(vllm:prompt_tokens_by_source_total[${RATE}]))`,
  /** Per-pod instant vectors joined client-side into the diagnostic table. */
  podQueries: `sum by (pod, model_name) (rate(vllm:prefix_cache_queries_total[${RATE}]))`,
  podHits: `sum by (pod, model_name) (rate(vllm:prefix_cache_hits_total[${RATE}]))`,
  podPromptTokens: `sum by (pod, model_name) (rate(vllm:prompt_tokens_total[${RATE}]))`,
  podCachedTokens: `sum by (pod, model_name) (rate(vllm:prompt_tokens_cached_total[${RATE}]))`,
  podKvUsage: `max by (pod, model_name) (vllm:kv_cache_usage_perc)`,
  podPreemptionsPerMin: `sum by (pod, model_name) (rate(vllm:num_preemptions_total[${RATE}])) * 60`,
  podNode: VLLM_POD_NODE,
  /** Which workloads (tenants) drive each model pool — Beyla service graph (every path, not only LiteLLM). */
  tenantMix: `sum by (client, client_k8s_namespace_name, server) (rate(traces_service_graph_request_total{source="beyla", ${TENANT_CLIENT}}[${RATE}]))`,

  // --- Consequence side: what a hit actually buys (vLLM histograms) ---
  ttftP95ByModel: `histogram_quantile(0.95, sum by (le, model_name) (rate(vllm:time_to_first_token_seconds_bucket[${RATE}])))`,
  /** Prompt tokens per request versus the tokens prefill really computed; the gap is what the cache saved. */
  promptTokensPerRequest: `sum by (model_name) (rate(vllm:request_prompt_tokens_sum[${RATE}])) / sum by (model_name) (rate(vllm:request_prompt_tokens_count[${RATE}]))`,
  prefillComputedPerRequest: `sum by (model_name) (rate(vllm:request_prefill_kv_computed_tokens_sum[${RATE}])) / sum by (model_name) (rate(vllm:request_prefill_kv_computed_tokens_count[${RATE}]))`,
  podTtftP95: `histogram_quantile(0.95, sum by (le, pod, model_name) (rate(vllm:time_to_first_token_seconds_bucket[${RATE}])))`,
  podWaiting: `max by (pod, model_name) (vllm:num_requests_waiting)`,
  /** Engine age bounds cache age: a restart (rollout, node churn, scale-to-zero) empties the prefix cache. */
  podAgeSeconds: `time() - max by (pod) (kube_pod_start_time{namespace="vllm"})`,

  // --- Tenant / template axis (LiteLLM prometheus callback) ---
  // litellm_input_cached_tokens_metric is sparse (only emitted when the backend
  // reports cached_tokens > 0), so `or 0 * denominator` keeps tenants with no
  // hits on the chart instead of dropping them.
  tenantCachedShare: `(sum by (team_alias, api_key_alias) (rate(litellm_input_cached_tokens_metric_total{${LITELLM_TENANT}}[${RATE}])) or 0 * sum by (team_alias, api_key_alias) (rate(litellm_input_tokens_metric_total{${LITELLM_TENANT}}[${RATE}]))) / sum by (team_alias, api_key_alias) (rate(litellm_input_tokens_metric_total{${LITELLM_TENANT}}[${RATE}]))`,
  templateCachedShare: `(sum by (metadata_prompt_template, metadata_prompt_template_version) (rate(litellm_input_cached_tokens_metric_total{${LITELLM_TEMPLATE}}[${RATE}])) or 0 * sum by (metadata_prompt_template, metadata_prompt_template_version) (rate(litellm_input_tokens_metric_total{${LITELLM_TEMPLATE}}[${RATE}]))) / sum by (metadata_prompt_template, metadata_prompt_template_version) (rate(litellm_input_tokens_metric_total{${LITELLM_TEMPLATE}}[${RATE}]))`,
  /** Per tenant × template × pool instant vectors joined client-side into the tenant table. */
  tenantInputTokens: `sum by (${LITELLM_KEY}) (rate(litellm_input_tokens_metric_total{${LITELLM_TENANT}}[${RATE}]))`,
  tenantCachedTokens: `sum by (${LITELLM_KEY}) (rate(litellm_input_cached_tokens_metric_total{${LITELLM_TENANT}}[${RATE}]))`,
  tenantRequests: `sum by (${LITELLM_KEY}) (rate(litellm_proxy_total_requests_metric_total{${LITELLM_TENANT}}[${RATE}]))`,
} as const;

/** Hit-ratio thresholds (share of prefix-cache queries that hit). */
/**
 * At a Glance — per-engine breakdown (one row per vLLM pod, rolled up per
 * model). vLLM gauges carry (pod, model_name); accelerator gauges do not know
 * the model, so DCGM is joined on the pod label and neuron-monitor (per node)
 * through kube_pod_info. Utilisation ratios are normalised to 0..1 here so GPU
 * and Neuron rows read on the same scale.
 */
export const ENGINES = {
  running: `max by (namespace, pod, model_name) (vllm:num_requests_running)`,
  waiting: `max by (pod, model_name) (vllm:num_requests_waiting)`,
  kvUsage: `max by (pod, model_name) (vllm:kv_cache_usage_perc)`,
  cacheHits: `sum by (pod, model_name) (rate(vllm:prefix_cache_hits_total[${RATE}]))`,
  cacheQueries: `sum by (pod, model_name) (rate(vllm:prefix_cache_queries_total[${RATE}]))`,
  genTokensPerSec: `sum by (pod, model_name) (rate(vllm:generation_tokens_total[${RATE}]))`,
  ttftP95ByPod: `histogram_quantile(0.95, sum by (le, pod, model_name) (rate(vllm:time_to_first_token_seconds_bucket[${RATE}])))`,
  ttftP95ByModel: `histogram_quantile(0.95, sum by (le, model_name) (rate(vllm:time_to_first_token_seconds_bucket[${RATE}])))`,
  podNode: VLLM_POD_NODE,
  /** NVIDIA, per pod: DCGM labels every GPU with the pod that holds it. */
  gpuUtilByPod: `avg by (pod) (DCGM_FI_DEV_GPU_UTIL{pod!=""}) / 100`,
  gpuCountByPod: `count by (pod) (DCGM_FI_DEV_GPU_UTIL{pod!=""})`,
  gpuMemUsedByPod: `sum by (pod) (DCGM_FI_DEV_FB_USED{pod!=""})`,
  gpuMemTotalByPod: `sum by (pod) (DCGM_FI_DEV_FB_USED{pod!=""}) + sum by (pod) (DCGM_FI_DEV_FB_FREE{pod!=""})`,
  /** Neuron, per node: one model pod per Neuron node on this platform. */
  neuronUtilByNode: `avg by (node) (neuroncore_utilization_ratio)`,
  neuronCoresByNode: `count by (node) (neuroncore_utilization_ratio)`,
} as const;

export const CACHE_HIT_WARNING = 0.5;
export const CACHE_HIT_CRITICAL = 0.3;
/** KV-cache usage above this with low hits = capacity bottleneck (eviction). */
export const KV_CAPACITY_PRESSURE = 0.85;
/** KV-cache usage below this with low hits = prompt or routing problem, not capacity. */
export const KV_HEADROOM = 0.6;

/** Section 4 — L7 RED from Beyla eBPF */
export const L7 = {
  durationP50: `histogram_quantile(0.50, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket{k8s_namespace_name=~"${NS}"}[${RATE}])))`,
  durationP95: `histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket{k8s_namespace_name=~"${NS}"}[${RATE}])))`,
  durationP99: `histogram_quantile(0.99, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket{k8s_namespace_name=~"${NS}"}[${RATE}])))`,
  requestRate: `sum by (service_name) (rate(http_server_request_duration_seconds_count{k8s_namespace_name=~"${NS}"}[${RATE}]))`,
  errorRate: `sum by (service_name) (rate(http_server_request_duration_seconds_count{k8s_namespace_name=~"${NS}", http_response_status_code=~"5.."}[${RATE}]))`,
} as const;

/**
 * Section 5 — Service Map.
 *
 * Beyla exports the standard traces_service_graph_request_* family directly
 * (job="beyla"); edges are (client, server) pairs decorated with each side's
 * Kubernetes namespace. Kubelet health probes surface as pseudo-clients named
 * after their node ("i-…") and are excluded here, matching the Grafana view.
 *
 * The map's filters resolve client-side in ServiceMap.tsx: namespace and
 * service come straight off the edge labels; node, AZ, CPU architecture and
 * GPU type are attributes of the node that observed the edge, resolved by
 * joining the Beyla DaemonSet pod (`pod` on the scraped series) to
 * kube_pod_info and then to per-node series.
 */
export const SERVICE_GRAPH = {
  edgeRate: `sum by (client, server, client_k8s_namespace_name, server_k8s_namespace_name) (rate(traces_service_graph_request_total{source="beyla", client!~"i-[0-9a-f]+"}[${RATE}]))`,
  edgeErrors: `sum by (client, server) (rate(traces_service_graph_request_failed_total{source="beyla", client!~"i-[0-9a-f]+"}[${RATE}]))`,
  edgeLatencyP95: `histogram_quantile(0.95, sum by (le, client, server) (rate(traces_service_graph_request_server_seconds_bucket{source="beyla", client!~"i-[0-9a-f]+"}[${RATE}])))`,
  /** Which Beyla pod reported each edge — the join that enables the node-attribute filters. */
  edgeObservers: `group by (client, server, pod) (traces_service_graph_request_total{source="beyla", client!~"i-[0-9a-f]+"})`,
  observerNodes: `group by (pod, node) (kube_pod_info{namespace="beyla"})`,
  nodeZones: `group by (node, provider_id) (kube_node_info)`,
  /** uname's nodename is the OS hostname, not the k8s node name, so arch also
   *  joins through the exporter pod that scraped it. */
  nodeArch: `group by (pod, machine) (node_uname_info)`,
  archPodNodes: `group by (pod, node) (kube_pod_info{namespace="monitoring", pod=~".*node-exporter.*"})`,
  /** DCGM's Hostname IS the k8s node name — no join needed for GPU type. */
  nodeGpus: `group by (Hostname, modelName) (DCGM_FI_DEV_GPU_UTIL)`,
  /** Neuron nodes: neuron-monitor's PodMonitor stamps `node`; instance_type
   *  (inf2.xlarge, trn1.32xlarge, …) names the accelerator generation. */
  nodeNeuron: `group by (node, instance_type) (neuron_hardware_info)`,
} as const;

/**
 * Section 5 — Service Map, second level: one service's pods.
 *
 * Beyla's own service graph stops at service names. The pod-exact edges come
 * from Tempo's metrics-generator (source="tempo"), which pairs the client span
 * and the server span of the same request and emits the edge carrying both
 * pods' names and nodes (components/o11y/tempo/values.template.yaml sets the
 * dimensions and the pairing window). Per-pod request rate, errors and p95 for
 * the focused service come from Beyla's server-side RED series, which do carry
 * k8s_pod_name; scrape and probe routes are excluded so a pod's rate is its
 * real traffic. The client-side RED series is the fallback for what a pod
 * calls when Tempo has not paired that hop.
 *
 * Two pseudo-clients are dropped from the Tempo edges: kubelet probes ("i-…",
 * as in the service map) and Tempo's own "user" virtual node, which stands for
 * a server span with no instrumented caller — here overwhelmingly the
 * inference-extension EPP polling every Neuron pod's /metrics ~17 times a
 * second — and which no service on the map could be drilled into.
 */
const PROBE_ROUTES = `http_route!~"/metrics|/health.*|/ready.*|/live.*|/healthz|/readyz"`;
export const POD_GRAPH = {
  edgeRate: `sum by (client, server, client_k8s_pod_name, server_k8s_pod_name, client_k8s_node_name, server_k8s_node_name) (rate(traces_service_graph_request_total{source="tempo", client!~"i-[0-9a-f]+|user"}[${RATE}]))`,
  edgeErrors: `sum by (client, server, client_k8s_pod_name, server_k8s_pod_name) (rate(traces_service_graph_request_failed_total{source="tempo", client!~"i-[0-9a-f]+|user"}[${RATE}]))`,
  edgeLatencyP95: `histogram_quantile(0.95, sum by (le, client, server, client_k8s_pod_name, server_k8s_pod_name) (rate(traces_service_graph_request_server_seconds_bucket{source="tempo", client!~"i-[0-9a-f]+|user"}[${RATE}])))`,
  /** k8s_owner_name rides along so a pod Beyla files under a broader service name
   *  (the LiteLLM chart's PostgreSQL pod reports service_name="litellm") can be
   *  handed to the map node that carries its owner's name instead. */
  podRate: `sum by (service_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_owner_name) (rate(http_server_request_duration_seconds_count{${PROBE_ROUTES}}[${RATE}]))`,
  podErrors: `sum by (service_name, k8s_pod_name) (rate(http_server_request_duration_seconds_count{${PROBE_ROUTES}, http_response_status_code=~"5.."}[${RATE}]))`,
  podLatencyP95: `histogram_quantile(0.95, sum by (le, service_name, k8s_pod_name) (rate(http_server_request_duration_seconds_bucket{${PROBE_ROUTES}}[${RATE}])))`,
  /** Outbound calls per pod, by target host (Beyla client-side RED). */
  podOutbound: `sum by (service_name, k8s_pod_name, server_address) (rate(http_client_request_duration_seconds_count{server_address!~"localhost|outgoing|"}[${RATE}]))`,
} as const;

/**
 * Section 6, NVIDIA tab — GPU (DCGM exporter, shipped by the NVIDIA GPU Operator).
 *
 * Metric names are the ones the repo's own Grafana dashboard uses
 * (components/nvidia-platform/monitoring/dashboards/dcgm-metrics.json). On
 * Kubernetes the exporter decorates every DCGM_FI_* series with namespace / pod
 * / container alongside gpu / UUID / modelName / Hostname, which is what lets
 * the per-pod table attribute a physical GPU's temperature to a workload.
 */
/**
 * `m` is an optional label-matcher fragment (from lib/acceleratorScope.ts) that
 * narrows every series to the accelerators the section filter selected. DCGM
 * series carry no namespace/service/tenant labels, so the filter reaches these
 * panels as `modelName` and `pod` matchers rather than as a client-side row
 * predicate.
 */
export function gpuQueries(m = "") {
  return {
    /* KPI tiles */
    maxTemp: `max(DCGM_FI_DEV_GPU_TEMP${sel(m)})`,
    avgUtil: `avg(DCGM_FI_DEV_GPU_UTIL${sel(m)})`,
    totalMemoryUsedBytes: `sum(DCGM_FI_DEV_FB_USED${sel(m)}) * 1024 * 1024`,
    totalPowerWatts: `sum(DCGM_FI_DEV_POWER_USAGE${sel(m)})`,

    /* Per-pod table: one instant query per column, joined client-side on
       (pod, gpu, UUID). Only GPUs claimed by a pod carry a non-empty pod label. */
    podUtil: `DCGM_FI_DEV_GPU_UTIL${sel(`pod!=""`, m)}`,
    podMemoryUsedBytes: `DCGM_FI_DEV_FB_USED${sel(`pod!=""`, m)} * 1024 * 1024`,
    podPowerWatts: `DCGM_FI_DEV_POWER_USAGE${sel(`pod!=""`, m)}`,
    podTemp: `DCGM_FI_DEV_GPU_TEMP${sel(`pod!=""`, m)}`,

    /* Timeseries */
    utilByPod: `sum by (pod) (DCGM_FI_DEV_GPU_UTIL${sel(`pod!=""`, m)})`,
    tempByGpu: `DCGM_FI_DEV_GPU_TEMP${sel(m)}`,
    memoryTempByGpu: `DCGM_FI_DEV_MEMORY_TEMP${sel(m)}`,
  } as const;
}

/** Whole-fleet GPU queries — the unnarrowed case, for callers with no filter. */
export const GPU = gpuQueries();

/** The 85°C reference line on the GPU temperature chart. */
export const GPU_TEMP_CRITICAL_C = 85;
export const GPU_TEMP_WARNING_C = 75;

/**
 * Section 6, Neuron tab — AWS Inferentia / Trainium, from the neuron-monitor
 * DaemonSet in components/o11y/neuron-monitor.
 *
 * vLLM names its engine metrics after GPUs whatever it runs on, and DCGM only
 * sees NVIDIA devices, so without this exporter an inf2 pool is
 * indistinguishable from an L40S one and its accelerator is unmeasured.
 * neuron-monitor reads the Neuron driver on the node, so its series are per
 * node and per runtime process (runtime_tag = PID), not per pod; the PodMonitor
 * adds a `node` label and the model pod is resolved client-side through
 * kube_pod_info on the same node (one model pod per inf2.xlarge here).
 * Utilisation ratios are 0..1.
 */
/**
 * `m` is an optional label-matcher fragment (from lib/acceleratorScope.ts).
 * neuron-monitor reports per node, so the section filter reaches these panels as
 * a `node` matcher: the scope hook resolves "these namespaces / services /
 * tenants / generations" to the set of Neuron nodes behind them and every series
 * here — neuron-monitor's and kube-state-metrics' alike — carries `node`.
 */
export function neuronQueries(m = "") {
  return {
    /* KPI tiles */
    avgCoreUtil: `avg(neuroncore_utilization_ratio${sel(m)})`,
    /** Cores with a runtime attached vs. cores the cluster's Neuron nodes provide. */
    coresActive: `count(neuroncore_utilization_ratio${sel(m)})`,
    coresCapacity: `sum(kube_node_status_capacity${sel(`resource="aws_amazon_com_neuroncore"`, m)})`,
    coresRequested: `sum(kube_pod_container_resource_requests${sel(`resource="aws_amazon_com_neuroncore"`, m)})`,
    deviceMemoryUsedBytes: `sum(neuron_runtime_memory_used_bytes${sel(`memory_location="neuron_device"`, m)})`,
    execLatencyP99: `max(execution_latency_seconds${sel(`percentile="p99"`, m)})`,
    execErrorsPerMin: `sum(rate(execution_errors_total${sel(m)}[${RATE}])) * 60`,

    /* Timeseries */
    coreUtilByNodeCore: `avg by (node, neuroncore) (neuroncore_utilization_ratio${sel(m)})`,
    runtimeMemoryByNode: `sum by (node, memory_location) (neuron_runtime_memory_used_bytes${sel(m)})`,
    /** One series per memory class (tensors, model_code, constants, scratchpad, runtime). */
    coreMemoryByKind: `sum by (node, kind) (label_replace(${sel(
      `__name__=~"neuroncore_memory_usage_.*"`,
      m,
    )}, "kind", "$1", "__name__", "neuroncore_memory_usage_(.*)"))`,
    execLatencyByNode: `max by (node, percentile) (execution_latency_seconds${sel(`percentile=~"p50|p99"`, m)})`,
    execStatusRate: `sum by (status_type) (rate(execution_status_total${sel(m)}[${RATE}]))`,

    /* Per-node table: instant vectors joined client-side on `node`. */
    nodeHardware: `group by (node, instance_type, availability_zone, neuron_device_count, neuroncore_per_device_count, neuron_device_memory_size) (neuron_hardware_info${sel(
      m,
    )})`,
    nodeCoreUtil: `avg by (node) (neuroncore_utilization_ratio${sel(m)})`,
    nodeCoresActive: `count by (node) (neuroncore_utilization_ratio${sel(m)})`,
    nodeCoresCapacity: `max by (node) (kube_node_status_capacity${sel(`resource="aws_amazon_com_neuroncore"`, m)})`,
    nodeDeviceMemoryBytes: `sum by (node) (neuron_runtime_memory_used_bytes${sel(
      `memory_location="neuron_device"`,
      m,
    )})`,
    nodeHostMemoryBytes: `sum by (node) (neuron_runtime_memory_used_bytes${sel(`memory_location="host"`, m)})`,
    nodeExecPerSecond: `sum by (node) (rate(execution_status_total${sel(`status_type="completed"`, m)}[${RATE}]))`,
    nodeExecLatencyP99: `max by (node) (execution_latency_seconds${sel(`percentile="p99"`, m)})`,
    nodeExecErrorsPerMin: `sum by (node) (rate(execution_errors_total${sel(m)}[${RATE}])) * 60`,
    nodeEccEventsHour: `sum by (node) (increase(hardware_ecc_events_total${sel(m)}[1h]))`,
    /** Model pods on Neuron nodes — neuron-monitor cannot name the pod itself (k8s-info is unsupported on EKS Auto Mode). */
    nodeModelPods: `group by (node, pod) (kube_pod_info{namespace="vllm"} * on (node) group_left () group by (node) (neuron_hardware_info${sel(
      m,
    )}))`,
  } as const;
}

/** Whole-fleet Neuron queries — the unnarrowed case, for callers with no filter. */
export const NEURON = neuronQueries();

/** NeuronCore utilisation below this while cores are allocated = stranded accelerator. */
export const NEURON_UTIL_IDLE = 0.05;

/**
 * Section 6 header — the accelerator fleet by type. NVIDIA GPUs (DCGM, keyed
 * by modelName) and AWS Neuron devices (neuron-monitor, keyed by instance
 * type → Inferentia / Trainium generation) side by side in one table, so the
 * GPU section can answer "what silicon do we have, how much of it is allocated,
 * and how much of that is actually computing" before drilling into one type.
 *
 * Every figure is aggregated client-side in components/AcceleratorFleetTable.tsx
 * from per-device (NVIDIA) and per-node (Neuron) series rather than asked of
 * Prometheus already rolled up per model: the section filter has to be able to
 * drop individual GPUs and nodes out of a row, and a `by (modelName)` average
 * cannot be un-summed once it arrives.
 */
export const ACCELERATORS = {
  /* NVIDIA — one row per (model, node), plus the raw per-device series. */
  gpuDevicesByModelNode: `count by (modelName, Hostname) (DCGM_FI_DEV_GPU_UTIL)`,
  /** One series per physical GPU: modelName, Hostname, gpu, UUID, pod (empty when unallocated). */
  gpuPerDevice: `DCGM_FI_DEV_GPU_UTIL`,
  gpuMemoryPerDevice: `DCGM_FI_DEV_FB_USED * 1024 * 1024`,
  gpuCapacityByNode: `max by (node) (kube_node_status_capacity{resource="nvidia_com_gpu"})`,

  /* Neuron — keyed by node, folded into the instance family client-side. */
  neuronHardware: `group by (node, instance_type, neuron_device_count, neuroncore_per_device_count) (neuron_hardware_info)`,
  neuronCoresActiveByNode: `count by (node) (neuroncore_utilization_ratio)`,
  neuronUtilSumByNode: `sum by (node) (neuroncore_utilization_ratio)`,
  neuronMemoryByNode: `sum by (node) (neuron_runtime_memory_used_bytes{memory_location="neuron_device"})`,
  neuronRequestedByNode: `sum by (node) (kube_pod_container_resource_requests{resource="aws_amazon_com_neuroncore"})`,
} as const;

/** GPU utilisation (0..1) below this while GPUs are allocated = stranded accelerator; same bar as Neuron. */
export const GPU_UTIL_IDLE = NEURON_UTIL_IDLE;

/**
 * Per-pod accelerator inventory for the GPU & Accelerators section, both
 * families in one table. NVIDIA rows come straight from DCGM (one series per
 * physical GPU, with the claiming pod on the `pod` label). Neuron rows are
 * assembled from the scheduler's view — which pods requested NeuronCores and
 * on which node — because neuron-monitor reports per node, not per pod.
 */
export const ACCEL_PODS = {
  /** Pods that requested NeuronCores, with their node. */
  neuronPodNode: `max by (namespace, pod, node) (kube_pod_info and on (namespace, pod) kube_pod_container_resource_requests{resource="aws_amazon_com_neuroncore"})`,
  neuronPodCores: `sum by (namespace, pod) (kube_pod_container_resource_requests{resource="aws_amazon_com_neuroncore"})`,
  neuronNodeUtil: `avg by (node) (neuroncore_utilization_ratio)`,
  neuronNodeDeviceMemoryBytes: `sum by (node) (neuron_runtime_memory_used_bytes{memory_location="neuron_device"})`,
  neuronNodeInstanceType: `group by (node, instance_type) (neuron_hardware_info)`,
  /** vLLM engine → model pool; lets a pod (either family) be attributed to tenants. */
  podModel: `group by (namespace, pod, model_name) (vllm:num_requests_running)`,
  /** Tenants (LiteLLM team aliases) that have a virtual key routed to each model pool. */
  tenantsByModel: `count by (team_alias, requested_model) (litellm_input_tokens_metric_total{${LITELLM_TENANT}})`,
} as const;

/** Primary NIC on the Bottlerocket nodes; the eni and veth devices are the pod side of the same bytes. */
const NODE_NIC = `device="eth0"`;
/** Whole NVMe devices; partitions (nvme0n1p1) would double count. */
const NODE_DISK = `device=~"nvme[0-9]+n[0-9]+"`;
/** Bottlerocket's data volume (images, kubelet, logs) — /var, /opt and /mnt are the same partition. */
const NODE_DATA_FS = `mountpoint="/local", fstype="xfs"`;
/** Requests only count while the pod is actually scheduled and running. */
const RUNNING_PODS = `on (namespace, pod) group_left () (max by (namespace, pod) (kube_pod_status_phase{phase="Running"}) == 1)`;

/**
 * At a Glance — whole-cluster averages and ratios, one screen. Every query
 * returns a single series suitable for a SignalTile range query.
 */
export const CLUSTER = {
  /* Cluster */
  nodesReady: `sum(kube_node_status_condition{condition="Ready", status="true"})`,
  podsRunning: `sum(kube_pod_status_phase{phase="Running"})`,
  podsPending: `sum(kube_pod_status_phase{phase="Pending"})`,
  restartsPerHour: `sum(increase(kube_pod_container_status_restarts_total[1h]))`,

  /* CPU — 0..1 */
  cpuUtil: `1 - avg(rate(node_cpu_seconds_total{mode="idle"}[${RATE}]))`,
  cpuRequestsRatio: `sum(kube_pod_container_resource_requests{resource="cpu"} * ${RUNNING_PODS}) / sum(kube_node_status_allocatable{resource="cpu"})`,
  cpuBusiestNode: `max(1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[${RATE}])))`,
  cpuThrottledShare: `sum(rate(container_cpu_cfs_throttled_periods_total[${RATE}])) / sum(rate(container_cpu_cfs_periods_total[${RATE}]))`,

  /* Memory — 0..1 */
  memUtil: `1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)`,
  memRequestsRatio: `sum(kube_pod_container_resource_requests{resource="memory"} * ${RUNNING_PODS}) / sum(kube_node_status_allocatable{resource="memory"})`,
  memBusiestNode: `max(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)`,
  oomKilledContainers: `sum(kube_pod_container_status_last_terminated_reason{reason="OOMKilled"})`,

  /* Network — bytes/s */
  netReceiveBytes: `sum(rate(node_network_receive_bytes_total{${NODE_NIC}}[${RATE}]))`,
  netTransmitBytes: `sum(rate(node_network_transmit_bytes_total{${NODE_NIC}}[${RATE}]))`,

  /* Storage */
  nodeDataFsUsed: `1 - sum(node_filesystem_avail_bytes{${NODE_DATA_FS}}) / sum(node_filesystem_size_bytes{${NODE_DATA_FS}})`,
  pvUsed: `sum(kubelet_volume_stats_used_bytes) / sum(kubelet_volume_stats_capacity_bytes)`,
  diskReadBytes: `sum(rate(node_disk_read_bytes_total{${NODE_DISK}}[${RATE}]))`,
  diskWriteBytes: `sum(rate(node_disk_written_bytes_total{${NODE_DISK}}[${RATE}]))`,

  /* Accelerators */
  gpusAllocatedRatio: `count(DCGM_FI_DEV_GPU_UTIL{pod!=""}) / count(DCGM_FI_DEV_GPU_UTIL)`,
  neuronCoresActiveRatio: `count(neuroncore_utilization_ratio) / sum(kube_node_status_capacity{resource="aws_amazon_com_neuroncore"})`,
} as const;

export const CLUSTER_THRESHOLDS = {
  podsPending: { warning: 1, critical: 10 },
  restartsPerHour: { warning: 5, critical: 30 },
  utilisation: { warning: 0.7, critical: 0.9 },
  requestsRatio: { warning: 0.8, critical: 0.95 },
  throttledShare: { warning: 0.05, critical: 0.25 },
  oomKilled: { warning: 1, critical: 5 },
  fsUsed: { warning: 0.75, critical: 0.9 },
} as const;

// --- Agent / collector health (header strip) ---------------------------------
//
// One instant query per aspect, each covering DaemonSets, Deployments and
// StatefulSets at once: kube-state-metrics names the workload with a different
// label per kind, so label_replace normalises it to `workload` and stamps a
// `kind` label before the three vectors are `or`-ed together.
function workloadState(metric: string, kind: string, nameLabel: string, ns: string): string {
  return `label_replace(label_replace(${metric}{namespace=~"${ns}"}, "workload", "$1", "${nameLabel}", "(.+)"), "kind", "${kind}", "", "")`;
}

/** `ns` is a namespace regex (alternation) limiting the payload to the agents' namespaces. */
export function buildAgentQueries(ns: string) {
  return {
    desired: [
      workloadState("kube_daemonset_status_desired_number_scheduled", "daemonset", "daemonset", ns),
      workloadState("kube_deployment_spec_replicas", "deployment", "deployment", ns),
      workloadState("kube_statefulset_replicas", "statefulset", "statefulset", ns),
    ].join(" or "),
    ready: [
      workloadState("kube_daemonset_status_number_ready", "daemonset", "daemonset", ns),
      workloadState("kube_deployment_status_replicas_available", "deployment", "deployment", ns),
      workloadState("kube_statefulset_status_replicas_ready", "statefulset", "statefulset", ns),
    ].join(" or "),
    /** Scrape health per Prometheus job: m="up" is the count of healthy targets, m="targets" the total. */
    scrape: `label_replace(sum by (job) (up), "m", "up", "", "") or label_replace(count by (job) (up), "m", "targets", "", "")`,
    restarts1h: `sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total{namespace=~"${ns}"}[1h])) > 0`,
  } as const;
}
