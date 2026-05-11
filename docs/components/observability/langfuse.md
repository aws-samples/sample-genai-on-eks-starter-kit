# Langfuse

Open-source LLM observability platform for tracing, evaluating, and monitoring AI applications. Provides detailed visibility into LLM calls, token usage, latency, and costs.

| | |
|---|---|
| **Category** | observability |
| **Official Docs** | [Langfuse Documentation](https://langfuse.com/docs) |
| **CLI Install** | `./cli o11y langfuse install` |
| **CLI Uninstall** | `./cli o11y langfuse uninstall` |
| **Namespace** | `langfuse` |

## Overview

Langfuse is the default observability backend for the starter kit:
- **LLM Tracing**: Trace every LLM call with input/output, tokens, latency
- **Cost Tracking**: Monitor spend per model, user, or feature
- **Evaluations**: Score traces with manual or automated evaluations
- **Prompt Management**: Version and manage prompts
- **Datasets**: Create test datasets for evaluation
- **Dashboards**: Built-in analytics and monitoring
- **S3 Storage**: Uses Terraform-provisioned S3 bucket for blob storage

## Installation

### Prerequisites

Configure in `.env`:

```bash
LANGFUSE_USERNAME=admin
LANGFUSE_PASSWORD=your-password
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxx
```

### Install

```bash
./cli o11y langfuse install
```

The installer:
1. Provisions an S3 bucket via Terraform for blob storage
2. Adds the Langfuse Helm chart repository
3. Renders Helm values with credentials and bucket configuration
4. Deploys Langfuse to the `langfuse` namespace

## Verification

```bash
# Check pods
kubectl get pods -n langfuse

# Check service
kubectl get svc -n langfuse

# Port-forward for UI access
kubectl port-forward svc/langfuse-web 3000:3000 -n langfuse --address 0.0.0.0 &

# Access Langfuse UI
open http://localhost:3000
```

Log in with `LANGFUSE_USERNAME` and `LANGFUSE_PASSWORD`.

## Integration

### LiteLLM

[LiteLLM](../ai-gateway/litellm.md) automatically sends traces to Langfuse when installed. Traces include:
- Request/response pairs
- Token usage per request
- Latency breakdown
- Model routing decisions

### OpenClaw

[OpenClaw](../ai-agent/openclaw.md) sends agent execution traces to Langfuse when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are configured.

### Custom Applications

```python
from langfuse import Langfuse

langfuse = Langfuse(
    public_key="pk-lf-xxx",
    secret_key="sk-lf-xxx",
    host="http://langfuse-web.langfuse:3000"
)

trace = langfuse.trace(name="my-app")
generation = trace.generation(
    name="chat",
    model="qwen3-30b-instruct-fp8",
    input=[{"role": "user", "content": "Hello"}],
    output="Hi there!"
)
```

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `LANGFUSE_USERNAME` | Admin username |
| `LANGFUSE_PASSWORD` | Admin password |
| `LANGFUSE_PUBLIC_KEY` | API public key for SDK integrations |
| `LANGFUSE_SECRET_KEY` | API secret key for SDK integrations |
| `DOMAIN` | Domain for ingress (optional) |

### Infrastructure

Langfuse uses Terraform to provision:
- S3 bucket for blob storage (traces, datasets)
- IAM roles via IRSA for S3 access

## Troubleshooting

### UI not loading

```bash
# Check web pod status
kubectl get pods -n langfuse -l app=web

# Check logs
kubectl logs -n langfuse -l app=web
```

### Traces not appearing

```bash
# Check LiteLLM integration
kubectl logs -n litellm -l app=litellm | grep langfuse

# Verify Langfuse credentials
echo $LANGFUSE_PUBLIC_KEY
echo $LANGFUSE_SECRET_KEY
```

### Database issues

```bash
# Check database pod
kubectl get pods -n langfuse -l app=postgresql

# Check database logs
kubectl logs -n langfuse -l app=postgresql
```

## Learn More

- [Langfuse Documentation](https://langfuse.com/docs)
- [Langfuse GitHub](https://github.com/langfuse/langfuse)
- [Langfuse Python SDK](https://langfuse.com/docs/sdk/python)
- [LiteLLM Integration](https://langfuse.com/docs/integrations/litellm)
