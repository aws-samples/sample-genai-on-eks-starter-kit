# vLLM

High-throughput LLM serving engine with PagedAttention for efficient memory management. Supports continuous batching, prefix caching, multi-LoRA, and quantization (FP8, GPTQ, AWQ).

| | |
|---|---|
| **Category** | llm-model |
| **Official Docs** | [vLLM Documentation](https://docs.vllm.ai) |
| **CLI Install** | `./cli llm-model vllm install` |
| **CLI Uninstall** | `./cli llm-model vllm uninstall` |
| **Namespace** | `vllm` |

## Overview

vLLM is a fast and memory-efficient inference engine for large language models. Key features:
- **PagedAttention**: Efficient KV cache management inspired by virtual memory paging
- **Continuous Batching**: Dynamic request batching for higher throughput
- **Prefix Caching**: Cache common prompt prefixes to reduce TTFT
- **Quantization Support**: FP8, GPTQ, AWQ, SqueezeLLM
- **Multi-LoRA**: Serve multiple LoRA adapters on a single base model
- **Tensor/Pipeline Parallel**: Distributed inference across multiple GPUs
- **Neuron Support**: AWS Inferentia2/Trainium accelerators

## Installation

```bash
./cli llm-model vllm install
```

The installer:
1. Prompts for model selection from `config.json`
2. Downloads model to PVC (if not cached)
3. Deploys vLLM server with optimal settings
4. Exposes OpenAI-compatible API endpoint

### Model Selection

Pre-configured models in `config.json`:

```json
{
  "llm-model": {
    "vllm": {
      "models": [
        { "name": "qwen3-30b-instruct-fp8", "deploy": true },
        { "name": "qwen3-32b-fp8", "deploy": true },
        { "name": "deepseek-r1-qwen3-8b", "deploy": false },
        { "name": "qwen3-8b-neuron", "deploy": false }
      ]
    }
  }
}
```

## Verification

```bash
# Check vLLM pods
kubectl get pods -n vllm

# Check service
kubectl get svc -n vllm

# Port-forward for testing
kubectl port-forward svc/vllm 8000:8000 -n vllm --address 0.0.0.0 &

# List models
curl http://localhost:8000/v1/models

# Test completion
curl http://localhost:8000/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-30b-instruct-fp8",
    "prompt": "Once upon a time",
    "max_tokens": 50
  }'

# Test chat completion
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-30b-instruct-fp8",
    "messages": [{"role": "user", "content": "Explain quantum computing"}],
    "max_tokens": 200
  }'
```

## Configuration

### Model Download

Models are downloaded to PVC during installation:

- **Storage**: Uses platform-specific StorageClass (NFS for K8s, EFS for EKS)
- **Path**: `/models/<model-name>/`
- **Auto-detection**: Skips download if model files exist

### vLLM Arguments

Common arguments configured via installer or `config.json`:

```bash
# GPU memory utilization
--gpu-memory-utilization 0.90

# Tensor parallel size (split model across N GPUs)
--tensor-parallel-size 2

# Max model length (context size)
--max-model-len 8192

# Quantization
--quantization fp8

# Block size (larger = more memory, fewer blocks)
--block-size 128

# Enable prefix caching
--enable-prefix-caching
```

### Neuron Support

For AWS Inferentia2/Trainium:

```bash
# Select Neuron-optimized model
? Select model: qwen3-8b-neuron

# vLLM automatically uses neuron backend
--device neuron
--tensor-parallel-size 2  # Neuron cores
```

## Advanced Features

### Multi-LoRA Serving

Serve multiple LoRA adapters on a single base model:

```bash
--enable-lora
--max-loras 8
--max-lora-rank 64
```

Then specify LoRA at request time:

```bash
curl http://localhost:8000/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "base-model",
    "prompt": "Once upon a time",
    "lora_name": "my-lora-adapter"
  }'
```

### Speculative Decoding

Use smaller draft model to speed up generation:

```bash
--speculative-model <draft-model-id>
--num-speculative-tokens 5
```

### Chunked Prefill

Enable for long prompts (reduces TTFT at cost of throughput):

```bash
--enable-chunked-prefill
--max-num-batched-tokens 8192
```

### Quantization

#### FP8 (H100/H200)

```bash
--quantization fp8
# Requires FP8 checkpoint or runtime quantization
```

#### GPTQ

```bash
--quantization gptq
# Model must be pre-quantized to GPTQ format
```

#### AWQ

```bash
--quantization awq
# Model must be pre-quantized to AWQ format
```

## Model Management

### List Downloaded Models

```bash
kubectl exec -it -n vllm <vllm-pod> -- ls /models
```

### Add New Model

1. Edit `config.json`:
```json
{
  "llm-model": {
    "vllm": {
      "models": [
        { "name": "my-new-model", "deploy": true }
      ]
    }
  }
}
```

2. Create model config at `components/llm-model/vllm/models/my-new-model.yaml`:
```yaml
modelId: "organization/model-name"
servedModelName: "my-new-model"
tensorParallelSize: 1
gpuMemoryUtilization: 0.90
maxModelLen: 8192
```

3. Reinstall:
```bash
./cli llm-model vllm install
```

## Integration with LiteLLM

vLLM endpoints are automatically discovered by [LiteLLM](../ai-gateway/litellm.md):

```yaml
model_list:
  - model_name: qwen3-30b-instruct-fp8
    litellm_params:
      model: openai/qwen3-30b-instruct-fp8
      api_base: http://vllm.vllm:8000/v1
```

## Performance Tuning

### Memory Optimization

```bash
# Increase GPU memory for KV cache
--gpu-memory-utilization 0.95

# Reduce block size (more blocks, less memory per block)
--block-size 64

# Enable CPU offloading
--cpu-offload-gb 16
```

### Throughput Optimization

```bash
# Increase max parallel requests
--max-num-seqs 256

# Larger block size
--block-size 128

# Disable unnecessary features
--disable-log-requests
```

### Latency Optimization

```bash
# Enable prefix caching
--enable-prefix-caching

# Chunked prefill for long prompts
--enable-chunked-prefill

# Speculative decoding
--speculative-model <draft-model>
```

## Troubleshooting

### OOM (Out of Memory)

```bash
# Reduce GPU memory utilization
--gpu-memory-utilization 0.80

# Reduce max model length
--max-model-len 4096

# Use quantization
--quantization fp8
```

### Low throughput

```bash
# Check logs for warnings
kubectl logs -n vllm -l app=vllm

# Increase max num seqs
--max-num-seqs 512

# Check GPU utilization
kubectl exec -it -n vllm <vllm-pod> -- nvidia-smi
```

### Model download fails

```bash
# Check PVC exists and is bound
kubectl get pvc -n vllm

# Check HuggingFace token (for gated models)
kubectl get secret -n vllm huggingface-secret

# Manual download
kubectl exec -it -n vllm <vllm-pod> -- bash
huggingface-cli download <model-id> --local-dir /models/<model-name>
```

## Learn More

- [vLLM Documentation](https://docs.vllm.ai)
- [vLLM Performance Benchmarks](https://docs.vllm.ai/en/latest/performance_benchmark/benchmarks.html)
- [PagedAttention Paper](https://arxiv.org/abs/2309.06180)
- [Supported Models List](https://docs.vllm.ai/en/latest/models/supported_models.html)
