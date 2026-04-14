# SGLang

Fast LLM serving engine with RadixAttention for automatic KV cache reuse. Optimized for multi-turn conversations and structured generation workloads.

| | |
|---|---|
| **Category** | llm-model |
| **Official Docs** | [SGLang Documentation](https://docs.sglang.ai) |
| **CLI Install** | `./cli llm-model sglang install` |
| **CLI Uninstall** | `./cli llm-model sglang uninstall` |
| **Namespace** | `sglang` |

## Overview

SGLang (Structured Generation Language) is a high-performance LLM serving engine featuring:
- **RadixAttention**: Automatic KV cache reuse via radix tree structure
- **Structured Generation**: JSON schema-constrained outputs
- **Multi-Turn Optimization**: Efficient caching for conversational workloads
- **Continuous Batching**: Dynamic request batching for higher throughput
- **Tensor Parallel**: Distributed inference across multiple GPUs

## Installation

```bash
./cli llm-model sglang install
```

The installer:
1. Prompts for model selection from `config.json`
2. Downloads model to PVC (if not cached)
3. Deploys SGLang server with RadixAttention enabled
4. Exposes OpenAI-compatible API endpoint

### Model Selection

Pre-configured models in `config.json`:

```json
{
  "llm-model": {
    "sglang": {
      "models": [
        { "name": "qwen3-30b-instruct-fp8", "deploy": true },
        { "name": "qwen3-32b-fp8", "deploy": true },
        { "name": "gpt-oss-20b", "deploy": false }
      ]
    }
  }
}
```

## Verification

```bash
# Check SGLang pods
kubectl get pods -n sglang

# Check service
kubectl get svc -n sglang

# Port-forward for testing
kubectl port-forward svc/sglang 8000:8000 -n sglang --address 0.0.0.0 &

# List models
curl http://localhost:8000/v1/models

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

### RadixAttention

RadixAttention is enabled by default and automatically caches KV states in a radix tree structure. This provides:
- **Automatic prefix matching**: Shared prompt prefixes reuse cached KV blocks
- **Multi-turn efficiency**: Conversation history cached without manual management
- **Zero configuration**: No need to specify cache keys or session IDs

### SGLang Arguments

Common arguments configured via installer:

```bash
# Tensor parallel size
--tp 2

# Memory fraction
--mem-fraction-static 0.85

# Context length
--context-length 8192

# Disable RadixAttention (not recommended)
--disable-radix-cache

# Chunked prefill
--chunked-prefill-size 4096
```

## Advanced Features

### Structured Generation

Constrain outputs to JSON schema:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-30b-instruct-fp8",
    "messages": [
      {"role": "user", "content": "Generate a person profile"}
    ],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "person",
        "schema": {
          "type": "object",
          "properties": {
            "name": {"type": "string"},
            "age": {"type": "integer"},
            "occupation": {"type": "string"}
          },
          "required": ["name", "age"]
        }
      }
    }
  }'
```

### Regex-Constrained Generation

Force outputs to match regex patterns:

```python
import requests

response = requests.post(
    "http://localhost:8000/generate",
    json={
        "text": "Generate a phone number: ",
        "sampling_params": {
            "max_new_tokens": 20,
            "regex": r"\d{3}-\d{3}-\d{4}"  # Format: 123-456-7890
        }
    }
)
```

### Multi-Turn Conversations

RadixAttention automatically optimizes multi-turn conversations:

```python
import openai

client = openai.OpenAI(
    api_key="EMPTY",
    base_url="http://localhost:8000/v1"
)

messages = [
    {"role": "user", "content": "What is the capital of France?"}
]

# Turn 1
response = client.chat.completions.create(
    model="qwen3-30b-instruct-fp8",
    messages=messages
)
messages.append({"role": "assistant", "content": response.choices[0].message.content})

# Turn 2 - conversation history automatically cached
messages.append({"role": "user", "content": "What is its population?"})
response = client.chat.completions.create(
    model="qwen3-30b-instruct-fp8",
    messages=messages
)
```

## Model Management

### Add New Model

1. Edit `config.json`:
```json
{
  "llm-model": {
    "sglang": {
      "models": [
        { "name": "my-new-model", "deploy": true }
      ]
    }
  }
}
```

2. Create model config at `components/llm-model/sglang/models/my-new-model.yaml`:
```yaml
modelId: "organization/model-name"
servedModelName: "my-new-model"
tensorParallelSize: 1
memFractionStatic: 0.85
contextLength: 8192
```

3. Reinstall:
```bash
./cli llm-model sglang install
```

## Integration with LiteLLM

SGLang endpoints are automatically discovered by [LiteLLM](../ai-gateway/litellm.md):

```yaml
model_list:
  - model_name: qwen3-30b-instruct-fp8-sglang
    litellm_params:
      model: openai/qwen3-30b-instruct-fp8
      api_base: http://sglang.sglang:8000/v1
```

## Performance Tuning

### Memory Optimization

```bash
# Reduce static memory fraction (leave more for KV cache)
--mem-fraction-static 0.80

# Smaller context length
--context-length 4096
```

### Throughput Optimization

```bash
# Enable chunked prefill for long prompts
--chunked-prefill-size 8192

# Larger batch size (more memory usage)
--max-running-requests 512
```

### Latency Optimization

RadixAttention automatically optimizes TTFT for repeated prompts. For first-time prompts:

```bash
# Enable chunked prefill
--chunked-prefill-size 4096
```

## Troubleshooting

### OOM (Out of Memory)

```bash
# Reduce memory fraction
--mem-fraction-static 0.75

# Reduce context length
--context-length 4096

# Use smaller TP size (if multi-GPU)
--tp 1
```

### Cache not working

```bash
# Check RadixAttention is enabled (should NOT see this flag)
--disable-radix-cache

# Check logs for cache hit statistics
kubectl logs -n sglang -l app=sglang | grep "cache_hit"
```

### Model download fails

```bash
# Check PVC exists and is bound
kubectl get pvc -n sglang

# Check HuggingFace token
kubectl get secret -n sglang huggingface-secret

# Manual download
kubectl exec -it -n sglang <sglang-pod> -- bash
huggingface-cli download <model-id> --local-dir /models/<model-name>
```

## Learn More

- [SGLang Documentation](https://docs.sglang.ai)
- [RadixAttention Paper](https://arxiv.org/abs/2312.07104)
- [Structured Generation Guide](https://docs.sglang.ai/en/latest/structured_generation.html)
- [Supported Models List](https://docs.sglang.ai/en/latest/supported_models.html)
