# Production Monitoring Guide — Token Factory metrics on EKS

This guide lists what the `genai-on-eks-pdx` deployment changes relative to a
default install of this starter kit in order to observe the signals the KCD
Token Factory talk calls out, and why each change exists. It is written as a
checklist for taking the same observability to a production cluster.

The organising idea comes from the talk's "cache-hit cliff" slide: **treat the
prefix-cache hit ratio as an SLI and split it by worker node, tenant and prompt
template version**, then pair it with KV-cache occupancy and preemptions so a
low ratio can be classified as a *capacity bottleneck* (fix: KV memory, e.g.
fp8 KV dtype, more replicas) or a *prompt / routing problem* (fix: prompt
structure, cache-aware routing). Everything below exists to make those splits
measurable.

Contents

1. [Signal map](#1-signal-map)
2. [vLLM engine flags](#2-vllm-engine-flags)
3. [LiteLLM gateway: Prometheus callback and tenant labels](#3-litellm-gateway-prometheus-callback-and-tenant-labels)
4. [Request contract for tenants and templates](#4-request-contract-for-tenants-and-templates)
5. [Scrape configuration](#5-scrape-configuration)
6. [Dashboards and PromQL recipes](#6-dashboards-and-promql-recipes)
7. [Alerting thresholds](#7-alerting-thresholds)
8. [Platform sizing lessons](#8-platform-sizing-lessons)
9. [Known gaps](#9-known-gaps)
10. [Verification checklist](#10-verification-checklist)

---

## 1. Signal map

| Signal from the talk | Metric | Source | Split available | Status in this cluster |
| --- | --- | --- | --- | --- |
| Hit ratio (SLI) | `vllm:prefix_cache_hits_total` / `vllm:prefix_cache_queries_total` | vLLM `/metrics` | engine, **worker node** (join `kube_pod_info`), model pool | on (GPU pools) |
| Cached prompt-token share | `vllm:prompt_tokens_cached_total` / `vllm:prompt_tokens_total` | vLLM | engine, pool | on |
| Where prefill tokens came from | `vllm:prompt_tokens_by_source_total{source}` | vLLM | pool | on |
| Prefill work actually done | `vllm:request_prefill_kv_computed_tokens_*` vs `vllm:request_prompt_tokens_*` | vLLM | pool | on |
| KV-cache occupancy | `vllm:kv_cache_usage_perc` (`vllm:gpu_cache_usage_perc` on the V0 Neuron engine) | vLLM | engine | on |
| Preemptions (capacity signal) | `vllm:num_preemptions_total` | vLLM | engine | on |
| Queue depth / in-flight | `vllm:num_requests_waiting{,_by_reason}`, `vllm:num_requests_running` | vLLM | engine | on |
| TTFT / TPOT | `vllm:time_to_first_token_seconds`, `vllm:time_per_output_token_seconds` | vLLM | pool, engine | on |
| Cache reset events | `kube_pod_start_time{namespace="vllm"}` (engine age) | kube-state-metrics | engine | on |
| Hit ratio **per tenant** | `litellm_input_cached_tokens_metric_total` / `litellm_input_tokens_metric_total` | LiteLLM Prometheus callback | `team_alias`, `api_key_alias`, `end_user`, `requested_model` | **added** |
| Hit ratio **per prompt template version** | same counters, labels `metadata_prompt_template`, `metadata_prompt_template_version` | LiteLLM custom metadata labels | template × version | **added** |
| Who calls each pool (all paths) | `traces_service_graph_request_total{source="beyla",client,server}` | Beyla eBPF | client ns / workload → pool | on |
| Which pod called which pod, and across which AZs | `traces_service_graph_request_total{source="tempo", client_k8s_pod_name, server_k8s_pod_name, client_k8s_node_name, server_k8s_node_name}` | Tempo metrics-generator (span pairing) | pod → pod, node → node | **added** — drives the Service Map pod drill-down and its cross-AZ share; `source` separates it from Beyla's family of the same name |
| Routing scorer signals (prefix-aware, KV-aware) | llm-d inference-scheduler / EPP metrics | Gateway API Inference Extension | — | **not deployed** (see §9) |
| Per-step token consumption of an agent | Langfuse traces (`usage_details`, `session_id`) | LiteLLM → Langfuse | session, tag | on (Langfuse, not Prometheus) |

Everything marked *on* is scraped by the default `vllm-models` PodMonitor or the
kube-prometheus-stack; the two rows marked *added* are the changes in §2–§5.

## 2. vLLM engine flags

Files: `components/llm-model/vllm/model-*.template.yaml`

| Flag | Pools | Why |
| --- | --- | --- |
| `--enable-prefix-caching` | gpt-oss-120b, qwen36-27b-fp8, glm-52-fp8, solar-open2-250b | vLLM's default is *per architecture*: on for dense models, **off for hybrid attention models** (Qwen3.6 is a Gated DeltaNet hybrid — the engine reported `enable_prefix_caching=False` and the pool had zero cache queries). An SLI must not depend on a default, so it is set explicitly everywhere. Turning it on for a hybrid model makes vLLM align attention and Mamba page sizes: the cache block becomes **784 tokens**, so only prefixes longer than that can hit. |
| `--enable-prompt-tokens-details` | same | Makes the OpenAI-compatible server return `usage.prompt_tokens_details.cached_tokens`. Without it the field is `null` and no gateway can attribute cache hits to a caller. This is the single flag that unlocks the tenant and template splits. |
| `strategy.type: Recreate` | gpt-oss-120b (TP=4), glm-52-fp8 (TP=8), solar-open2-250b (TP=8) | Not a metric, but discovered while rolling the flags out: a `RollingUpdate` surge replica of a multi-GPU pool needs a second multi-GPU node that Karpenter may not (and should not) provision; the new pod sat Pending while the old one kept the GPUs. |

Not changed: the Neuron pools (`qwen3-8b-neuron`, `deepseek-r1-qwen3-8b-neuron`).
The optimum-neuron backend (vLLM 0.10 V0 engine, static NxD batching, one
8192-token block per sequence) does not implement prefix caching; the flag is a
no-op at best. Those pools never appear in cache panels. The manifests carry a
comment saying so.

Audit what an engine is actually running with:

```promql
vllm:cache_config_info   # labels: enable_prefix_caching, block_size, num_gpu_blocks, cache_dtype
```

The fp8 KV lever from the talk is `--kv-cache-dtype=fp8` (already set on
glm-52-fp8). Apply it only when the verdict is *capacity bottleneck*: it doubles
the number of KV blocks per GiB but changes nothing when KV has headroom.

## 3. LiteLLM gateway: Prometheus callback and tenant labels

Files: `components/ai-gateway/litellm/values.template.yaml`, `index.mjs`,
`servicemonitor.yaml`

```yaml
litellm_settings:
  callbacks: ["langfuse", "prometheus"]          # index.mjs always appends "prometheus"
  custom_prometheus_metadata_labels:
    - metadata.tenant
    - metadata.prompt_template
    - metadata.prompt_template_version
  enable_end_user_cost_tracking_prometheus_only: true
```

| Change | Why |
| --- | --- |
| `prometheus` callback | Emits `litellm_input_tokens_metric`, `litellm_output_tokens_metric`, `litellm_proxy_total_requests_metric`, latency histograms and, when the backend reports it, `litellm_input_cached_tokens_metric`. This is an open-source feature (only managed-batch metrics are enterprise). |
| `custom_prometheus_metadata_labels` | Turns `metadata.*` fields of the request body (and of the virtual key / team metadata) into metric labels named `metadata_<field>`. This is how a prompt template version becomes a dimension. |
| `enable_end_user_cost_tracking_prometheus_only` | Adds the `end_user` label (the OpenAI `user` field) without turning on end-user spend tracking in the database. |
| Image `v1.98.0` (was `main-v1.81.3-stable`) | `litellm_input_cached_tokens_metric` and the merged requester/key metadata lookup for custom labels do not exist in 1.81.x (verified against the tagged source). Release tags stopped using the `-stable` suffix after 1.83; full releases are `vX.Y.Z`. |
| Postgres / Redis memory 1Gi (was 256Mi) | See §8. |

**Cardinality.** Labels are bounded by design: teams and key aliases are
administrative objects, `end_user` should be a tenant or application id (never
a person or a request id), and template versions are release identifiers. Do
not put session ids or timestamps in metadata that is configured as a label.

## 4. Request contract for tenants and templates

For the tenant and template splits to work, every client must:

1. Call LiteLLM with a **virtual key** that belongs to a team
   (`/team/new` → `/key/generate` with `key_alias` and `team_id`). The master
   key carries no identity and is filtered out of the panels
   (`api_key_alias!="None"`). `components/o11y/traffic-generator/bootstrap-tenants.sh`
   shows the idempotent version of this and stores raw keys in a Secret.
2. Send the caller identity and template version in the body:

   ```json
   {
     "model": "vllm/gpt-oss-120b",
     "user": "support-bot",
     "metadata": {
       "tenant": "support-bot",
       "prompt_template": "support",
       "prompt_template_version": "v3",
       "tags": ["tenant:support-bot", "template:support-v3"],
       "session_id": "support-1788313769",
       "trace_user_id": "support-bot"
     },
     "messages": [ {"role": "system", "content": "<stable prefix>"}, ... ]
   }
   ```

   `user` → `end_user` label; `metadata.tenant/prompt_template/prompt_template_version`
   → `metadata_*` labels; `tags`, `session_id`, `trace_user_id` go to Langfuse
   so a per-step token drill-down shares the same identifiers.
3. Keep the stable part of the prompt (system prompt, tool schemas) **first**
   and volatile values (timestamps, request ids, user data) **last**. Prefix
   caching matches from the start of the token sequence; one volatile token at
   the front makes every request a miss. The demo's `research-agent` tenant
   violates this on purpose so the panels have a live example of the
   "prompt/routing" verdict.
4. Treat a prompt-template change as a release: bump `prompt_template_version`
   so the invalidation shows as a new series starting at zero instead of a
   mysterious dip on the old one.

The traffic generator (`components/o11y/traffic-generator/traffic-generator.yaml`)
implements this contract with four tenants of deliberately different cache
behaviour (`support-bot`, `research-agent`, `code-review`, and `agent-runtime`,
which sends real OpenAI `tools` schemas with `tool_choice: auto`, mostly to the
GLM-5.2 pool); its header comment documents the expected reading of each panel.

The same manifest carries the load lane (tenant `openwebui`): every
self-hosted model LiteLLM exposes gets a pool of workers paced to `LOAD_RPS`
requests per second (a floor; the script defaults to 2 and the Deployment sets
10, see below; workers are paced to `LOAD_RPS × LOAD_HEADROOM`, so a 60 s
window never reads under the floor). `LOAD_RPS_OVERRIDES`
(`vllm/qwen36-27b-fp8=3`) caps a pool that saturates below the common target:
the single-L40S qwen36 pool tops out near 5 rps under this mix (60 in-flight,
12 s mean); 3 rps per gateway is 9 rps for the pool, ~4.5 per replica once the
second one is up.
The worker set runs once per gateway in `LOAD_GATEWAYS` (`litellm kong
kgateway`): Kong and kgateway carry the same per-pool rate as LiteLLM instead
of the ~0.3 rps of the sequential legacy loop, and each vLLM pool sees the sum
(~35 rps on gpt-oss-120b and GLM-5.2, ~9 on qwen36). Kong and kgateway only
reach pools with an `/ai/<route>` (`LOAD_ROUTES`; gpt-oss-120b and qwen36 were
added to Kong, bifrost and kgateway for this — `components/ai-gateway/kong/konnect/`,
`bifrost/bifrost.yaml`, `kgateway/`), receive a plain OpenAI body without the
LiteLLM metadata, and split `NEURON_WORKERS` between them rather than
multiplying it, since the Neuron pools are already at their per-replica
ceiling. The `load-report` lines are per gateway × model.
`solar-open2-250b` (Upstage Solar-Open2, 250B-A15B MoE, BF16, TP=8 on one
B200/H200 node) was added the same way on 2026-09-02: `/ai/solar-open2` on Kong
and kgateway, a bifrost key, a LiteLLM `model_list` entry and the `LOAD_ROUTES`
slug, so it receives the default `LOAD_RPS` (10 rps) from each of the three
gateways once its pod is Ready. The pool serves with
`reasoning_effort: high` as the chat-template default (`model-solar-open2-250b.template.yaml`,
the model default made explicit): the model reasons for up to 131K tokens
before answering and the `solar_open2` parser returns the trace in
`message.reasoning`. The generator therefore classifies `vllm/solar-*` as a
**reasoning** pool, like `vllm/glm-*`: `max_tokens` is
`WEBUI_REASONING_MAX_TOKENS` (256) and most responses end with
`finish_reason=length` once the reasoning channel has consumed the budget —
accepted, since the lane measures gateway and engine behaviour rather than
answers. Callers that need a direct answer pass `"reasoning_effort": "none"`
per request.
Pacing is closed-loop — a worker sleeps only for what its request left of the
period `workers / (LOAD_RPS × LOAD_HEADROOM)` — so the target holds while
end-to-end latency stays under `LOAD_LATENCY_BUDGET` (10 s), and the
rate degrades to `workers / latency` instead of stacking up in-flight requests
when a pool falls behind. Bedrock-backed models are exempt from the target and
kept on the slow `BEDROCK_PACE` cadence. Two facts to keep in mind when reading
the numbers:

| Pool class | Ceiling | Why |
|---|---|---|
| Neuron (`*-neuron`) | ~0.4 rps, measured | the optimum-neuron image is precompiled for inf2.xlarge with `--max-num-seqs=2`, static batching and no chunked prefill: an 80-token prompt costs ~2 s of prefill that also stalls the other slot (TTFT p50 2.0–2.3 s, decode 60 ms/token, ~11 tokens/s aggregate). The lane keeps both slots and the queue full (`NEURON_WORKERS=3`, `NEURON_MAX_TOKENS=16`, short prompts) but cannot push past the engine; the report says `BELOW` against `LOAD_RPS` unless `NEURON_RPS` is set to the accepted ceiling. Raising it needs a rebuilt image (larger batch, shorter buckets) or a larger inf2/trn instance. |
| GPU / reasoning | `workers / latency` | 20 workers by default (`LOAD_LATENCY_BUDGET=10`): qwen36-27b-fp8 decodes at ~55 ms/token, so a 96-token answer takes 5–6 s under the mix and needs well over 10 concurrent workers to hold 2 rps. A pool whose latency climbs past the budget under the mix drops below target and the report says `BELOW` — that is a capacity signal, not a generator bug. |

The Deployment sets `LOAD_RPS=10` (≈11.5 rps on gpt-oss-120b and GLM-5.2,
4.6 on qwen36, ~28 rps through LiteLLM in total) rather than the bare floor
because of the gateway's autoscaler: `components/ai-gateway/litellm/hpa.yaml`
scales the proxy on CPU (target 70% of a 1-core request, min 2, max 10,
scale-up +100% per 15 s with no stabilization, scale-down −50% per minute after
3 min). LiteLLM v1.98.0 spends ~29m CPU per request/s (auth, spend log,
Prometheus callback), so 2 rps per pool (~8 rps) sits at ~17% and only
`minReplicas` keeps the second pod; 28 rps sits near 40%, which is what the HPA
itself needs (>35%) to want two replicas — the `ScalingLimited/TooFewReplicas`
condition on the HPA disappears. A 3× burst (scale the generator Deployment to 3
replicas) pushes the pods past 70% and the HPA adds replicas within one metrics
cycle; scaling the generator back lets it settle to 2 after the 3-minute
stabilization window. The other hops in the request path — Bifrost (the
kgateway backend), the kgateway Envoy proxy and the Kong data plane — run a
single replica with no autoscaler; with `LOAD_GATEWAYS` they each carry
~28 rps and would need their own HPA before being put in front of tenant
traffic.

The model-serving pods are the real target of the load: a pool at one replica
gives the per-pod panels (hit ratio by node, per-engine diagnosis, KV pressure)
nothing to compare. `components/llm-model/vllm/scaledobject-gpu-pools.yaml`
(gpt-oss-120b, qwen36-27b-fp8) and the load trigger in
`model-glm-52-fp8.template.yaml` scale each GPU pool on its own in-flight
sequences — `sum(avg_over_time(vllm:num_requests_running[2m])) +
sum(avg_over_time(vllm:num_requests_waiting[2m]))` per `model_name`, from the
in-cluster Prometheus — with thresholds sized so the LiteLLM-only rate stays at
one replica and the three-gateway rate asks for two (gpt-oss-120b 64 vs ~41 →
~120 in-flight, qwen36 32 vs ~30 → ~60, GLM 40 vs ~21 → ~65), `maxReplicaCount:
2` and a 10-minute scale-down stabilization because a new replica spends 5–10
min loading weights. A second replica is a second GPU node (g6e.12xlarge for
gpt-oss-120b's TP=4, g6e.2xlarge for qwen36, another p6-b200.48xlarge for GLM),
so the cap is also the cost cap.

Payloads rotate per request between three templates so the pool sees a real
mix and the cache panels split them: `webui` (short chat), `rag` (a stable
~500-token runbook excerpt plus a question — high prefix reuse) and `extract`
(one log line to JSON — short output). The lane prints one `load-report` line
per model every `LOAD_REPORT` seconds with achieved rps, non-200 count and mean
latency, which is the quickest way to confirm the target without Prometheus.

## 5. Scrape configuration

| Target | Object | Notes |
| --- | --- | --- |
| vLLM engines | `PodMonitor vllm/vllm-models` (default in the kit) | `port: http`, `/metrics`, 30s. Labels `pod`, `model_name`. |
| LiteLLM | `ServiceMonitor litellm/litellm-metrics` (`components/ai-gateway/litellm/servicemonitor.yaml`) | Since LiteLLM v1.9x `/metrics/` **requires a bearer token** by default. The chart's own ServiceMonitor cannot attach one, so the kit ships its own with `authorization.credentials` → Secret `litellm-masterkey`. Do **not** set `require_auth_for_metrics_endpoint: false` when the proxy is behind a public ingress — that would publish per-tenant usage. In production mint a dedicated read-only key for scraping instead of the master key. |
| Beyla, DCGM, NFM | ServiceMonitors from their components | unchanged |
| Neuron nodes | `PodMonitor neuron-monitor/neuron-monitor` (`components/o11y/neuron-monitor`) | `neuron-monitor` DaemonSet (privileged, `hostNetwork` so IMDS fills `instance_type` / `availability_zone`), 15s. A relabeling adds `node`; the model pod is joined client-side through `kube_pod_info` because `--enable-k8s-info` is not supported on EKS Auto Mode. |
| kube-state-metrics | kube-prometheus-stack | provides `kube_pod_info` (pod→node join), `kube_pod_start_time` (engine age), `kube_node_status_capacity{resource="aws_amazon_com_neuroncore"}` and `kube_pod_container_resource_requests` (accelerator capacity vs. requests) |

The Prometheus in this kit has empty `serviceMonitorSelector` /
`podMonitorSelector`, so monitors in any namespace are picked up. A production
Prometheus with label selectors needs the `release: prometheus` label that the
kit's monitors already carry.

## 6. Dashboards and PromQL recipes

Two consumers read the same PromQL:

- Grafana **Token Factory Overview**
  (`components/nvidia-platform/monitoring/dashboards/token-factory-overview.json`,
  row "캐시 히트율 분해", panels 600–609).
- The **traffic-dashboard** web app
  (`components/gui-app/traffic-dashboard`, section *Cache Hit Rate*;
  queries in `app/src/lib/queries.ts`, verdict rule in `app/src/lib/cache.ts`).

### Accelerator identity and Neuron telemetry

vLLM's engine metrics are named after GPUs whatever silicon they run on
(`vllm:gpu_cache_usage_perc`, `--gpu-memory-utilization`), and the DCGM
exporter only sees NVIDIA devices, so an inf2 pool is indistinguishable from an
L40S pool in the vLLM panels alone. Two additions fix that:

- **neuron-monitor DaemonSet** (`components/o11y/neuron-monitor`) exports
  `neuroncore_utilization_ratio`, `neuron_runtime_memory_used_bytes`,
  `neuroncore_memory_usage_<kind>`, `execution_latency_seconds{percentile}`,
  `execution_status_total`, `execution_errors_total`, `hardware_ecc_events_total`
  and `neuron_hardware_info{instance_type, neuron_device_count, …}` per node.
  Grafana dashboard: **AWS Neuron (Inferentia / Trainium) Monitoring**
  (`dashboards/neuron-monitor.json`); traffic-dashboard: the *AWS Inferentia /
  Trainium* tab of the **GPU & Accelerators** section (`NEURON` in `queries.ts`).
- **Accelerator fleet table** (top of *GPU & Accelerators*, `ACCELERATORS` in
  `queries.ts`) lists every accelerator type both exporters can see — NVIDIA
  models from DCGM `modelName`, Neuron generations from the instance family —
  on the same columns: nodes, devices reported vs. advertised to the scheduler,
  devices allocated to pods, average utilisation, memory in use and a
  *Serving / Allocated, idle / Unallocated* state. The tab selector switches the
  detail panels (DCGM or neuron-monitor) below it; a cluster with no GPU node
  opens on the Neuron tab.
- **Accelerator resolution per node** (`app/src/lib/accelerator.ts`) merges
  DCGM `modelName` and the Neuron instance family into one `node → accelerator`
  map. It feeds the Service Map *Accelerator* filter (was *GPU*), the
  *Accelerator* column of the per-engine cache table, and the
  `No prefix cache (Neuron)` verdict for Neuron engines, whose KV gauge is
  always 0.

"Allocated but idle" accelerators — paid for, not computing — are surfaced as a
state per node: cores attached to a runtime
(`count by (node) (neuroncore_utilization_ratio)`) with mean utilisation below
5 %. The same rule for GPUs is
`sum by (node) (DCGM_FI_DEV_GPU_UTIL{pod!=""}) / count by (node) (DCGM_FI_DEV_GPU_UTIL{pod!=""}) < 5`
next to `kube_pod_container_resource_requests{resource="nvidia_com_gpu"}`.

Recipes (`5m` rate window; `$__rate_interval` in Grafana):

```promql
# Hit ratio by worker node (KV cache is node-local)
sum by (node, model_name) (
  sum by (pod, model_name) (rate(vllm:prefix_cache_hits_total[5m]))
  * on (pod) group_left (node) max by (pod, node) (kube_pod_info{namespace="vllm"}))
/
sum by (node, model_name) (
  sum by (pod, model_name) (rate(vllm:prefix_cache_queries_total[5m]))
  * on (pod) group_left (node) max by (pod, node) (kube_pod_info{namespace="vllm"}))

# Cached prompt-token share per tenant (LiteLLM). The cached counter is sparse
# (only emitted when cached_tokens > 0), so keep zero-hit tenants with `or 0 * denominator`.
( sum by (team_alias, api_key_alias) (rate(litellm_input_cached_tokens_metric_total{api_key_alias!="None"}[5m]))
  or 0 * sum by (team_alias, api_key_alias) (rate(litellm_input_tokens_metric_total{api_key_alias!="None"}[5m])) )
/ sum by (team_alias, api_key_alias) (rate(litellm_input_tokens_metric_total{api_key_alias!="None"}[5m]))

# Same, per prompt template version
( sum by (metadata_prompt_template, metadata_prompt_template_version) (rate(litellm_input_cached_tokens_metric_total{metadata_prompt_template!="None"}[5m]))
  or 0 * sum by (metadata_prompt_template, metadata_prompt_template_version) (rate(litellm_input_tokens_metric_total{metadata_prompt_template!="None"}[5m])) )
/ sum by (metadata_prompt_template, metadata_prompt_template_version) (rate(litellm_input_tokens_metric_total{metadata_prompt_template!="None"}[5m]))

# Verdict per engine: 0 healthy, 1 degraded, 2 prompt/routing, 3 capacity bottleneck
clamp_max(
  (H < bool 0.5) * (1 + (K <= bool 0.6) + 2 * clamp_max((K >= bool 0.85) + (P > bool 0), 1)), 3)
and on (pod, model_name) (Q > 0.01)
# where H = hit ratio, K = vllm:kv_cache_usage_perc, P = preemption rate, Q = query rate, all by (pod, model_name)

# What a miss costs: TTFT p95 by pool
histogram_quantile(0.95, sum by (le, model_name) (rate(vllm:time_to_first_token_seconds_bucket[5m])))

# Prefill work removed by the cache: prompt tokens vs computed tokens per request
sum by (model_name) (rate(vllm:request_prompt_tokens_sum[5m])) / sum by (model_name) (rate(vllm:request_prompt_tokens_count[5m]))
sum by (model_name) (rate(vllm:request_prefill_kv_computed_tokens_sum[5m])) / sum by (model_name) (rate(vllm:request_prefill_kv_computed_tokens_count[5m]))
```

Reading rule (from the talk): hit ratio low **and** KV ≥ 85% or preemptions > 0
→ capacity (KV memory lever); hit ratio low **and** KV ≤ 60% → prompt or routing
(template, volatile prefix, cache-blind routing); a TTFT step aligned with a hit
drop is the cliff, a TTFT step with a flat ratio is queueing.

## 7. Alerting thresholds

Suggested starting points; tune per pool once a week of data exists.

| Alert | Expression sketch | For | Severity |
| --- | --- | --- | --- |
| Cache-hit cliff | pool hit ratio `< 0.5` while query rate `> 0.05/s` | 10m | warning |
| Capacity bottleneck | `rate(vllm:num_preemptions_total[5m]) > 0` or `vllm:kv_cache_usage_perc > 0.85` | 5m | critical |
| Tenant regression | tenant cached share drops `> 30` points vs 1h ago with input rate unchanged | 15m | warning |
| Template rollout not warming | new `metadata_prompt_template_version` still `< 0.3` cached share after 30m of traffic | 30m | warning |
| Cache reset storm | `changes(kube_pod_start_time{namespace="vllm"}[1h]) > 2` per pool | — | warning |
| Gateway scrape down | `up{job=~".*litellm.*"} == 0` | 5m | critical |

## 8. Platform sizing lessons

These are not metrics changes but they were the root cause of two gateway
outages during this work and would be the first thing to fix in production.

| Change | Where | Why |
| --- | --- | --- |
| Langfuse and LiteLLM Postgres/Redis memory 256Mi → **1Gi** | `components/o11y/langfuse/values.template.yaml`, `components/ai-gateway/litellm/values.template.yaml` | Under node memory pressure `pg_isready` could not answer within the 5s liveness timeout; kubelet restarted Postgres every few minutes, the proxy lost its DB and went 0/1. 256Mi is the Bitnami chart default, sized for a laptop. |
| Default NodePool: `instance-cpu > 3`, `instance-memory > 15359` MiB, NodeClass `default-perf` with `ephemeralStorage.iops: 16000`, `throughput: 1000` | `terraform/modules/eks-auto-mode/eks-addons.tf` | Karpenter kept consolidating platform pods onto 2 vCPU / 4 GiB spot nodes (c6gn.large, c8g.large) running at 85–90% memory with 13–16 pods each, of which most were unready. Both outages traced back to such a node. **This change is in Terraform but had not been applied to the live cluster at the time of writing**; apply with the NodeClass/NodePool manifests before relying on the rest of this guide. Cost note: 16k IOPS / 1000 MiB/s gp3 is ≈ $100 per node-month; 8000 / 500 is ≈ $40 and is usually enough. |
| `Recreate` strategy for multi-GPU pools | vLLM manifests | §2 |
| Prometheus TSDB on a **500Gi gp3 PVC** (`storageClassName: ebs`), `retentionSize: 475GiB` | `config.json` → `platform.monitoring.{enablePersistentStorage,prometheusStorageSize,prometheusStorageClass}`, `components/nvidia-platform/monitoring/values.template.yaml` | The kit's default is `enablePersistentStorage: false`, i.e. an emptyDir: the first Karpenter drift replacement after the NodePool change moved the Prometheus pod and erased every metric collected so far. Prometheus needs block storage (it does not support NFS/EFS), hence a dedicated `prometheusStorageClass` instead of the platform-wide `efs` default. Note that `helm upgrade --wait` on kube-prometheus-stack blocks on the node-exporter DaemonSet, which cannot be fully ready while nodes are being drained. |
| traffic-dashboard: startup probe, 5s probe timeouts, `cpu: 250m` request, node affinity `eks.amazonaws.com/instance-cpu > 3`, ALB `healthcheck-path: /signin` | `components/gui-app/traffic-dashboard/traffic-dashboard.template.yaml` | The dashboard pod landed on a 2 vCPU spot node at 90% requested CPU, took >60s to boot and was killed by a 1s-timeout liveness probe in a loop; the ALB answered 503. Separately, the ALB health check hit `/`, which redirects to `/signin` (302), so the target had always been *unhealthy* and only served through fail-open — any restart became an outage instead of a drain. |
| Langfuse ClickHouse on a dedicated **16 vCPU / 64 GiB** On-Demand node (NodePool `clickhouse`, `instance-cpu: 16`, `instance-memory > 61439`, limits `cpu: 32`), chart `resources.requests.cpu: 12`, `memory: 48Gi` | `terraform/modules/eks-auto-mode/eks-addons.tf`, `components/o11y/langfuse/values.template.yaml` | On the previous 8 vCPU node ClickHouse ran at 7.6 vCPU with disk I/O at ~0: the load was 300 point-lookup `SELECT ... FROM observations WHERE id = ?` per second (≈80k rows scanned each) issued by the ingestion worker, not inserts or reads from the UI. The CPU *request* deliberately claims the node so nothing is ever co-scheduled with it. The NodePool CPU limit is two nodes so the replacement can be provisioned while the old node still runs; the `Drifted` budget is 0, so a NodePool change alone does not move ClickHouse — the larger pod request does. Kept in-cluster rather than ClickHouse Cloud: after the change below the node idles at 0.3 vCPU for ~40 rps of gateway traffic. |
| Langfuse worker **3 replicas × 2 CPU / 4 GiB** and `LANGFUSE_SKIP_INGESTION_CLICKHOUSE_READ_MIN_PROJECT_CREATE_DATE=2026-01-01` | `components/o11y/langfuse/values.template.yaml` (`langfuse.worker`, `langfuse.additionalEnv`) | Langfuse merges every incoming event with the row already in ClickHouse, which is the 300 SELECT/s above. The Langfuse scaling guide allows skipping that read for projects created after a date (the only project here dates from 2026-06-17); the documented trade-off is a possible duplicate in the event history when an event is updated after its S3 blob was lifecycle-deleted. Effect measured 2026-09-03: a 195k-job BullMQ backlog (17.5 h of lag after the 2026-09-02 node outage) drained to 0 in 15 minutes; the single worker had been draining ~16 jobs/s net. Scale workers on CPU > 50 % (queue depth: `redis-cli llen bull:ingestion-queue:wait`). |
| `karpenter.sh/do-not-disrupt: "true"` on the Langfuse **Valkey (Redis) and Postgres** pods | `components/o11y/langfuse/values.template.yaml` (`redis.primary.podAnnotations`, `postgresql.primary.podAnnotations`) | Both are single-replica StatefulSets on the spot `default` pool. On 2026-09-03 08:05Z Karpenter evicted them as `Underutilized` to consolidate the node: Valkey was gone for ~1 min, all three workers exhausted their 10 Redis reconnects and exited (`could not renew lock for job`), the web pod answered 500 until Postgres re-attached its EBS volume. Nothing was lost (both have EBS PVCs), but the queue store and the primary DB should never be consolidation candidates; the annotation makes Karpenter skip the node they sit on. It does not protect against a Spot interruption — move them to an On-Demand pool for that. |
| Bifrost OTel plugin `plugin_span_filter: {mode: include, plugins: []}` | `components/ai-gateway/bifrost/bifrost.yaml` (ConfigMap is copied into `/app/data` at start → `rollout restart` after editing) | Bifrost exported ~32 spans per request to Langfuse: one `plugin.<name>.<stage>` span per plugin hook (logging, routing, telemetry, governance, otel). Those were 90 % of the rows the Langfuse worker wrote (1.14M SPAN vs 0.11M GENERATION per hour) and carried no model, token or latency data. The filter (Bifrost ≥ v2.0.0) drops plugin spans and reparents their children; the request, `transport-context` and provider-call spans stay. |
| Tempo `metaMonitoring.serviceMonitor.enabled: true` | `components/o11y/tempo/values.template.yaml` | Tempo's own counters (`tempo_receiver_refused_spans`, `tempo_discarded_spans_total{reason}`, `tempo_metrics_generator_processor_service_graphs_dropped_spans`, `..._spans_discarded_total{reason}`) were not scraped, so the metrics-generator had been silently non-functional (404 remote-write URL, 4 MiB gRPC cap, slack and store overflow) for weeks. Now six `tempo/*` jobs are `up`. |

**A pool that is registered nowhere gets no traffic.** `glm-52-fp8` (GLM-5.2,
TP=8, one B200 node) had been running for weeks, answered direct requests in
about one second per 200 tokens, and showed up on the GPU & Accelerators fleet
table as *Allocated, idle*: 8 GPUs held, 0% utilization, zero requests. The
pool was healthy; it simply existed in none of the gateways. Every one of the
following has to be updated when a pool is added, because each hop keeps its
own model registry and none of them discovers vLLM Services:

| Hop | Object | Where |
| --- | --- | --- |
| LiteLLM | `model_list` entry `vllm/<pool>` → `http://<pool>.vllm:8000/v1` | `components/ai-gateway/litellm/values.rendered.yaml` (`index.mjs` regenerates it only for pools with `deploy: true` in `config.json` **and** a running pod) |
| LiteLLM tenant keys | `models` allow-list on every virtual key | `components/o11y/traffic-generator/bootstrap-tenants.sh` — keys are minted with an explicit list, so a new pool returns 401 for tenants until they are re-minted |
| Kong Konnect | `KongService` + `KongRoute /ai/<pool>` + `ai-proxy` plugin + `KongPluginBinding` | `components/ai-gateway/kong/konnect/kong-<pool>.yaml` |
| bifrost | `vllm` provider key with `models: ["<pool>"]` | `components/ai-gateway/bifrost/bifrost.yaml` (ConfigMap is copied at start: rollout restart after a change) |
| kgateway | `Backend` (→ bifrost) + `HTTPRoute /ai/<pool>` rewriting to `/v1` | `components/ai-gateway/kgateway/kgateway-<pool>.yaml`; without the bifrost key the route exists but every call fails |
| Traffic generator | a lane per hop, and the pool in the tenant rotations | `traffic-generator.yaml`; the Open WebUI lane picks the pool up from LiteLLM's `/v1/models` on its own |

The fleet table's *Allocated, idle* state is the alert for this condition; the
Beyla service map confirms it (no edge into the pool from any gateway).

The checklist was exercised again for `solar-open2-250b` (`components/llm-model/vllm/model-solar-open2-250b.template.yaml`,
`kong-solar-open2.yaml`, `kgateway-solar-open2.yaml`, a bifrost key, a
`values.rendered.yaml` entry, `LOAD_ROUTES`). Two things to know about a second
8-GPU pool: **capacity**, not configuration, is the usual blocker — the first
launch attempts failed with `InsufficientInstanceCapacity` for Spot p6-b200 and
On-Demand p5en, and Karpenter simply keeps retrying every few minutes; and the
`glm-52-fp8-business-hours` cron releases GLM's B200 node at 18:00 KST, at which
point a Pending 8-GPU pod schedules onto that node instead of a new one (this is
exactly what happened on the first day). Solar carries the same schedule,
`solar-open2-250b-business-hours` (Asia/Seoul 09:00–18:00 Mon–Fri, idle 0,
max 1, cooldown 300 s), so outside the window both 8-GPU pools are at 0 and
neither node is billed (p6-b200 Spot ~$41/h, On-Demand ~$98/h); every weekday
morning the two pools compete for 8-GPU capacity, and one of them staying
Pending until capacity appears is expected. Because the cron keeps the pool
absent outside business hours anyway, the LiteLLM entry is registered up front;
as with GLM, requests during the 09:00 load ramp (first start: ~500GB download
to EFS, later starts 15–30 min from EFS) fail until the pod is Ready, and the
generator's `load-report` shows the pool `BELOW` target in that window.

**Operational note on `*.rendered.yaml` files.** The `components/**/*.rendered.yaml`
files are build artefacts of `index.mjs`, not a source of truth: they carry the
variables of whichever run last produced them. Re-applying an old render with
`kubectl apply` silently reverts anything set since (during this work a July
render of the traffic-dashboard dropped the `/prometheus` route prefix from
`PROMETHEUS_URL`, and every panel failed with a JSON parse error because
Prometheus answered `404 page not found`). Change the `*.template.yaml` and
re-run the component's `index.mjs`, or edit the rendered file in the same step
and diff it against the live object before applying.

## 9. Known gaps

- **Routing scorer signals are not observable** because there is no Gateway API
  Inference Extension / llm-d inference scheduler (EPP) in this cluster; models
  are reached through plain Services and LiteLLM `simple-shuffle`. With one
  replica per pool the "which node did the request go to" question from the
  talk does not arise. Deploying llm-d with `PREFIX_AWARE` / `KVCACHE_AWARE`
  scorers and ≥ 2 replicas is the prerequisite for the routing half of the story.
- **Neuron pools** have no prefix cache (optimum-neuron backend), so tenants that
  are routed to them by Kong / kgateway / LiteLLM have request and token
  metrics but no cached-token share. Their accelerator health is covered by
  neuron-monitor (§6), but per-pod attribution of NeuronCores relies on the
  one-model-pod-per-node layout: `neuron-monitor --enable-k8s-info` is not
  supported on EKS Auto Mode.
- **Hybrid models** (Qwen3.6) cache in 784-token blocks; prefixes shorter than
  that never hit. Design prompts (or pick the pool) accordingly.
- **Per-tenant hit ratio is a cached-token share**, not a query hit ratio: the
  gateway sees tokens, not cache queries. The two agree in direction; the
  engine-side ratio remains the SLI, the tenant share is the attribution.
- **Per-step token consumption** of an agent loop lives in Langfuse traces, not
  in Prometheus; the shared `session_id` / tags are what link the two.
- **Langfuse ingestion lag has no alert.** The UI shows whatever the worker has
  written; after the 2026-09-02 outage it silently showed data 17.5 h old while
  every pod was `Running`. The lag is visible only from the BullMQ queue depth
  (`bull:ingestion-queue:wait`, `bull:otel-ingestion-queue:wait`) or from
  `max(start_time)` of rows written in the last minute in ClickHouse (§10).
  Langfuse can publish queue depth to CloudWatch
  (`ENABLE_AWS_CLOUDWATCH_METRIC_PUBLISHING=true`); there is no Prometheus
  exporter for it in this kit yet. Alertmanager is disabled
  (`ALERTMANAGER_ENABLED`), so none of the kube-prometheus-stack rules pages
  anyone either; the firing `KubeScheduler/KubeProxy/KubeControllerManagerDown`
  are EKS control-plane noise, not incidents.
- **Tempo drops ~0.5 % of spans as `trace_too_large`** (`tempo_discarded_spans_total{reason="trace_too_large"}` ≈ 13 of ≈ 2,500 spans/s at the distributor, visible since `metaMonitoring` was enabled). The default `max_bytes_per_trace` is 5 MB; the traces that exceed it are long-lived ones that keep collecting Beyla and Bifrost children under one trace_id (a load-generator worker loop, or an agent session). Raising the limit only postpones the cut and grows the ingesters; the fix is to break the trace at the session boundary (new `traceparent` per request in the generator) and, if a single request still exceeds 5 MB, raise `overrides.defaults.global.max_bytes_per_trace` for that tenant. Not yet done.
- LiteLLM stringifies missing metadata as the label value `"None"`; filter it
  in queries, do not rely on an empty string.
- **Autoscaling covers LiteLLM and the GPU pools, not the other hops.** Bifrost,
  the kgateway Envoy proxy and the Kong data plane are single-replica
  Deployments without an HPA, yet with `LOAD_GATEWAYS` each carries ~28 rps —
  watch their CPU before adding tenant traffic. The KEDA `ScaledObject`
  `vllm/vllm-scaledobject` scales `qwen3-8b-neuron` on
  `avg(vllm:num_requests_waiting{namespace="vllm"})` — an average over *every*
  vLLM pool, so a saturated GPU pool (observed with qwen36 at 60 in-flight)
  adds Neuron replicas and inf2 nodes that do nothing for the queue that
  triggered it. Scope the query to `model_name="qwen3-8b-neuron"`, or better,
  move the Neuron pools to the same request-based trigger per pool. The
  `glm-52-fp8-business-hours` ScaledObject is a cron (09:00–18:00 Asia/Seoul,
  weekdays, idle 0): outside that window GLM traffic fails and the load lane
  reports `BELOW` with non-200s — expected, not an outage.

## 10. Verification checklist

```bash
# Engines: prefix caching on, prompt token details returned
kubectl -n vllm get deploy -o json | jq -r '.items[] | "\(.metadata.name)\t\(.spec.template.spec.containers[0].args | map(select(startswith("--enable-prefix-caching") or startswith("--enable-prompt-tokens-details"))) | join(" "))"'
curl -s http://gpt-oss-120b.vllm:8000/v1/chat/completions -d '{...}' | jq .usage.prompt_tokens_details   # cached_tokens must be a number

# Prometheus: engine config and counters
vllm:cache_config_info{enable_prefix_caching="True"}
sum by (model_name) (rate(vllm:prefix_cache_queries_total[5m])) > 0

# LiteLLM: scrape up, tenant labels, cached tokens
up{job=~".*litellm.*"} == 1
count by (team_alias, api_key_alias) (litellm_input_tokens_metric_total{api_key_alias!="None"})
sum by (team_alias) (rate(litellm_input_cached_tokens_metric_total[5m])) > 0

# Tenants exist and the generator uses them
kubectl -n litellm get secret traffic-tenant-keys
kubectl -n litellm logs deploy/traffic-generator --tail=20      # lines should read tenant=... template=...

# Every pool receives traffic through every hop (a pool missing from a gateway
# shows as "Allocated, idle" on the fleet table; see §8)
sum by (model_name) (increase(vllm:request_success_total[30m])) == 0   # must return no series
kubectl -n litellm logs deploy/traffic-generator --tail=300 | grep -c " 200 .*glm-52"   # Kong, kgateway, LiteLLM and direct lanes

# Load lane holds its target on every self-hosted pool (Bedrock is exempt)
kubectl -n litellm logs deploy/traffic-generator --tail=2000 | grep load-report | tail -8   # every non-bedrock line should say "ok"
sum by (model_name) (rate(vllm:request_success_total{model_name!~".*neuron"}[5m])) < 2   # must return no series; Neuron pools are capped near 0.4 (see §4)

# LiteLLM keeps >= 2 replicas on load, not only on minReplicas (see §4)
kubectl -n litellm get hpa litellm-hpa            # TARGETS cpu should read >35%/70% at the default LOAD_RPS=10; 2 replicas, no TooFewReplicas condition
kubectl -n litellm scale deploy/traffic-generator --replicas=3 && sleep 240 && kubectl -n litellm get hpa litellm-hpa   # burst: REPLICAS 3-4
kubectl -n litellm scale deploy/traffic-generator --replicas=1   # back to steady state; REPLICAS returns to 2 after ~5 min

# Kong and kgateway carry the same per-pool rate as LiteLLM (see §4)
kubectl -n litellm logs deploy/traffic-generator --tail=3000 | grep load-report | grep -E "gateway=(kong|kgateway)" | tail -10   # rps within ~10% of the litellm line for the same model
sum by (model_name) (rate(vllm:request_success_total{model_name=~"gpt-oss-120b|glm-52-fp8"}[5m])) < 30   # must return no series at the default LOAD_RPS=10 x 3 gateways

# Model-serving pods hold >= 2 replicas on load (KEDA in-flight triggers, see §4)
kubectl -n vllm get scaledobject,hpa                              # gpt-oss-120b-load / qwen36-27b-fp8-load / glm-52-fp8-business-hours: REPLICAS 2, TARGETS above threshold
kubectl -n vllm get pods -l 'app in (gpt-oss-120b,qwen36-27b-fp8,glm-52-fp8,solar-open2-250b)' -o wide   # two Running pods per pool, on different GPU nodes

# Langfuse ingestion keeps up: both queues near 0 and the newest written row is recent
kubectl -n langfuse exec langfuse-redis-primary-0 -- sh -c 'export REDISCLI_AUTH=$REDIS_PASSWORD; redis-cli --no-auth-warning llen bull:ingestion-queue:wait; redis-cli --no-auth-warning llen bull:otel-ingestion-queue:wait'
kubectl -n langfuse exec langfuse-clickhouse-shard0-0 -- clickhouse-client --password "$CLICKHOUSE_PASSWORD" -q "SELECT now() - max(start_time) AS lag_seconds FROM observations WHERE created_at > now() - INTERVAL 1 MINUTE"
kubectl -n langfuse exec langfuse-clickhouse-shard0-0 -- clickhouse-client --password "$CLICKHOUSE_PASSWORD" -q "SELECT query_kind, count() FROM system.query_log WHERE event_time > now() - INTERVAL 5 MINUTE AND type='QueryFinish' GROUP BY query_kind"   # Insert/AsyncInsertFlush only; a flood of Select means the skip-read env var is not in effect

# Tempo pipeline is healthy and scraped (all tempo/* jobs up; refused / dropped at 0)
# PromQL: count by (job) (up{namespace="tempo"})
# PromQL: sum(rate(tempo_receiver_refused_spans[5m])) ; sum by (reason) (rate(tempo_discarded_spans_total[5m])) ; sum(rate(tempo_metrics_generator_processor_service_graphs_dropped_spans[5m]))

# Grafana picked up the dashboard (sidecar)
kubectl -n monitoring exec deploy/prometheus-grafana -c grafana -- ls /tmp/dashboards | grep token-factory
```
