# OpenClaw AI Agent Orchestrator

OpenClaw is a lightweight bridge server that orchestrates AI coding agents (Claude Code, Kiro CLI) on Kubernetes. It provides a stateless, Git-native workflow where agents clone repositories, make changes, commit, and push — all within ephemeral containers.

## Overview

The OpenClaw component deploys a central bridge server that:
- Receives task requests from Open WebUI via HTTP API
- Routes tasks to appropriate agent containers
- Streams responses back in real-time
- Integrates with LiteLLM for model routing
- Sends traces to Langfuse for observability

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

## Prerequisites

- EKS cluster (Auto Mode or Standard Mode)
- LiteLLM component installed (`./cli ai-gateway litellm install`)
- Docker with Buildx support (for multi-arch builds)
- AWS CLI configured with ECR access
- kubectl configured to access the cluster

## Installation

### 1. Configure Environment Variables

Add to `.env`:

```bash
# Required
LITELLM_API_KEY=sk-1234567890abcdef

# Optional (for observability)
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
```

### 2. Install OpenClaw Component

```bash
./cli ai-agent openclaw install
```

This will:
1. Create ECR repository for the bridge server image
2. Build multi-arch Docker image (amd64, arm64)
3. Push image to ECR
4. Deploy bridge server to `openclaw` namespace
5. Create Kubernetes Service at `http://openclaw.openclaw:8080`

### 3. Verify Installation

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

### Environment Variables

The bridge server uses the following environment variables (configured via `config.json`):

| Variable | Description | Default |
|---|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Authentication token for OpenClaw Gateway | `openclaw-gateway-token` |
| `LITELLM_BASE_URL` | LiteLLM API endpoint | `http://litellm.litellm:4000` |
| `LITELLM_API_KEY` | LiteLLM API key | From `.env` |
| `LITELLM_MODEL_NAME` | Default model to use | `vllm/qwen3-30b-instruct-fp8` |
| `LANGFUSE_HOST` | Langfuse endpoint (optional) | `http://langfuse-web.langfuse:3000` |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key (optional) | From `.env` |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key (optional) | From `.env` |

### config.json

```json
{
  "ai-agent": {
    "openclaw": {
      "env": {
        "LITELLM_MODEL_NAME": "vllm/qwen3-30b-instruct-fp8",
        "OPENCLAW_GATEWAY_TOKEN": "openclaw-gateway-token"
      }
    }
  }
}
```

## API Endpoints

### Health Check

```bash
GET /health
```

Returns:
```json
{"status":"ok"}
```

### Submit Task

```bash
POST /message
Content-Type: application/json

{
  "message": "Your task description here"
}
```

Returns: Server-Sent Events (SSE) stream

```
data: {"content":"Response chunk 1"}
data: {"content":"Response chunk 2"}
data: [DONE]
```

### Status

```bash
GET /status
```

Returns:
```json
{
  "status": "running",
  "uptime": 3600,
  "lastActivity": "2025-02-14T09:42:00.000Z"
}
```

## Integration with LiteLLM

OpenClaw routes all LLM API calls through LiteLLM, which provides:
- Unified OpenAI-compatible API
- Model routing (vLLM, SGLang, TGI, Bedrock)
- Load balancing
- Rate limiting
- Cost tracking

To switch models, update `LITELLM_MODEL_NAME` in `config.json`:

```json
{
  "ai-agent": {
    "openclaw": {
      "env": {
        "LITELLM_MODEL_NAME": "bedrock/us.anthropic.claude-opus-4-5-20251101-v1:0"
      }
    }
  }
}
```

Then reinstall:
```bash
./cli ai-agent openclaw uninstall
./cli ai-agent openclaw install
```

## Integration with Langfuse

If Langfuse is installed, OpenClaw automatically sends execution traces for:
- Task submissions
- LLM API calls
- Agent responses
- Error events

View traces in Langfuse UI to:
- Monitor agent performance
- Debug failures
- Analyze token usage
- Track latency

## Troubleshooting

### Bridge Server Not Starting

```bash
# Check pod status
kubectl get pods -n openclaw

# Check logs
kubectl logs -n openclaw -l app=openclaw

# Common issues:
# 1. LiteLLM not available
kubectl get pods -n litellm

# 2. Invalid API key
kubectl get secret -n openclaw
```

### Connection Refused

```bash
# Verify service exists
kubectl get svc -n openclaw

# Test from within cluster
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://openclaw.openclaw:8080/health
```

### Image Pull Errors

```bash
# Check ECR repository
aws ecr describe-repositories --repository-names genai-on-eks-openclaw-openclaw

# Re-authenticate Docker
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-west-2.amazonaws.com
```

### Langfuse Integration Not Working

```bash
# Verify Langfuse is running
kubectl get pods -n langfuse

# Check environment variables
kubectl get deployment -n openclaw openclaw -o yaml | grep LANGFUSE
```

## Uninstallation

```bash
./cli ai-agent openclaw uninstall
```

This will:
1. Delete Kubernetes resources (Deployment, Service, ServiceAccount)
2. Destroy ECR repository via Terraform

## Examples

See the following examples for complete agent implementations:

- **Document Writer Agent**: `examples/openclaw/doc-writer/`
  - Clones Git repos, writes documentation, commits and pushes
  - Uses KEDA for scale-to-zero
  - Integrates with Open WebUI

- **DevOps Agent**: `examples/openclaw/devops-agent/`
  - Interactive cluster management assistant
  - Has kubectl, helm, AWS CLI
  - Read-only RBAC permissions

## Cost Optimization

OpenClaw follows a cost-first design:

- **Stateless containers**: No persistent storage needed (Git is the durable store)
- **Scale-to-zero**: Agent examples use KEDA to scale to 0 when idle
- **Spot instances**: Karpenter provisions Spot ARM64 nodes (up to 90% savings)
- **Ephemeral execution**: Doc writer uses Jobs that terminate after completion

Estimated cost: ~$0 at rest, ~$0.02-0.05 per task execution (excluding LLM API costs)

## Security Considerations

- **Authentication**: Optional Bearer token auth via `BRIDGE_AUTH_TOKEN`
- **Network**: Bridge server only accessible within cluster (ClusterIP service)
- **Credentials**: LiteLLM API key stored in environment variables
- **RBAC**: ServiceAccount with minimal permissions (no cluster access)

## References

- [OpenClaw Repository](https://github.com/openclaw/openclaw)
- [LiteLLM Documentation](https://docs.litellm.ai/)
- [Langfuse Documentation](https://langfuse.com/docs)
- [KEDA Documentation](https://keda.sh/docs/)
