# NVIDIA Dynamo Platform on Kubernetes

Deploy and serve LLM models with NVIDIA Dynamo on Kubernetes (on-premises) and Amazon EKS.

**Implemented**: GPU Operator, Monitoring (Prometheus + Grafana + Dynamo/DCGM/KVBM/Benchmark Pareto dashboards), Dynamo Platform (Operator, etcd, NATS), Dynamo vLLM (aggregated/disaggregated, KV Router, KVBM), AIPerf Benchmark (concurrency sweep, multi-turn, sequence distribution, prefix cache → Pushgateway + Pareto dashboard), AIConfigurator (Quick Estimate + SLA-driven deploy via DGDR).

## Architecture

```
                    +-----------------------+
                    |      CLI              |
                    |  ./cli nvidia-platform |
                    +----------+------------+
                               |
    +--------+--------+--------+--------+--------+
    |        |        |        |        |        |
  GPU Op   Monitor   Dynamo   Dynamo   Benchmark  AIConfig
  DCGM     Prom,     Platform  vLLM    AIPerf,    Quick Est,
           Grafana   etcd,     agg/     Pushgateway SLA Deploy
                    Operator   disagg   Pareto
```

## Components

| Component | Description | CLI Command |
|-----------|-------------|-------------|
| GPU Operator | NVIDIA GPU resource management | `./cli nvidia-platform gpu-operator install` |
| Monitoring | Prometheus + Grafana + Dynamo/DCGM/KVBM/Benchmark dashboards | `./cli nvidia-platform monitoring install` |
| Dynamo Platform | CRDs, Operator, etcd, NATS, Grove, KAI Scheduler | `./cli nvidia-platform dynamo-platform install` |
| Dynamo vLLM Serving | vLLM model deployment (agg/disagg, KV Router, KVBM) | `./cli nvidia-platform dynamo-vllm install` |
| AIPerf Benchmark | Concurrency sweep, multi-turn, seq distribution, prefix cache → Pushgateway + Pareto dashboard | `./cli nvidia-platform benchmark install` |
| AIConfigurator | TP/PP recommendation (Quick Estimate) + SLA-driven profile + plan + deploy (DGDR) | `./cli nvidia-platform aiconfigurator install` |

## Installation Order

```bash
# === Standard Path ===
# 0. (K8s only) Install Ingress controller if not present
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx --force-update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace --set controller.service.type=NodePort --wait
# EKS: AWS Load Balancer Controller should be pre-installed (EKS addon or Terraform)

# 1. Monitoring (Prometheus + Grafana) — install first so GPU Operator
#    auto-detects ServiceMonitor CRDs and enables DCGM metrics scraping.
#    Also auto-detects Ingress controller to expose Grafana/Prometheus.
./cli nvidia-platform monitoring install

# 2. GPU Operator (detects Prometheus → creates DCGM ServiceMonitor)
./cli nvidia-platform gpu-operator install

# 3. Dynamo Platform (auto-detects Prometheus and sets prometheusEndpoint)
./cli nvidia-platform dynamo-platform install

# 4. Deploy a model
./cli nvidia-platform dynamo-vllm install

```

---

## Platform Modes

### K8s Mode (On-premises)

**Environment**: `PLATFORM=k8s` in `.env`

#### Prerequisites (user must prepare)

| Requirement | Details |
|-------------|---------|
| Kubernetes v1.33+ | kubeadm, kubelet, kubectl |
| NVIDIA Driver 580+ | Pre-installed on worker nodes |
| NVIDIA Container Toolkit | CDI configured (`nvidia-ctk cdi generate`) |
| Fabric Manager | Required for H100 SXM / NVSwitch GPUs |
| StorageClass (RWX) | For shared model cache (e.g., NFS, CephFS) |

#### Auto-installed by CLI

The following are automatically installed/detected during `dynamo-platform install`:

| Component | Condition | Action |
|-----------|-----------|--------|
| `local-path` StorageClass | Not found | Auto-install local-path-provisioner |
| `ingress-nginx` | Not found (K8s mode only) | Prompt to install |
| Prometheus (`prometheusEndpoint`) | Detected if `monitoring` installed | Auto-configure |
| GPU Operator | Detected | Status check only (install via `gpu-operator install`) |

#### Storage

The CLI uses **two different StorageClasses** depending on purpose:

| StorageClass | Purpose | Access Mode | Used By |
|--------------|---------|-------------|---------|
| `nfs` (config: `platform.k8s.storageClass`) | Model cache PVC | ReadWriteMany | `dynamo-vllm` (model download) |
| `local-path` (default for etcd/NATS) | etcd, NATS persistence | ReadWriteOnce | `dynamo-platform` |

> Note: `config.json`'s `platform.k8s.storageClass` is used for model cache PVC. etcd/NATS StorageClass defaults to `local-path` in the Dynamo Platform Helm values.

#### Access

**Monitoring (Ingress)** — Grafana and Prometheus are exposed via Ingress if an Ingress controller is installed:

```bash
kubectl get svc -n ingress-nginx     # Find NodePort
http://<node-ip>:<node-port>/grafana             # Grafana
http://<node-ip>:<node-port>/prometheus          # Prometheus
```

**vLLM API (port-forward)** — each model is accessed via its ClusterIP service:

```bash
# In-cluster URL (for other services / LiteLLM):
http://<deployment>-frontend.dynamo-system:8000/v1

# Quick test via port-forward:
kubectl port-forward svc/<deployment>-frontend 8000:8000 -n dynamo-system --address 0.0.0.0 &
curl localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "<served-model-name>", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 50, "stream": false}'
```

**Remote access (SSH tunnel)**:

```bash
ssh -N -L <local-port>:<node-ip>:<node-port> <user>@<remote-host>
# Grafana:    http://localhost:<local-port>/grafana
# Prometheus: http://localhost:<local-port>/prometheus
```

---

### EKS Mode (Amazon Web Services)

**Environment**: `PLATFORM=eks` in `.env`

#### Prerequisites (user must prepare)

| Requirement | Details |
|-------------|---------|
| EKS Cluster v1.33+ | GPU node groups (g6e, p5, p4d, etc.) |
| NVIDIA Driver 580+ | Pre-installed by EKS GPU AMI |
| HuggingFace Token | For gated model access (K8s Secret) |

#### Auto-installed by CLI

| Component | Condition | Action |
|-----------|-----------|--------|
| GPU Operator | `gpu-operator install` | Helm install (GFD + DCGM + GDS) |
| EFS CSI Driver | Not found | Auto-install via EKS addon |
| EFS StorageClass | Not found | Prompt to select/create EFS + StorageClass |
| Prometheus (`prometheusEndpoint`) | Detected if `monitoring` installed | Auto-configure |

#### EFS Setup

The Dynamo Platform installer auto-detects and configures EFS. Manual setup:

```bash
# Create EFS
aws efs create-file-system --region $REGION --tags Key=Name,Value=dynamo-efs

# Install EFS CSI Driver
aws eks create-addon --cluster-name $EKS_CLUSTER_NAME --addon-name aws-efs-csi-driver
```

#### Storage

| StorageClass | Purpose | Access Mode | Backend |
|--------------|---------|-------------|---------|
| `efs` | Model cache PVC | ReadWriteMany | Amazon EFS |

#### Access

**Monitoring (ALB Ingress)** — Grafana and Prometheus are exposed via ALB if AWS Load Balancer Controller is installed:

```bash
kubectl get ingress -n monitoring
# ADDRESS: k8s-dynamomo-xxxx.us-east-1.elb.amazonaws.com
http://<alb-url>/grafana             # Grafana
http://<alb-url>/prometheus          # Prometheus
```

**vLLM API (in-cluster service)** — each model is accessed via ClusterIP:

```bash
# In-cluster URL (for LiteLLM / other services):
http://<deployment>-frontend.dynamo-system:8000/v1

# Port-forward for development:
kubectl port-forward svc/<deployment>-frontend 8000:8000 -n dynamo-system &
```

**Production multi-model routing** — use LiteLLM proxy to expose multiple models via a single endpoint with API key management and rate limiting.

---

## Monitoring

### Overview

The monitoring component deploys **kube-prometheus-stack** (Prometheus + Grafana) with a pre-configured **Dynamo Dashboard**. When monitoring is installed before Dynamo Platform, the `prometheusEndpoint` is automatically detected and configured.

### Architecture

```
Prometheus ──► Scrapes metrics from:
  ├── Dynamo Frontend (:8000/metrics) ── dynamo_frontend_* metrics
  ├── Dynamo Workers  (:9090/metrics) ── dynamo_component_* metrics (Operator auto-configures DYN_SYSTEM_PORT)
  ├── DCGM Exporter   (:9400/metrics) ── GPU utilization, power, memory
  ├── Node Exporter                    ── CPU, memory, disk, network
  └── kube-state-metrics               ── K8s object states

Grafana ──► Queries Prometheus ──► Dynamo Dashboard
  ├── Frontend Requests/Sec
  ├── Time to First Token (TTFT)
  ├── Inter-Token Latency (ITL)
  ├── Request Duration
  ├── Input/Output Sequence Length
  ├── DCGM GPU Utilization
  ├── Node CPU & Load
  ├── Container CPU/Memory per Pod
  └── (Custom dashboards via ConfigMap)
```

### Key Integration Points

| Integration | How It Works |
|-------------|-------------|
| Dynamo Platform → Prometheus | `--set prometheusEndpoint=...` enables Dynamo Operator to auto-create PodMonitors |
| Dynamo Workers → Prometheus | Dynamo Operator auto-sets `DYN_SYSTEM_PORT=9090`, creates health probes and `/metrics` endpoint |
| DCGM → Prometheus | GPU Operator's DCGM Exporter + ServiceMonitor |
| Grafana Dashboard | ConfigMap with `grafana_dashboard: "1"` label, auto-discovered by sidecar |

### Default Configuration

No interactive prompts — all settings are from `config.json` (`platform.monitoring`):

| Setting | Default | Customizable via |
|---------|---------|-----------------|
| Grafana password | `admin` | `config.json` → `grafanaAdminPassword` |
| Retention | `7d` | `config.json` → `retention` |
| Alertmanager | `false` | `config.json` → `alertmanagerEnabled` |
| Ingress | Auto-detect | Enabled if Ingress controller exists |
| ALB annotations (EKS) | Auto-added | When `PLATFORM=eks` and Ingress detected |

### Access

#### With Ingress (recommended)

If Ingress is enabled during installation, Grafana and Prometheus are accessible via HTTP path routing through the Ingress controller. No `port-forward` needed.

```bash
# Find the Ingress controller's NodePort (on-prem / Vagrant)
kubectl get svc -n ingress-nginx
# Look for PORT(S): 80:<NODE_PORT>/TCP

# Find any node IP
kubectl get nodes -o wide
# Look for INTERNAL-IP
```

Access URLs:

| Service | URL |
|---------|-----|
| Grafana | `http://<node-ip>:<node-port>/grafana` |
| Prometheus | `http://<node-ip>:<node-port>/prometheus` |

**Remote access (SSH tunnel)**:

If the K8s cluster is behind a remote host (e.g., Vagrant VMs on a remote server):

```bash
# From your local machine (single SSH tunnel is enough)
ssh -N -L <local-port>:<node-ip>:<node-port> <user>@<remote-host>

# Then open in browser
# Grafana:    http://localhost:<local-port>/grafana
# Prometheus: http://localhost:<local-port>/prometheus
```

#### With EKS (ALB)

When `PLATFORM=eks` and ALB Ingress Controller is detected, ALB annotations are automatically added. Grafana and Prometheus share a single ALB:

```bash
kubectl get ingress -n monitoring
# ADDRESS: k8s-dynamomo-xxxx.us-east-1.elb.amazonaws.com

# Access
http://<alb-url>/grafana
http://<alb-url>/prometheus
```

#### Without Ingress (port-forward fallback)

```bash
# Inside the cluster (or via SSH to the node)
kubectl port-forward svc/prometheus-grafana 3000:80 -n monitoring --address 0.0.0.0 &
kubectl port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090 -n monitoring --address 0.0.0.0 &

# If accessing from a remote machine, set up SSH tunnels accordingly
```

### Grafana Login

| Field | Value |
|-------|-------|
| User | `admin` |
| Password | Configured during install (default: `admin`) |

To retrieve the current password:

```bash
kubectl get secret prometheus-grafana -n monitoring \
  -o jsonpath="{.data.admin-password}" | base64 --decode; echo
```

### Dashboards

| Dashboard | Description | Source |
|-----------|-------------|--------|
| **Dynamo Dashboard** | Frontend/Worker metrics, request rates, latencies | `monitoring/dashboards/dynamo-dashboard.json` |
| **DCGM GPU Monitoring** | GPU utilization, memory, temperature, power | `monitoring/dashboards/dcgm-metrics.json` |
| **KVBM KV Cache** | KV cache usage, offloading metrics | `monitoring/dashboards/kvbm.json` |
| **Benchmark Pareto** | Benchmark comparison (TPS/GPU, TTFT, ITL vs concurrency) | `monitoring/dashboards/benchmark-dashboard.json` |

Dashboards are auto-loaded via Grafana sidecar (ConfigMaps with `grafana_dashboard: "1"` label). To refresh dashboard JSON (e.g. after editing `benchmark-dashboard.json`), re-run `./cli nvidia-platform monitoring install` or update the ConfigMap and restart the Grafana deployment.

### Pushgateway (Benchmark Metrics)

Prometheus Pushgateway is installed alongside the monitoring stack to receive benchmark results. After each benchmark run, metrics are automatically pushed via `kubectl port-forward` + HTTP POST. To reset benchmark data in Grafana, delete Pushgateway metrics (see *Managing Benchmark Data* under AIPerf Benchmark) or re-install monitoring (PVCs are optional to delete for a full reset).

---

## AIPerf Benchmark

### Install and Run

```bash
./cli nvidia-platform benchmark install
```

Interactive prompts:
1. Select deployed DynamoGraphDeployment
2. Choose benchmark mode (Concurrency Sweep, Multi-Turn, Seq Distribution, Prefix Cache)
3. Set parameters (ISL, OSL, concurrency levels, etc.)

### Benchmark Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Concurrency Sweep** | Throughput vs latency at different concurrency levels | Baseline performance |
| **Multi-Turn** | Multi-turn conversations with session affinity | KV Router cache hit effect |
| **Sequence Distribution** | Mixed ISL/OSL workloads (QA + summarization) | Real-world traffic simulation |
| **Prefix Cache** | Synthetic shared-prefix workload (no trace file needed) | KV cache hit rate testing |

**Prefix Cache**: `request_count` is set automatically to **concurrency × 4** per level (aiperf requires `request_count >= concurrency`). No prompt for request count.

### Results and Grafana Dashboard

After benchmark completion:
1. **Results**: PVC `benchmark-results` in `dynamo-system` (per-benchmark dirs `c1`, `c8`, …) and local copy under `components/nvidia-platform/benchmark/results/<benchmark-name>/`.
2. **Metrics**: Automatically pushed to Prometheus Pushgateway (scraped by Prometheus).
3. **Grafana**: Open **Benchmark Pareto** dashboard, select benchmarks via the **Benchmark** dropdown.

Grafana charts show **X = concurrency (numeric order 1→8→16→32)**, **Y = metric**, each benchmark = one line (points + line):
- TPS/GPU vs Concurrency
- TPS/User vs Concurrency
- TTFT P50 / P99 vs Concurrency
- ITL P50 vs Concurrency
- Request Latency P50 vs Concurrency
- **GPU Efficiency: TPS/GPU vs TPS/User (Pareto)** — X = TPS/User, Y = TPS/GPU, scatter plot (points only, no lines). Top-right = optimal.

Metrics are pushed with concurrency labels zero-padded (e.g. `001`, `008`, `016`) so Grafana sorts points in numeric order; directories are processed in concurrency order before push.

### Comparing Deployments

Run the same benchmark mode on different deployment configs to generate Pareto comparison data:

```bash
# 1. Deploy agg baseline → run sweep → results as "qwen3-agg"
# 2. Deploy agg + kvrouter → run sweep → results as "qwen3-kvrouter"
# 3. Deploy disagg + kvbm → run sweep → results as "qwen3-disagg"
```

Then select all three in the Benchmark dropdown to see them on the same graph.

### Managing Benchmark Data

```bash
# Delete all Pushgateway data (via port-forward)
kubectl port-forward svc/pushgateway-prometheus-pushgateway 19091:9091 -n monitoring &
sleep 2
curl -s http://localhost:19091/metrics | grep -oP 'job="[^"]*"' | sort -u | sed 's/job="//;s/"//' | while read job; do
  curl -X DELETE "http://localhost:19091/metrics/job/$job"
done
pkill -f "port-forward.*pushgateway"

# Uninstall benchmark resources (Jobs, PVC)
./cli nvidia-platform benchmark uninstall
```

---

## Dynamo vLLM Serving - Features

### Deployment Modes

| Mode | Description | Workers |
|------|-------------|---------|
| **Aggregated (agg)** | Single worker handles prefill + decode | VllmWorker |
| **Disaggregated (disagg)** | Separate prefill and decode workers with NIXL KV transfer | VllmPrefillWorker + VllmDecodeWorker |

### Parallelism

| Parameter | Description | Agg | Disagg |
|-----------|-------------|:---:|:------:|
| Tensor Parallel (TP) | Split model across GPUs | Single setting | Prefill TP + Decode TP (separate) |
| Pipeline Parallel (PP) | Split layers across GPUs | Single setting | Prefill PP + Decode PP (separate) |
| Expert Parallel (EP) | MoE expert distribution | `--enable-expert-parallel` | Per worker |
| Replicas | Pod-level scaling (Dynamo Frontend routes) | Worker replicas | Prefill replicas + Decode replicas |

### KV Cache Routing

Routes requests to workers with cached KV blocks for better TTFT.

| Setting | ENV / Arg | Default |
|---------|-----------|---------|
| Enable | `DYN_ROUTER_MODE=kv` | Disabled |
| Temperature | `DYN_ROUTER_TEMPERATURE` | 0.5 |
| Overlap Weight | `DYN_KV_OVERLAP_SCORE_WEIGHT` | 1.0 |
| KV Events | `--kv-events-config` | Auto when router enabled |

### KV Cache Offloading (KVBM)

Offload KV cache from GPU to CPU/Disk for larger effective context.

```
GPU (G1) → CPU Pinned Memory (G2) → Local SSD/NVMe (G3)
```

| Setting | ENV | Description |
|---------|-----|-------------|
| CPU Cache | `DYN_KVBM_CPU_CACHE_GB` | CPU pinned memory size (GB) |
| Disk Cache | `DYN_KVBM_DISK_CACHE_GB` | SSD cache size (GB) |
| Disk Directory | `DYN_KVBM_DISK_CACHE_DIR` | Cache path (default: `/tmp`) |
| Disk Offload Filter | `DYN_KVBM_DISABLE_DISK_OFFLOAD_FILTER` | Frequency filter for SSD lifespan (default: enabled) |
| Connector | `--connector kvbm` (agg) / `--connector kvbm nixl` (disagg prefill) | Required |

**Note**: In disaggregated mode, KVBM is applied to **Prefill workers only**. Decode workers use `--connector nixl` for KV transfer.

**Disk Offload Frequency Filter**: Only offloads blocks with frequency >= 2 to disk, protecting SSD lifespan. Frequency doubles on cache hit, decays over time (600s interval).

### Model Download

- Models pre-downloaded to PVC using `huggingface_hub.snapshot_download(local_dir=...)`
- Fixed path: `/opt/models/<org>/<model-name>/`
- Auto-detection: checks if `*.safetensors` exist before download
- vLLM uses `--model /opt/models/<org>/<model>` (local path) + `--served-model-name <HF ID>`

### Interactive Configuration

**Interactive prompts** (only essential config):

```
? Enter model name: (Qwen/Qwen3-30B-A3B-Instruct-2507-FP8)
? Select deployment mode: Aggregated / Disaggregated
? Tensor Parallel Size (TP): 1
? Enable KV Router? No
? Enable KV Cache Offloading (KVBM)? No
? Worker replicas: 1
? Additional vLLM args: --gpu-memory-utilization 0.90 --block-size 128
? Deployment name: (qwen3-30b-a3b-instruct-25)
? What would you like to do? Deploy now / Review first / Save only
```

**Auto-configured** (no prompts, from config.json or auto-detection):

| Setting | Source |
|---------|--------|
| vLLM image tag | `config.json` → `dynamoPlatform.releaseVersion` |
| Structured logging | Auto-enable if monitoring installed |
| KV Router temperature | `0.5` (Dynamo default) |
| KV overlap score weight | `1.0` (Dynamo default) |
| KVBM disk directory | `/tmp` (K8s) / `/mnt/nvme/kvbm_cache` (EKS) |
| KVBM disk offload filter | `true` (default) |

---

## AIConfigurator

Automatically recommend optimal parallelization (TP/PP) and deployment configuration using NVIDIA AI Configurator simulation. Compares aggregated vs disaggregated serving and generates Pareto frontiers.

### Install

```bash
./cli nvidia-platform aiconfigurator install
```

### Modes

| Mode | Description | Duration | GPU Required | Deploys |
|------|-------------|----------|:------------:|:-------:|
| **Quick Estimate** | `aiconfigurator cli default` — agg vs disagg Pareto comparison | ~25s | No | No |
| **SLA-Driven Deploy** | profile (AIC or real engine) + plan + deploy via DGDR | AIC ~5min / Real 2-4h | No (AIC) / Yes (Real) | Yes |

### Quick Estimate

Uses `aiconfigurator cli default` via a dedicated pod to:
1. Load model architecture from `model_configs/` (pre-cached HuggingFace configs)
2. Sweep TP=1,2,4,8 for both agg and disagg modes
3. Display Pareto frontier (ASCII art) + top configurations table
4. Recommend best agg and disagg configs under SLA constraints

Example output:
```
Best Experiment Chosen: agg at 1604.74 tokens/s/gpu (disagg 0.72x better)

agg Top Configurations:
| Rank | tokens/s/gpu | TTFT   | parallel | replicas |
|  1   |   1604.74    | 84.42  | tp4pp1   |    2     |
|  2   |   1574.83    | 86.39  | tp2pp1   |    4     |

disagg Top Configurations:
| Rank | tokens/s/gpu | TTFT   | (p)parallel | (d)parallel | (p)workers | (d)workers |
|  1   |   1149.49    | 45.10  | tp1pp1      | tp2pp1      |     2      |     3      |
```

Note: AIConfigurator uses FP8 GEMM + FP8 KV cache by default on H100/H200 (hardware-optimal). Quantization is determined by the system/backend combination, not the model name.

### SLA-Driven Deploy (DGDR)

Creates a `DynamoGraphDeploymentRequest` (DGDR) that the Dynamo Operator processes automatically.

#### Profiling Methods

| Method | When to Use | Duration | GPU |
|--------|-------------|----------|:---:|
| **AIC Simulation** | Model in AIC support list | ~5 min | No |
| **Real Engine Profiling** | Any HuggingFace model | 2-4 hours | Yes (via DGD) |

- **AIC**: Select GPU system → backend → model from supported list. Fast simulation, no GPU required.
- **Real**: Select backend → enter HuggingFace model ID (e.g., `Qwen/Qwen3-30B-A3B-Instruct-2507-FP8`). The profiler orchestrates temporary DGDs to benchmark with AIPerf.

#### DGDR Flow

```
DGDR Created → Pending → Profiling → [complete] → Deploying → Ready
                                         │
                    AIC simulation or     │
                    Real engine profiling  │
                                          ▼
                              DGD created (independent of DGDR)
                              + planner-profile-data ConfigMap
```

#### Interactive Prompts

```
? Select mode: SLA-Driven Deploy
? Profiling method: AIC Simulation / Real Engine Profiling
? DGDR name: qwen3-30b-sla
? Auto-deploy after profiling with SLA-based planner? Yes
? Min GPUs per engine (0 = auto): 0
? Max GPUs per engine (0 = auto): 0
```

#### Auto-configured (no prompts)

| Setting | Value | Reason |
|---------|-------|--------|
| Model cache PVC | `dynamo-model-cache` (auto-create if missing) | Same PVC as dynamo-vllm |
| PVC mount path | `/opt/models` | Matches dynamo-vllm mount path |
| Model path in PVC | `<model_id>` (e.g., `Qwen/Qwen3-...`) | `mountPath/pvcPath` = `/opt/models/<model>` |
| Discovery backend | `etcd` (via DGD annotation) | Required for KVBM handshake stability |
| SLA Planner min endpoints | `1` | Minimum 1 prefill + 1 decode replica |
| SLA Planner adjustment interval | `60s` | Scaling check frequency |
| Profiling job resources | 2-4 CPU, 8-16Gi memory | Profiler is orchestrator only, no GPU needed |
| Profiling job tolerations | `nvidia.com/gpu: NoSchedule` | Schedule on GPU-tainted nodes |

#### DGDR Lifecycle

- **Immutable**: once profiling starts, spec cannot be changed. Create a new DGDR to change config.
- **DGD independence**: DGD is NOT owned by DGDR. Deleting DGDR does not delete the DGD (protects serving traffic).
- **ConfigMap persistence**: `profiling-output-<dgdr>` and `planner-profile-data` ConfigMaps survive DGDR deletion.
- **Re-deploy from ConfigMap**: extract DGD YAML from ConfigMap and `kubectl apply` without re-profiling:

```bash
kubectl get cm profiling-output-<dgdr-name> -n dynamo-system \
  -o jsonpath='{.data.config_with_planner\.yaml}' > my-dgd.yaml
kubectl apply -f my-dgd.yaml -n dynamo-system
```

#### DGDR States

| State | Description |
|-------|-------------|
| Pending | Spec validated, preparing profiling job |
| Profiling | Profiling job running |
| Deploying | autoApply=true, creating DGD |
| Ready | DGD deployed successfully (or spec generated if autoApply=false) |
| DeploymentDeleted | DGD was manually deleted; create new DGDR to redeploy |
| Failed | Error at any stage |

### Supported Configurations (AIC)

| GPU System | vLLM | TRT-LLM | SGLang |
|------------|:----:|:-------:|:------:|
| H100 SXM | 0.12.0 | 1.0.0rc3, 1.2.0rc5 | 0.5.6.post2 |
| H200 SXM | 0.12.0 | 1.0.0rc3, 1.2.0rc5 | 0.5.6.post2 |
| A100 SXM | 0.12.0 | 1.0.0 | — |
| B200 SXM | — | 1.0.0rc3, 1.2.0rc5 | 0.5.6.post2 |
| GB200 SXM | — | 1.0.0rc3, 1.2.0rc5 | — |
| L40S | — | — | — |

Model list is **dynamically retrieved** from the `model_configs/` directory inside the aiconfigurator package. Supports 22+ models including Qwen, Llama, Mixtral, DeepSeek, Nemotron families. FP8 quantized variants are also available (e.g., `Qwen/Qwen3-32B-FP8`).

For **Real Engine Profiling**, any HuggingFace model ID can be used regardless of the AIC support list.

---

## Quick Test

```bash
# Port-forward the frontend service
kubectl port-forward svc/<deployment>-frontend 8000:8000 -n dynamo-system --address 0.0.0.0 &

# Auto-detect model name
export MODEL=$(curl -s localhost:8000/v1/models | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d[0]['id'] if d else 'NONE')")
echo "Model: $MODEL"

# Chat completion
curl localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Hello! Who are you?\"}],
    \"max_tokens\": 100,
    \"stream\": false
  }"
```


## Known Issues and Workarounds

### Dynamo Platform v0.9.0

| Issue | Details | Workaround |
|-------|---------|------------|
| **CRD chart vs Platform chart version mismatch** | CRD chart is `v0.9.0`, Platform chart is `v0.9.0-post1`. `-postN` suffix only applies to the platform chart. | CLI strips `-postN` suffix when fetching CRD chart. |
| **DynamoWorkerMetadata CRD missing** | `dynamo-crds-0.9.0.tgz` does not include `DynamoWorkerMetadata` CRD, which the `0.9.0-post1` operator requires. | CLI applies bundled CRD from `crds/nvidia.com_dynamoworkermetadatas.yaml` after Helm install. |
| **K8s-native discovery + KVBM handshake** | `discoveryBackend: kubernetes` causes KVBM handshake failures in multi-replica disagg deployments. | Platform defaults to `discoveryBackend: etcd`. DGDR template includes `nvidia.com/dynamo-discovery-backend: etcd` annotation. |

### Vagrant / k3s Environment

| Issue | Details | Workaround |
|-------|---------|------------|
| **Too many open files (os error 24)** | Container soft ulimit is 1024 (hard: 524288) despite k3s LimitNOFILE=1048576. Frontend fails under high concurrency. | Not an issue on EKS (Amazon Linux default nofile is 65536+). For Vagrant, configure containerd default ulimits. |
| **Long vLLM warmup** | DeepGEMM warmup can take 7+ minutes for large models (e.g., Qwen3-30B). Frontend shows KVBM handshake retries during this time. | Normal behavior. Frontend will complete handshake once all workers finish warmup. |

---

## TODO

### Implemented

- [x] **GPU Operator Installer** - `./cli nvidia-platform gpu-operator install`
- [x] **Dynamo Platform Installer** - `./cli nvidia-platform dynamo-platform install` (CRDs, Operator, etcd, NATS, Grove, KAI Scheduler)
- [x] **Model PVC - K8s (NFS)** - Host NFS server + nfs-subdir-external-provisioner + ReadWriteMany PVC
- [x] **Model PVC - AWS (EFS)** - EFS CSI driver + StorageClass auto-setup
- [x] **vLLM Multi-node Aggregated Serving** - Agg mode with replicas, KV Router, model pre-download
- [x] **vLLM KV Cache Routing** - `DYN_ROUTER_MODE=kv` with temperature and overlap score weight
- [x] **vLLM KV Cache Offloading (G1-G3)** - CPU + Disk offloading with frequency filter for SSD lifespan
- [x] **vLLM Multi-node Disaggregated Serving** - Separate Prefill/Decode workers with independent TP/PP, NIXL connector, KVBM on Prefill only
- [x] **Expert Parallel (EP)** - `--enable-expert-parallel` for MoE models (DeepSeek-R1, Mixtral, etc.)
- [x] **EKS Mode Support** - ALB Ingress, EFS, EKS tolerations, instance family nodeSelector, LiteLLM integration

- [x] **Monitoring (Prometheus + Grafana + Dynamo Dashboard)** - kube-prometheus-stack, PodMonitor auto-detection, DCGM ServiceMonitor, Grafana Dynamo Dashboard, Ingress support
- [x] **Ingress Support** - Auto-detect Ingress controller, expose Grafana/Prometheus/vLLM API via path routing (no port-forward needed)
- [x] **AIPerf Benchmark** - K8s Job-based concurrency sweep, multi-turn, seq distribution, prefix cache, results extraction
- [x] **Benchmark Pareto Dashboard** - Pushgateway + Grafana XY Chart, multi-benchmark comparison, auto-push after benchmark
- [x] **AIConfigurator** - Quick Estimate (TP/PP recommendation) + SLA-Driven Deploy (DGDR auto-profile + plan + deploy)

### Not Yet Implemented

- [ ] **Log Aggregation (Loki + Alloy)** - Structured log collection with Grafana Loki for DynamoGraphDeployments
- [ ] **Distributed Tracing** - OpenTelemetry integration with Tempo for request tracing across Frontend/Workers
- [ ] **TRT-LLM Backend** - TensorRT-LLM serving support (`dynamo-trtllm` component)
- [ ] **Multi-modal Model Support**

---
