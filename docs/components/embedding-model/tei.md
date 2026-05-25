# Text Embedding Inference (TEI)

Hugging Face's high-performance inference server for text embedding models. Optimized for production workloads with support for batching, tokenization, and multiple model architectures.

| | |
|---|---|
| **Category** | embedding-model |
| **Official Docs** | [TEI Documentation](https://huggingface.co/docs/text-embeddings-inference) |
| **CLI Install** | `./cli embedding-model tei install` |
| **CLI Uninstall** | `./cli embedding-model tei uninstall` |
| **Namespace** | `tei` |

## Overview

TEI is a purpose-built server for text embeddings with:
- **High Throughput**: Optimized for batch embedding generation
- **Multiple Architectures**: BERT, XLM-RoBERTa, GTE, and more
- **Token Batching**: Automatic batching for optimal throughput
- **CPU & GPU**: Run on CPU for small models or GPU for large models
- **OpenAI-Compatible API**: Drop-in replacement for OpenAI embeddings API
- **Sequence Classification**: Also supports reranking models

## Installation

```bash
./cli embedding-model tei install
```

The installer:
1. Creates the `tei` namespace
2. Sets up PVC for model storage
3. Configures HuggingFace token secret
4. Deploys selected embedding models from `config.json`

### Prerequisites

- `HF_TOKEN` environment variable set in `.env`

### Model Selection

Pre-configured models in `config.json`:

```json
{
  "embedding-model": {
    "tei": {
      "models": [
        { "name": "qwen3-embedding-06b-bf16-cpu", "deploy": true },
        { "name": "qwen3-embedding-06b-bf16", "deploy": false },
        { "name": "qwen3-embedding-4b-bf16", "deploy": false },
        { "name": "qwen3-embedding-8b-bf16", "deploy": false }
      ]
    }
  }
}
```

The `-cpu` suffix models run on CPU nodes (no GPU required), while others require GPU nodes.

## Verification

```bash
# Check TEI pods
kubectl get pods -n tei

# Check service
kubectl get svc -n tei

# Port-forward for testing
kubectl port-forward svc/tei 8080:8080 -n tei --address 0.0.0.0 &

# Test embedding generation
curl http://localhost:8080/embed \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": "What is deep learning?"
  }'

# Test OpenAI-compatible endpoint
curl http://localhost:8080/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-embedding-06b-bf16-cpu",
    "input": "What is deep learning?"
  }'
```

## Configuration

### Model Templates

Each model has a template at `components/embedding-model/tei/model-<name>.template.yaml` defining:
- Model ID (HuggingFace repository)
- Resource requests (CPU/GPU, memory)
- TEI server arguments
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
./cli embedding-model tei configure-models

# Add models
./cli embedding-model tei add-models

# Update models
./cli embedding-model tei update-models

# Remove all models
./cli embedding-model tei remove-all-models
```

## Usage

### From Python

```python
import requests

response = requests.post(
    "http://tei.tei:8080/v1/embeddings",
    json={
        "model": "qwen3-embedding-06b-bf16-cpu",
        "input": ["What is deep learning?", "How does attention work?"]
    }
)
embeddings = response.json()["data"]
```

### With Vector Databases

TEI embeddings can be stored in [Qdrant](../vector-database/qdrant.md), [Chroma](../vector-database/chroma.md), or [Milvus](../vector-database/milvus.md) for similarity search.

## Troubleshooting

### Model download fails

```bash
# Check PVC exists and is bound
kubectl get pvc -n tei

# Check HuggingFace token
kubectl get secret -n tei huggingface-secret

# Check pod logs
kubectl logs -n tei -l app=tei -f
```

### High latency

```bash
# Check if model is on CPU vs GPU
kubectl describe pod -n tei -l app=tei | grep -A5 "Resources"

# Consider GPU model variant for lower latency
```

## Learn More

- [TEI Documentation](https://huggingface.co/docs/text-embeddings-inference)
- [TEI GitHub Repository](https://github.com/huggingface/text-embeddings-inference)
- [Supported Models](https://huggingface.co/docs/text-embeddings-inference/supported_models)
