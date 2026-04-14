# Ollama

Run open-source LLMs locally with a simple API. Ollama bundles model weights, configurations, and runtime into a single package, making it easy to deploy and manage models on Kubernetes.

| | |
|---|---|
| **Category** | llm-model |
| **Official Docs** | [Ollama Documentation](https://ollama.com) |
| **CLI Install** | `./cli llm-model ollama install` |
| **CLI Uninstall** | `./cli llm-model ollama uninstall` |
| **Namespace** | `ollama` |

## Overview

Ollama provides a lightweight runtime for running LLMs with:
- **Simple Model Management**: Pull models with a single command
- **OpenAI-Compatible API**: Drop-in replacement for OpenAI API
- **GPU Acceleration**: Automatic GPU detection and utilization
- **Model Library**: Access to a wide range of pre-packaged models
- **Concurrent Models**: Run multiple models simultaneously
- **Embedding Support**: Built-in embedding model support

## Installation

```bash
./cli llm-model ollama install
```

The installer:
1. Creates the `ollama` namespace and PVC for model storage
2. Generates ConfigMap with selected model list
3. Deploys Ollama server with GPU support
4. Creates Service and Ingress
5. Auto-pulls configured models on startup

### Model Selection

Models are configured as a simple list in `config.json`:

```json
{
  "llm-model": {
    "ollama": {
      "models": [
        "qwen3:32b",
        "qwen3:30b",
        "gemma3:27b",
        "deepseek-r1:8b",
        "nomic-embed-text:v1.5"
      ]
    }
  }
}
```

## Verification

```bash
# Check Ollama pods
kubectl get pods -n ollama

# Check service
kubectl get svc -n ollama

# Port-forward for testing
kubectl port-forward svc/ollama 11434:11434 -n ollama --address 0.0.0.0 &

# List models
curl http://localhost:11434/api/tags

# Test chat completion (OpenAI-compatible)
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3:32b",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }'

# Test with Ollama native API
curl http://localhost:11434/api/generate \
  -d '{
    "model": "qwen3:32b",
    "prompt": "Explain quantum computing",
    "stream": false
  }'
```

## Configuration

### Adding Models

Edit `config.json` and reinstall:

```json
{
  "llm-model": {
    "ollama": {
      "models": [
        "qwen3:32b",
        "my-new-model:latest"
      ]
    }
  }
}
```

```bash
./cli llm-model ollama install
```

### Environment Variables

The Ollama deployment automatically adapts to the EKS mode:

| Variable | Description |
|---|---|
| `EKS_MODE` | `auto` or `standard` - affects Karpenter node selector prefix |
| `DOMAIN` | Domain for ingress (optional) |

## Integration with LiteLLM

Ollama endpoints are automatically discovered by [LiteLLM](../ai-gateway/litellm.md):

```yaml
model_list:
  - model_name: qwen3-32b-ollama
    litellm_params:
      model: ollama/qwen3:32b
      api_base: http://ollama.ollama:11434
```

## Troubleshooting

### Models not pulling

```bash
# Check init container logs (model pull happens at startup)
kubectl logs -n ollama -l app=ollama -c init-pull

# Check main container logs
kubectl logs -n ollama -l app=ollama

# Manually pull a model
kubectl exec -it -n ollama <ollama-pod> -- ollama pull qwen3:32b
```

### Slow inference

```bash
# Check GPU is being used
kubectl exec -it -n ollama <ollama-pod> -- nvidia-smi

# Check if model fits in GPU memory
kubectl exec -it -n ollama <ollama-pod> -- ollama ps
```

### PVC storage full

```bash
# Check PVC usage
kubectl exec -it -n ollama <ollama-pod> -- df -h /root/.ollama

# Remove unused models
kubectl exec -it -n ollama <ollama-pod> -- ollama rm <model-name>
```

## Learn More

- [Ollama Documentation](https://ollama.com)
- [Ollama Model Library](https://ollama.com/library)
- [Ollama API Reference](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [OpenAI Compatibility](https://github.com/ollama/ollama/blob/main/docs/openai.md)
