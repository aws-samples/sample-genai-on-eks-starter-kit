# NVIDIA Dynamo Platform

Deploy and serve LLM models with NVIDIA Dynamo on Kubernetes (on-premises) and Amazon EKS. The NVIDIA Platform provides a comprehensive suite of components for GPU-accelerated LLM inference with enterprise-grade monitoring, benchmarking, and auto-configuration.

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
| [GPU Operator](gpu-operator.md) | NVIDIA GPU resource management | `./cli nvidia-platform gpu-operator install` |
| [Monitoring](monitoring.md) | Prometheus + Grafana + Dynamo/DCGM/KVBM/Benchmark dashboards | `./cli nvidia-platform monitoring install` |
| [Dynamo Platform](dynamo-platform.md) | CRDs, Operator, etcd, NATS, Grove, KAI Scheduler | `./cli nvidia-platform dynamo-platform install` |
| [Dynamo vLLM Serving](dynamo-vllm.md) | vLLM model deployment (agg/disagg, KV Router, KVBM) | `./cli nvidia-platform dynamo-vllm install` |
| [AIPerf Benchmark](benchmark.md) | Concurrency sweep, multi-turn, seq distribution, prefix cache | `./cli nvidia-platform benchmark install` |
| [AIConfigurator](aiconfigurator.md) | TP/PP recommendation (Quick Estimate) + SLA-driven profile + plan + deploy | `./cli nvidia-platform aiconfigurator install` |

## Installation Order

```bash
# === Standard Path ===
# 0. (K8s only) Install Ingress controller if not present
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx --force-update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace --set controller.service.type=NodePort --wait

# 1. Monitoring (Prometheus + Grafana) — install first so GPU Operator
#    auto-detects ServiceMonitor CRDs and enables DCGM metrics scraping.
./cli nvidia-platform monitoring install

# 2. GPU Operator (detects Prometheus → creates DCGM ServiceMonitor)
./cli nvidia-platform gpu-operator install

# 3. Dynamo Platform (auto-detects Prometheus and sets prometheusEndpoint)
./cli nvidia-platform dynamo-platform install

# 4. Deploy a model
./cli nvidia-platform dynamo-vllm install
```

## Platform Modes

The NVIDIA Platform supports two deployment modes, configured via `PLATFORM` in `.env`:

### K8s Mode (On-premises)

**Environment**: `PLATFORM=k8s`

Designed for bare-metal Kubernetes clusters with pre-installed NVIDIA drivers and Container Toolkit.

**Prerequisites (user must prepare)**:
- Kubernetes v1.33+
- NVIDIA Driver 580+
- NVIDIA Container Toolkit with CDI configured
- Fabric Manager (for H100 SXM / NVSwitch GPUs)
- StorageClass with ReadWriteMany access (e.g., NFS, CephFS)

**Auto-installed by CLI**:
- `local-path` StorageClass (if not found)
- `ingress-nginx` (prompted if not found)
- Prometheus endpoint auto-configuration

### EKS Mode (Amazon Web Services)

**Environment**: `PLATFORM=eks`

Optimized for Amazon EKS with GPU node groups (g6e, p5, p4d, etc.).

**Prerequisites (user must prepare)**:
- EKS Cluster v1.33+
- GPU node groups with EKS GPU AMI
- HuggingFace token for gated model access

**Auto-installed by CLI**:
- EFS CSI Driver (via EKS addon)
- EFS StorageClass
- ALB Ingress annotations
- Prometheus endpoint auto-configuration

## Key Features

### Deployment Modes
- **Aggregated**: Single worker handles prefill + decode
- **Disaggregated**: Separate prefill and decode workers with NIXL KV transfer

### Parallelism Options
- **Tensor Parallel (TP)**: Split model across GPUs
- **Pipeline Parallel (PP)**: Split layers across GPUs
- **Expert Parallel (EP)**: MoE expert distribution
- **Replicas**: Pod-level scaling with Dynamo Frontend routing

### Advanced Features
- **KV Cache Routing**: Routes requests to workers with cached KV blocks
- **KV Cache Offloading (KVBM)**: GPU → CPU → Disk cache hierarchy
- **Model Download**: Pre-download to PVC with auto-detection
- **Structured Logging**: Auto-enable if monitoring installed

## Quick Test

```bash
# Port-forward the frontend service
kubectl port-forward svc/<deployment>-frontend 8000:8000 -n dynamo-system --address 0.0.0.0 &

# Auto-detect model name
export MODEL=$(curl -s localhost:8000/v1/models | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d[0]['id'] if d else 'NONE')")

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

## Learn More

- [NVIDIA Dynamo Platform Documentation](https://docs.nvidia.com/dynamo/)
- [vLLM Documentation](https://docs.vllm.ai)
- [GPU Operator Documentation](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/)
