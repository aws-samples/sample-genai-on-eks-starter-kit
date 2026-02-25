# NVIDIA Dynamo Platform on Kubernetes

Deploy and serve LLM models with NVIDIA Dynamo on Kubernetes (on-premises) and Amazon EKS.

## Architecture

```
                    +-----------------------+
                    |      CLI              |
                    |  ./cli nvidia-platform |
                    +----------+------------+
                               |
         +----------+----------+----------+----------+
         |          |                     |          |
    GPU Operator  Monitoring     Dynamo Platform  Dynamo vLLM
    (K8s GPU      (Prometheus,   (CRDs, Operator, (Model deploy,
     management)   Grafana,       etcd, NATS,      KV Router,
                   Dashboards)    Grove, KAI)      KVBM, Agg/
                                                   Disagg modes)
```

## Components

| Component | Description | CLI Command |
|-----------|-------------|-------------|
| GPU Operator | NVIDIA GPU resource management | `./cli nvidia-platform gpu-operator install` |
| Monitoring | Prometheus + Grafana + Dynamo Dashboard | `./cli nvidia-platform monitoring install` |
| Dynamo Platform | CRDs, Operator, etcd, NATS, Grove, KAI Scheduler | `./cli nvidia-platform dynamo-platform install` |
| Dynamo vLLM Serving | vLLM model deployment with advanced features | `./cli nvidia-platform dynamo-vllm install` |

## Installation Order

```bash
# === Standard Path (Device Plugin) ===
# 1. GPU Operator
./cli nvidia-platform gpu-operator install

# 2. Monitoring (Prometheus + Grafana) - recommended before Dynamo Platform
./cli nvidia-platform monitoring install

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

**With Ingress (recommended)** — if an Ingress controller is installed, monitoring and vLLM API are accessible via path routing:

```bash
# Find Ingress controller's external port
kubectl get svc -n ingress-nginx
# PORT(S): 80:<NODE_PORT>/TCP

# All services via single endpoint
http://<node-ip>:<node-port>/v1/models          # vLLM API
http://<node-ip>:<node-port>/grafana             # Grafana
http://<node-ip>:<node-port>/prometheus          # Prometheus
```

**Remote access (SSH tunnel)** — if the cluster is behind a remote server:

```bash
ssh -N -L <local-port>:<node-ip>:<node-port> <user>@<remote-host>
# Then: http://localhost:<local-port>/v1/models
# Then: http://localhost:<local-port>/grafana
```

**Without Ingress (port-forward fallback)**:

```bash
kubectl port-forward svc/<deployment>-frontend 8000:8000 -n dynamo-system --address 0.0.0.0 &
curl localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "<served-model-name>", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 50}'
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

**With ALB Ingress (recommended for production)** — if AWS Load Balancer Controller is installed, monitoring and vLLM API are accessible via ALB:

```bash
# Check ALB URL
kubectl get ingress -A
# ADDRESS: k8s-dynamomo-xxxx.us-east-1.elb.amazonaws.com

# All services via ALB
http://<alb-url>/v1/models          # vLLM API
http://<alb-url>/grafana             # Grafana
http://<alb-url>/prometheus          # Prometheus
```

**Internal URL (for LiteLLM / in-cluster services)**:

```
http://<deployment>-frontend.dynamo-system:8000/v1
```

**Port-forward (development)**:

```bash
kubectl port-forward svc/<deployment>-frontend 8000:8000 -n dynamo-system
```

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

### Dashboard Source

The Dynamo Grafana dashboard JSON is stored in the repo at:
- `monitoring/dashboards/dynamo-dashboard.json` (source JSON)
- `monitoring/dashboards/grafana-dynamo-dashboard-configmap.template.yaml` (K8s ConfigMap template)

Based on the official dashboard from [ai-dynamo/dynamo](https://github.com/ai-dynamo/dynamo/tree/main/deploy/observability/k8s).

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
| Ingress | Auto-detect controller + auto-create (ALB annotations on EKS) |
| KV Router temperature | `0.5` (Dynamo default) |
| KV overlap score weight | `1.0` (Dynamo default) |
| KVBM disk directory | `/tmp` (K8s) / `/mnt/nvme/kvbm_cache` (EKS) |
| KVBM disk offload filter | `true` (default) |

---

## Quick Test (via Ingress)

```bash
# Set your endpoint (NodePort example)
export ENDPOINT="<node-ip>:<node-port>"

# Auto-detect model name
export MODEL=$(curl -s http://$ENDPOINT/v1/models | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d[0]['id'] if d else 'NONE')")
echo "Model: $MODEL"

# Chat completion
curl http://$ENDPOINT/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Hello! Who are you?\"}],
    \"max_tokens\": 100
  }"
```


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

### Not Yet Implemented

- [ ] **DRA (Dynamic Resource Allocation)** - GPU allocation via DRA ResourceClaims (K8s 1.34+, separate `dra` + `dra-dynamo-vllm` components)
- [ ] **AIPerf Benchmark** - Automated benchmarking with `aiperf profile` for TTFT/ITL measurement
- [ ] **Log Aggregation (Loki + Alloy)** - Structured log collection with Grafana Loki for DynamoGraphDeployments
- [ ] **Distributed Tracing** - OpenTelemetry integration with Tempo for request tracing across Frontend/Workers
- [ ] **AIConfigurator** - Automated optimal TP/PP/batch size configuration finder
- [ ] **SLO-based Planner** - SLA-driven auto-scaling with profiling (`disagg_planner.yaml`, load predictor: constant/arima/prophet)
- [ ] **TRT-LLM Backend** - TensorRT-LLM serving support (`dynamo-trtllm` component)

---
