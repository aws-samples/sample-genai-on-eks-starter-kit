# Phoenix

Arize Phoenix is an open-source AI observability platform for evaluating, troubleshooting, and fine-tuning LLM applications. Provides real-time tracing, embedding visualization, and evaluation tools.

| | |
|---|---|
| **Category** | observability |
| **Official Docs** | [Phoenix Documentation](https://docs.arize.com/phoenix) |
| **CLI Install** | `./cli o11y phoenix install` |
| **CLI Uninstall** | `./cli o11y phoenix uninstall` |
| **Namespace** | `phoenix` |

## Overview

Phoenix provides AI-native observability:
- **LLM Tracing**: OpenTelemetry-based tracing for LLM calls
- **Embedding Analysis**: Visualize and analyze embedding drift
- **Evaluations**: LLM-as-judge and custom evaluation metrics
- **Retrieval Analysis**: Debug RAG pipeline retrieval quality
- **Datasets**: Create and manage evaluation datasets
- **Experiments**: Run and compare prompt experiments

## Installation

```bash
./cli o11y phoenix install
```

The installer:
1. Renders Helm values with domain configuration
2. Deploys Phoenix using the official OCI Helm chart
3. Creates the `phoenix` namespace

No additional environment variables are required.

## Verification

```bash
# Check pods
kubectl get pods -n phoenix

# Check service
kubectl get svc -n phoenix

# Port-forward for UI access
kubectl port-forward svc/phoenix 6006:6006 -n phoenix --address 0.0.0.0 &

# Access Phoenix UI
open http://localhost:6006
```

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `DOMAIN` | Domain for ingress (optional) |

## Usage

### OpenTelemetry Integration

Phoenix supports OpenTelemetry-based instrumentation:

```python
from phoenix.otel import register

tracer_provider = register(
    endpoint="http://phoenix.phoenix:6006/v1/traces"
)
```

### LLM Tracing

```python
from openinference.instrumentation.openai import OpenAIInstrumentor

OpenAIInstrumentor().instrument(tracer_provider=tracer_provider)

# All OpenAI calls are now traced
from openai import OpenAI
client = OpenAI(base_url="http://litellm.litellm:4000/v1", api_key="sk-1234")
response = client.chat.completions.create(
    model="vllm/qwen3-30b-instruct-fp8",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### Embedding Visualization

```python
import phoenix as px

px.launch_app()
# Upload embeddings for visualization and drift detection
```

## Troubleshooting

### UI not loading

```bash
# Check pod status
kubectl get pods -n phoenix

# Check logs
kubectl logs -n phoenix -l app=phoenix
```

### Traces not appearing

```bash
# Verify OTLP endpoint is reachable
kubectl exec -it -n <app-namespace> <app-pod> -- \
  curl http://phoenix.phoenix:6006/v1/traces
```

## Learn More

- [Phoenix Documentation](https://docs.arize.com/phoenix)
- [Phoenix GitHub](https://github.com/Arize-ai/phoenix)
- [OpenInference](https://github.com/Arize-ai/openinference)
- [Phoenix Helm Chart](https://hub.docker.com/r/arizephoenix/phoenix-helm)
