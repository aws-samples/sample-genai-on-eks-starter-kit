# TGI

Text Generation Inference (TGI) is a high-performance inference server from Hugging Face, optimized for serving large language models with features like continuous batching, tensor parallelism, and quantization.

| | |
|---|---|
| **Category** | llm-model |
| **Official Docs** | [TGI Documentation](https://huggingface.co/docs/text-generation-inference) |
| **CLI Install** | `./cli llm-model tgi install` |
| **CLI Uninstall** | `./cli llm-model tgi uninstall` |
| **Namespace** | `tgi` |

## Overview

TGI is Hugging Face's production-ready inference server for LLMs. Key features:
- **Continuous Batching**: Dynamic request batching for optimal GPU utilization
- **Tensor Parallelism**: Distribute models across multiple GPUs
- **Quantization**: GPTQ, AWQ, and bitsandbytes support
- **Flash Attention**: Optimized attention kernels for faster inference
- **Token Streaming**: Server-sent events for real-time token generation
- **Neuron Support**: AWS Inferentia2/Trainium accelerators

## Installation

```bash
./cli llm-model tgi install
```

The installer:
1. Creates the `tgi` namespace
2. Sets up PVC for HuggingFace model cache
3. Configures HuggingFace token secret
4. Deploys selected models from `config.json`

### Prerequisites

- `HF_TOKEN` environment variable set in `.env` (required for gated models)

### Model Selection

Pre-configured models in `config.json`:

```json
{
  "llm-model": {
    "tgi": {
      "models": [
        { "name": "deepseek-r1-qwen3-8b", "deploy": false },
        { "name": "qwen3-8b", "deploy": false },
        { "name": "qwen3-8b-fp8", "deploy": false }
      ]
    }
  }
}
```

## Verification

```bash
# Check TGI pods
kubectl get pods -n tgi

# Check service
kubectl get svc -n tgi

# Port-forward for testing
kubectl port-forward svc/tgi 8080:8080 -n tgi --address 0.0.0.0 &

# Test text generation
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tgi",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }'
```

## Configuration

### Model Templates

Each model has a template file at `components/llm-model/tgi/model-<name>.template.yaml` that defines:
- Model ID (HuggingFace repository)
- Resource requests (GPU, memory)
- TGI server arguments
- Node selectors

### Environment Variables

Configure in `.env`:

```bash
# Required for gated models
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxx
```

## Model Management

```bash
# Configure models
./cli llm-model tgi configure-models

# Add models
./cli llm-model tgi add-models

# Update models
./cli llm-model tgi update-models

# Remove all models
./cli llm-model tgi remove-all-models
```

## Integration with LiteLLM

TGI endpoints are automatically discovered by [LiteLLM](../ai-gateway/litellm.md):

```yaml
model_list:
  - model_name: qwen3-8b-tgi
    litellm_params:
      model: openai/qwen3-8b
      api_base: http://qwen3-8b.tgi:8080/v1
```

## Troubleshooting

### Model download fails

```bash
# Check PVC exists and is bound
kubectl get pvc -n tgi

# Check HuggingFace token
kubectl get secret -n tgi huggingface-secret

# Check pod logs for download progress
kubectl logs -n tgi -l app=tgi -f
```

### OOM (Out of Memory)

```bash
# Check pod events
kubectl describe pod -n tgi -l app=tgi

# Try quantized model variant (e.g., fp8)
# Or increase GPU node instance type
```

### Pod stuck in Pending

```bash
# Check if GPU nodes are available
kubectl get nodes -l nvidia.com/gpu.present=true

# Check Karpenter provisioning
kubectl logs -n kube-system -l app.kubernetes.io/name=karpenter
```

## Learn More

- [TGI Documentation](https://huggingface.co/docs/text-generation-inference)
- [TGI GitHub Repository](https://github.com/huggingface/text-generation-inference)
- [Supported Models](https://huggingface.co/docs/text-generation-inference/supported_models)
