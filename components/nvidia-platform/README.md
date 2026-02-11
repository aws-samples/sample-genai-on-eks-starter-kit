# NVIDIA Dynamo Platform on Kubernetes

Deploy and serve LLM models with NVIDIA Dynamo on Kubernetes (on-premises) and Amazon EKS.

## Architecture

```
                    +-----------------------+
                    |      CLI              |
                    |  ./cli nvidia-platform |
                    +----------+------------+
                               |
              +----------------+----------------+
              |                |                |
     GPU Operator     Dynamo Platform    Dynamo vLLM Serving
     (K8s GPU mgmt)   (CRDs, Operator,  (Model deployment,
                       etcd, NATS,       KV Router, KVBM,
                       Grove, KAI)       Agg/Disagg modes)
```

## Components

| Component | Description | CLI Command |
|-----------|-------------|-------------|
| GPU Operator | NVIDIA GPU resource management | `./cli nvidia-platform gpu-operator install` |
| Dynamo Platform | CRDs, Operator, etcd, NATS, Grove, KAI Scheduler | `./cli nvidia-platform dynamo-platform install` |
| Dynamo vLLM Serving | vLLM model deployment with advanced features | `./cli nvidia-platform dynamo-vllm install` |

## Installation Order

```bash
# 1. GPU Operator
./cli nvidia-platform gpu-operator install

# 2. Dynamo Platform
./cli nvidia-platform dynamo-platform install

# 3. Deploy a model
./cli nvidia-platform dynamo-vllm install
```

---

## Platform Modes

### K8s Mode (Vagrant / On-premises)

**Environment**: `PLATFORM=k8s` in `.env`

#### Prerequisites

| Requirement | Details |
|-------------|---------|
| Kubernetes v1.28+ | kubeadm, kubelet, kubectl |
| NVIDIA Driver | Pre-installed on worker nodes |
| NVIDIA Container Toolkit | CDI configured (`nvidia-ctk cdi generate`) |
| Fabric Manager | **Required on host** for H100 SXM / NVSwitch GPUs |
| NFS Server | Host machine running NFS for shared model cache |
| StorageClass | `nfs` (model cache, ReadWriteMany) + `local-path` (etcd/NATS) |

#### Host Machine Setup (run once before `vagrant up`)

```bash
# NFS server for shared model storage (uses host's disk, not VM's)
sudo ./setup-host-nfs.sh

# Fabric Manager for H100 SXM GPUs
sudo systemctl start nvidia-fabricmanager
sudo systemctl enable nvidia-fabricmanager
```

#### Worker Node Requirements

The following are automatically configured by `common-gpu.sh` during `vagrant up`:
- NVIDIA driver + `nvidia_uvm` kernel module
- NVIDIA Container Toolkit + CDI configuration
- `nfs-common` for NFS PVC mount
- containerd with nvidia runtime

#### Storage

| StorageClass | Purpose | Access Mode | Backend |
|--------------|---------|-------------|---------|
| `nfs` | Model cache PVC | ReadWriteMany | Host NFS (`/srv/nfs/k8s`) |
| `local-path` | etcd, NATS persistence | ReadWriteOnce | Node local disk |

#### Network

```
Host (192.168.122.1) ─── NFS Server + Fabric Manager
  ├── gpu-control-plane (192.168.122.10) ─── K8s control plane
  ├── gpu-worker-1 (192.168.122.21) ─── GPU node (4x GPU)
  └── gpu-worker-2 (192.168.122.22) ─── GPU node (4x GPU)
```

#### Access

```bash
# Port-forward for local testing
kubectl port-forward svc/<deployment>-frontend 8000:8000 -n dynamo-system &

# Test
curl localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "<served-model-name>", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 50}'

# Stop
kill %1
```

---

### EKS Mode (Amazon Web Services)

**Environment**: `PLATFORM=eks` in `.env`

#### Prerequisites

| Requirement | Details |
|-------------|---------|
| EKS Cluster v1.28+ | With GPU node groups (g6e, p5, p4d, etc.) |
| GPU Operator | Installed via CLI or EKS GPU AMI |
| EFS | Shared model cache storage |
| EFS CSI Driver | EKS addon `aws-efs-csi-driver` |
| HuggingFace Token | For gated model access (K8s Secret) |

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

```bash
# Internal URL (for LiteLLM / in-cluster services)
http://<deployment>-frontend.dynamo-system:8000/v1

# Optional: expose via LoadBalancer
kubectl patch svc <deployment>-frontend -n dynamo-system \
  -p '{"spec": {"type": "LoadBalancer"}}'

# EKS instance family selection supported (e.g., p5, g6e)
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

```
? Deployment name: qwen3-14b-fp8
? Enter model name (HuggingFace format): nvidia/Qwen3-14B-FP8
? Select deployment mode: Aggregated / Disaggregated
? Tensor Parallel Size (TP): 4
? Pipeline Parallel Size (PP): 1
? Enable Expert Parallel (EP)? No
? Enable KV Router? No
? Enable KV Cache Offloading (KVBM)? No
? Worker replicas: 1
? Additional vLLM args: --gpu-memory-utilization 0.90 --block-size 128
? vLLM runtime image tag: 0.8.1
? What would you like to do? Deploy now / Review first / Save only
```

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

### Not Yet Implemented

- [ ] **AIPerf Benchmark** - Automated benchmarking with `aiperf profile` for TTFT/ITL measurement
- [ ] **Monitoring (DCGM + Dynamo Metrics)** - GPU metrics via DCGM exporter + KVBM metrics endpoint (`DYN_KVBM_METRICS=true`)
- [ ] **Distributed Tracing Monitoring** - OpenTelemetry integration for request tracing across Frontend/Workers
- [ ] **AIConfigurator** - Automated optimal TP/PP/batch size configuration finder
- [ ] **SLO-based Planner** - SLA-driven auto-scaling with profiling (`disagg_planner.yaml`, load predictor: constant/arima/prophet)
- [ ] **TRT-LLM Backend** - TensorRT-LLM serving support (`dynamo-trtllm` component)

---
