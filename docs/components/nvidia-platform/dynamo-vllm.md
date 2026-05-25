# Dynamo vLLM Serving

Deploy vLLM models with NVIDIA Dynamo Platform orchestration. Supports aggregated and disaggregated serving modes, KV cache routing, KV cache offloading (KVBM), and advanced parallelism strategies.

| | |
|---|---|
| **Category** | nvidia-platform |
| **Official Docs** | [NVIDIA Dynamo vLLM](https://docs.nvidia.com/dynamo/), [vLLM](https://docs.vllm.ai) |
| **CLI Install** | `./cli nvidia-platform dynamo-vllm install` |
| **CLI Uninstall** | `./cli nvidia-platform dynamo-vllm uninstall` |
| **Namespace** | `dynamo-system` |

## Overview

Dynamo vLLM provides high-performance LLM serving with:
- **Aggregated mode**: Single worker handles prefill + decode
- **Disaggregated mode**: Separate prefill and decode workers with NIXL KV transfer
- **KV Cache Routing**: Routes requests to workers with cached KV blocks
- **KV Cache Offloading (KVBM)**: GPU → CPU → Disk cache hierarchy
- **Model pre-download**: Downloads to PVC before deployment
- **Multi-node serving**: Tensor/Pipeline/Expert parallelism with pod replicas

## Installation

```bash
./cli nvidia-platform dynamo-vllm install
```

### Interactive Configuration

The installer prompts for essential configuration only:

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

### Auto-Configuration

No prompts for these settings (configured from `config.json` or auto-detection):

| Setting | Source |
|---------|--------|
| vLLM image tag | `config.json` → `dynamoPlatform.releaseVersion` |
| Structured logging | Auto-enable if monitoring installed |
| KV Router temperature | `0.5` (Dynamo default) |
| KV overlap score weight | `1.0` (Dynamo default) |
| KVBM disk directory | `/tmp` (K8s) / `/mnt/nvme/kvbm_cache` (EKS) |
| KVBM disk offload filter | `true` (default, protects SSD lifespan) |

## Deployment Modes

### Aggregated (agg)

Single worker handles both prefill (prompt encoding) and decode (token generation):

```
Request → Frontend → VllmWorker (prefill + decode) → Response
```

**Characteristics**:
- Simpler architecture
- Lower latency for small batches
- TP/PP/EP applied to single worker type
- Better for single-turn conversations

### Disaggregated (disagg)

Separate workers for prefill and decode, with NIXL for KV transfer:

```
Request → Frontend → VllmPrefillWorker → [NIXL KV Transfer] → VllmDecodeWorker → Response
```

**Characteristics**:
- Independent scaling of prefill and decode
- Separate TP/PP/EP for each worker type
- Better for multi-turn conversations with KV Router
- KVBM applied to Prefill workers only

## Parallelism

| Parameter | Description | Agg | Disagg |
|-----------|-------------|:---:|:------:|
| **Tensor Parallel (TP)** | Split model across GPUs | Single setting | Separate Prefill TP + Decode TP |
| **Pipeline Parallel (PP)** | Split layers across GPUs | Single setting | Separate Prefill PP + Decode PP |
| **Expert Parallel (EP)** | MoE expert distribution | `--enable-expert-parallel` | Per worker type |
| **Replicas** | Pod-level scaling | Worker replicas | Prefill replicas + Decode replicas |

Example: Disaggregated with TP=2 for prefill, TP=4 for decode:
```
Prefill: 2 replicas × TP2 = 4 GPUs
Decode:  4 replicas × TP4 = 16 GPUs
Total: 20 GPUs
```

## KV Cache Routing

Routes requests to workers with cached KV blocks for improved TTFT (Time to First Token).

| Setting | ENV / Arg | Default |
|---------|-----------|---------|
| Enable | `DYN_ROUTER_MODE=kv` | Disabled |
| Temperature | `DYN_ROUTER_TEMPERATURE` | 0.5 |
| Overlap Weight | `DYN_KV_OVERLAP_SCORE_WEIGHT` | 1.0 |
| KV Events | `--kv-events-config` | Auto when router enabled |

**Use Case**: Multi-turn conversations with session affinity. Benchmark with [AIPerf Multi-Turn mode](benchmark.md).

## KV Cache Offloading (KVBM)

Three-tier cache hierarchy for larger effective context:

```
GPU Memory (G1) → CPU Pinned Memory (G2) → Local SSD/NVMe (G3)
```

| Setting | ENV | Description |
|---------|-----|-------------|
| CPU Cache | `DYN_KVBM_CPU_CACHE_GB` | CPU pinned memory size (GB) |
| Disk Cache | `DYN_KVBM_DISK_CACHE_GB` | SSD cache size (GB) |
| Disk Directory | `DYN_KVBM_DISK_CACHE_DIR` | Cache path (default: `/tmp`) |
| Disk Offload Filter | `DYN_KVBM_DISABLE_DISK_OFFLOAD_FILTER` | Frequency filter (default: enabled) |
| Connector | `--connector kvbm` (agg) / `--connector kvbm nixl` (disagg prefill) | Required |

!!! warning "Disaggregated Mode"
    In disaggregated mode, KVBM is applied to **Prefill workers only**. Decode workers use `--connector nixl` for KV transfer.

!!! info "Disk Offload Frequency Filter"
    Only offloads blocks with frequency >= 2 to disk, protecting SSD lifespan. Frequency doubles on cache hit, decays over time (600s interval).

## Model Download

Models are pre-downloaded to PVC using `huggingface_hub.snapshot_download`:

- **Fixed path**: `/opt/models/<org>/<model-name>/`
- **Auto-detection**: Checks if `*.safetensors` exist before download
- **vLLM args**: `--model /opt/models/<org>/<model>` + `--served-model-name <HF ID>`

Example:
```
Model: Qwen/Qwen3-30B-A3B-Instruct-2507-FP8
PVC Path: /opt/models/Qwen/Qwen3-30B-A3B-Instruct-2507-FP8/
vLLM: --model /opt/models/Qwen/Qwen3-30B-A3B-Instruct-2507-FP8 --served-model-name Qwen/Qwen3-30B-A3B-Instruct-2507-FP8
```

## Verification

```bash
# Check deployment
kubectl get dynamographdeployment -n dynamo-system

# Check pods
kubectl get pods -n dynamo-system

# Check frontend service
kubectl get svc -n dynamo-system | grep frontend

# Port-forward for testing
kubectl port-forward svc/<deployment>-frontend 8000:8000 -n dynamo-system --address 0.0.0.0 &

# Auto-detect model name
export MODEL=$(curl -s localhost:8000/v1/models | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d[0]['id'] if d else 'NONE')")

# Test chat completion
curl localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Hello!\"}],
    \"max_tokens\": 50,
    \"stream\": false
  }"
```

## Configuration

Modify `config.json` to change default settings:

```json
{
  "platform": {
    "eks": {
      "dynamoPlatform": {
        "releaseVersion": "0.9.1"
      }
    }
  }
}
```

## Advanced vLLM Arguments

Common arguments to pass via "Additional vLLM args":

```bash
# GPU memory utilization
--gpu-memory-utilization 0.90

# Block size (larger = more memory, fewer blocks)
--block-size 128

# Expert parallel (for MoE models)
--enable-expert-parallel

# Quantization
--quantization fp8

# Max model length
--max-model-len 8192
```

## Integration with LiteLLM

Deploy Dynamo vLLM models, then configure [LiteLLM](../ai-gateway/litellm.md) to route traffic:

```yaml
model_list:
  - model_name: qwen3-30b-fp8
    litellm_params:
      model: openai/qwen3-30b-fp8
      api_base: http://<deployment>-frontend.dynamo-system:8000/v1
```

## Learn More

- [NVIDIA Dynamo Platform Documentation](https://docs.nvidia.com/dynamo/)
- [vLLM Documentation](https://docs.vllm.ai)
- [NIXL: Network-Integrated Execution Library](https://github.com/vllm-project/vllm/blob/main/docs/source/features/disaggregated_serving.md)
