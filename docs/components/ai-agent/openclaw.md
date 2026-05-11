# OpenClaw

Lightweight bridge server that orchestrates AI coding agents on Kubernetes. Provides a stateless, Git-native workflow where agents clone repositories, make changes, commit, and push within ephemeral containers.

| | |
|---|---|
| **Category** | ai-agent |
| **Official Docs** | [OpenClaw Repository](https://github.com/openclaw/openclaw) |
| **CLI Install** | `./cli ai-agent openclaw install` |
| **CLI Uninstall** | `./cli ai-agent openclaw uninstall` |
| **Namespace** | `openclaw` |

## Overview

OpenClaw deploys a central bridge server that:
- **Task Routing**: Receives task requests and routes to appropriate agent containers
- **Real-Time Streaming**: Streams agent responses back to clients
- **LiteLLM Integration**: Routes all LLM calls through LiteLLM gateway
- **Langfuse Observability**: Sends traces for monitoring and debugging
- **Open WebUI Integration**: Works as a backend for Open WebUI pipe functions
- **Stateless Design**: Git is the durable store; containers are ephemeral

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Open WebUI                               │
│                    (GUI, Pipe Functions)                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Bridge Server                        │
│                  (Task Router, Orchestrator)                     │
│                  http://openclaw.openclaw:8080                   │
└─────────┬───────────────────────────────────────────┬───────────┘
          │                                           │
          ▼                                           ▼
┌──────────────────────┐                  ┌──────────────────────┐
│  Doc Writer Agent    │                  │   DevOps Agent       │
│  (Example)           │                  │   (Example)          │
└──────────────────────┘                  └──────────────────────┘
          │                                           │
          └───────────────────┬───────────────────────┘
                              ▼
                    ┌──────────────────────┐
                    │   LiteLLM Gateway    │
                    └──────────────────────┘
```

## Installation

### Prerequisites

- [LiteLLM](../ai-gateway/litellm.md) installed (`./cli ai-gateway litellm install`)
- `LITELLM_API_KEY` set in `.env`

### Install

```bash
./cli ai-agent openclaw install
```

The installer:
1. Deploys the bridge server using a pre-built public ECR image
2. Creates Kubernetes Service at `http://openclaw.openclaw:8080`
3. Auto-detects and configures Langfuse integration if available

## Verification

```bash
# Check pods
kubectl get pods -n openclaw

# Check service
kubectl get svc -n openclaw

# Check logs
kubectl logs -n openclaw -l app=openclaw

# Test health endpoint
kubectl port-forward -n openclaw svc/openclaw 8080:8080
curl http://localhost:8080/health
```

Expected output:

```json
{"status":"ok"}
```

## Configuration

### config.json

```json
{
  "ai-agent": {
    "openclaw": {
      "env": {
        "LITELLM_MODEL_NAME": "bedrock/claude-4.5-sonnet",
        "OPENCLAW_GATEWAY_TOKEN": "openclaw-gateway-token"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Authentication token | `openclaw-gateway-token` |
| `LITELLM_BASE_URL` | LiteLLM API endpoint | `http://litellm.litellm:4000` |
| `LITELLM_API_KEY` | LiteLLM API key | From `.env` |
| `LITELLM_MODEL_NAME` | Default model | `bedrock/claude-4.5-sonnet` |
| `LANGFUSE_HOST` | Langfuse endpoint (optional) | `http://langfuse-web.langfuse:3000` |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key (optional) | From `.env` |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key (optional) | From `.env` |

### Switching Models

Update `LITELLM_MODEL_NAME` in `config.json` and reinstall:

```bash
./cli ai-agent openclaw uninstall
./cli ai-agent openclaw install
```

## Integration

### Langfuse

If [Langfuse](../observability/langfuse.md) is installed, OpenClaw automatically sends traces for:
- Task submissions and agent responses
- LLM API calls with token usage
- Error events and latency metrics

### Open WebUI

[Open WebUI](../gui-app/openwebui.md) connects to OpenClaw via pipe functions to provide agent capabilities in the chat interface.

## Examples

See the following examples for complete agent implementations:

- [Document Writer Agent](../../examples/openclaw/doc-writer.md): Clones Git repos, writes documentation, commits and pushes
- [DevOps Agent](../../examples/openclaw/devops-agent.md): Interactive cluster management with kubectl, helm, and AWS CLI

## Cost Optimization

- **Stateless containers**: No persistent storage (Git is the durable store)
- **Spot instances**: Karpenter provisions Spot ARM64 nodes (up to 90% savings)
- **Ephemeral execution**: Jobs terminate after completion
- **Estimated cost**: ~$0 at rest, ~$0.02-0.05 per task (excluding LLM API costs)

## Security

- **Authentication**: Optional Bearer token auth via `OPENCLAW_GATEWAY_TOKEN`
- **Network**: Bridge server only accessible within cluster (ClusterIP service)
- **RBAC**: ServiceAccount with minimal permissions

## Troubleshooting

### Bridge server not starting

```bash
# Check pod events
kubectl describe pod -n openclaw -l app=openclaw

# Check logs
kubectl logs -n openclaw -l app=openclaw
```

### Cannot connect to LiteLLM

```bash
# Check LiteLLM is running
kubectl get pods -n litellm

# Test from OpenClaw pod
kubectl exec -it -n openclaw <openclaw-pod> -- \
  curl http://litellm.litellm:4000/health
```

### Agent tasks failing

```bash
# Check agent logs
kubectl logs -n openclaw -l app=openclaw --tail=100

# Check Langfuse traces for error details
```

## Learn More

- [OpenClaw Repository](https://github.com/openclaw/openclaw)
- [LiteLLM Documentation](https://docs.litellm.ai)
- [Langfuse Documentation](https://langfuse.com/docs)
