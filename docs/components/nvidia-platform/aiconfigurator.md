# AIConfigurator

Automatically recommend optimal parallelization (TP/PP) and deployment configuration using NVIDIA AI Configurator simulation. Compares aggregated vs disaggregated serving and generates Pareto frontiers.

| | |
|---|---|
| **Category** | nvidia-platform |
| **Official Docs** | [NVIDIA AI Configurator](https://docs.nvidia.com/ai-configurator/) |
| **CLI Install** | `./cli nvidia-platform aiconfigurator install` |
| **CLI Uninstall** | `./cli nvidia-platform aiconfigurator uninstall` |
| **Namespace** | `dynamo-system` |

## Overview

AIConfigurator eliminates guesswork in LLM deployment configuration by:
- **Quick Estimate**: Fast TP/PP recommendation (~25s, no GPU required)
- **SLA-Driven Deploy**: Auto-profile + plan + deploy via DGDR (~5min AIC / 2-4h Real)

Both modes use simulation or profiling to find optimal configurations under SLA constraints (latency, throughput).

## Installation

```bash
./cli nvidia-platform aiconfigurator install
```

The installer prompts for mode selection and configuration.

## Modes

| Mode | Description | Duration | GPU Required | Deploys |
|------|-------------|----------|:------------:|:-------:|
| **Quick Estimate** | `aiconfigurator cli default` — agg vs disagg Pareto comparison | ~25s | No | No |
| **SLA-Driven Deploy** | profile (AIC or real engine) + plan + deploy via DGDR | AIC ~5min / Real 2-4h | No (AIC) / Yes (Real) | Yes |

## Quick Estimate

Uses `aiconfigurator cli default` via a dedicated pod to:
1. Load model architecture from `model_configs/` (pre-cached HuggingFace configs)
2. Sweep TP=1,2,4,8 for both agg and disagg modes
3. Display Pareto frontier (ASCII art) + top configurations table
4. Recommend best agg and disagg configs under SLA constraints

### Example Output

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

!!! info "FP8 Quantization"
    AIConfigurator uses FP8 GEMM + FP8 KV cache by default on H100/H200 (hardware-optimal). Quantization is determined by the system/backend combination, not the model name.

### Interactive Prompts

```
? Select mode: Quick Estimate
? Select GPU system: H100 SXM / H200 SXM / A100 SXM / B200 SXM / GB200 SXM
? Select backend: vLLM 0.12.0 / TRT-LLM 1.2.0rc5 / SGLang 0.5.6.post2
? Select model from supported list: [dynamic list from model_configs/]
? Max TTFT (ms): 100
? Min throughput (tokens/s): 1000
```

### Supported Configurations (AIC)

| GPU System | vLLM | TRT-LLM | SGLang |
|------------|:----:|:-------:|:------:|
| H100 SXM | 0.12.0 | 1.0.0rc3, 1.2.0rc5 | 0.5.6.post2 |
| H200 SXM | 0.12.0 | 1.0.0rc3, 1.2.0rc5 | 0.5.6.post2 |
| A100 SXM | 0.12.0 | 1.0.0 | — |
| B200 SXM | — | 1.0.0rc3, 1.2.0rc5 | 0.5.6.post2 |
| GB200 SXM | — | 1.0.0rc3, 1.2.0rc5 | — |

Model list is **dynamically retrieved** from `model_configs/` (22+ models including Qwen, Llama, Mixtral, DeepSeek, Nemotron).

## SLA-Driven Deploy (DGDR)

Creates a `DynamoGraphDeploymentRequest` (DGDR) that the Dynamo Operator processes automatically.

### Profiling Methods

| Method | When to Use | Duration | GPU |
|--------|-------------|----------|:---:|
| **AIC Simulation** | Model in AIC support list | ~5 min | No |
| **Real Engine Profiling** | Any HuggingFace model | 2-4 hours | Yes (via DGD) |

- **AIC**: Select GPU system → backend → model from supported list. Fast simulation, no GPU required.
- **Real**: Select backend → enter HuggingFace model ID (e.g., `Qwen/Qwen3-30B-A3B-Instruct-2507-FP8`). The profiler orchestrates temporary DGDs to benchmark with AIPerf.

### DGDR Flow

```
DGDR Created → Pending → Profiling → [complete] → Deploying → Ready
                                         │
                    AIC simulation or     │
                    Real engine profiling  │
                                          ▼
                              DGD created (independent of DGDR)
                              + planner-profile-data ConfigMap
```

### Interactive Prompts

```
? Select mode: SLA-Driven Deploy
? Profiling method: AIC Simulation / Real Engine Profiling
? DGDR name: qwen3-30b-sla
? Auto-deploy after profiling with SLA-based planner? Yes
? Min GPUs per engine (0 = auto): 0
? Max GPUs per engine (0 = auto): 0
```

### Auto-Configuration

No prompts for these settings:

| Setting | Value | Reason |
|---------|-------|--------|
| Model cache PVC | `dynamo-model-cache` (auto-create if missing) | Same PVC as dynamo-vllm |
| PVC mount path | `/opt/models` | Matches dynamo-vllm mount path |
| Model path in PVC | `<model_id>` | `mountPath/pvcPath` = `/opt/models/<model>` |
| Discovery backend | `etcd` (via DGD annotation) | Required for KVBM handshake stability |
| SLA Planner min endpoints | `1` | Minimum 1 prefill + 1 decode replica |
| SLA Planner adjustment interval | `60s` | Scaling check frequency |
| Profiling job resources | 2-4 CPU, 8-16Gi memory | Profiler is orchestrator only |

## DGDR Lifecycle

### States

| State | Description |
|-------|-------------|
| Pending | Spec validated, preparing profiling job |
| Profiling | Profiling job running |
| Deploying | autoApply=true, creating DGD |
| Ready | DGD deployed successfully |
| DeploymentDeleted | DGD was manually deleted; create new DGDR to redeploy |
| Failed | Error at any stage |

### DGD Independence

- **DGD is NOT owned by DGDR**: Deleting DGDR does not delete the DGD (protects serving traffic)
- **ConfigMap persistence**: `profiling-output-<dgdr>` and `planner-profile-data` survive DGDR deletion
- **Immutable**: Once profiling starts, spec cannot be changed. Create a new DGDR to change config.

### Re-Deploy from ConfigMap

Extract DGD YAML from ConfigMap and apply without re-profiling:

```bash
kubectl get cm profiling-output-<dgdr-name> -n dynamo-system \
  -o jsonpath='{.data.config_with_planner\.yaml}' > my-dgd.yaml
kubectl apply -f my-dgd.yaml -n dynamo-system
```

## Verification

```bash
# Check DGDR status
kubectl get dynamographdeploymentrequest -n dynamo-system

# Check profiling job
kubectl get jobs -n dynamo-system | grep aiconfigurator

# Check profiling logs
kubectl logs -n dynamo-system -l job-name=aiconfigurator-<dgdr-name> -f

# Check created DGD (after profiling completes)
kubectl get dynamographdeployment -n dynamo-system

# Check ConfigMaps
kubectl get cm -n dynamo-system | grep profiling-output
```

## Configuration

DGDR configuration is managed through interactive prompts. Common settings:

| Parameter | Description | Typical Values |
|-----------|-------------|----------------|
| Auto-deploy | Create DGD automatically after profiling | Yes / No |
| Min GPUs per engine | Minimum GPU allocation | 0 (auto), 1, 2, 4 |
| Max GPUs per engine | Maximum GPU allocation | 0 (auto), 8, 16 |
| Max TTFT | Time to First Token SLA (ms) | 50, 100, 200 |
| Min Throughput | Minimum tokens/s | 1000, 5000, 10000 |

## Real Engine Profiling

For models not in the AIC support list, use Real Engine Profiling:

1. Installer creates temporary DGDs with different TP/PP configurations
2. Runs AIPerf benchmarks on each configuration
3. Collects metrics (TTFT, ITL, throughput)
4. Generates optimal configuration recommendation
5. Creates final DGD with SLA Planner

!!! warning "Long Duration"
    Real Engine Profiling takes 2-4 hours and requires GPU resources. Plan accordingly.

## Troubleshooting

### Quick Estimate pod fails

```bash
# Check pod logs
kubectl logs -n dynamo-system -l app=aiconfigurator

# Check model_configs availability
kubectl exec -it -n dynamo-system <aiconfigurator-pod> -- ls /app/model_configs
```

### DGDR stuck in Profiling

```bash
# Check profiling job
kubectl get jobs -n dynamo-system | grep aiconfigurator

# Check profiling logs
kubectl logs -n dynamo-system -l job-name=aiconfigurator-<dgdr-name> -f

# Check DGDR events
kubectl describe dynamographdeploymentrequest -n dynamo-system <dgdr-name>
```

### DGD not created after profiling

```bash
# Check DGDR status
kubectl get dynamographdeploymentrequest -n dynamo-system <dgdr-name> -o yaml

# Check ConfigMap has DGD spec
kubectl get cm profiling-output-<dgdr-name> -n dynamo-system -o yaml
```

## Learn More

- [NVIDIA AI Configurator Documentation](https://docs.nvidia.com/ai-configurator/)
- [Dynamo Platform SLA Planner](dynamo-platform.md)
- [AIPerf Benchmark Integration](benchmark.md)
