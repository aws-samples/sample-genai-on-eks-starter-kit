# OpenClaw Document Writer Agent

An AI-powered documentation agent that automatically generates and updates documentation in Git repositories. The agent clones repos, analyzes code, writes comprehensive documentation, and commits changes back to the repository.

## Use Case

The Document Writer Agent is designed for:
- Generating README files for new projects
- Updating API documentation
- Creating user guides and tutorials
- Maintaining changelog files
- Writing code comments and docstrings

## Architecture

```
User (Open WebUI)
  │
  ├─> POST /message {"message": "Write README for https://github.com/user/repo"}
  │
  ▼
Doc Writer Agent (K8s Job)
  │
  ├─> git clone https://github.com/user/repo
  ├─> Analyze code structure
  ├─> Call LiteLLM API (Claude/GPT/etc.)
  ├─> Generate documentation
  ├─> git add, commit, push
  └─> Stream response back to user
```

## Prerequisites

- OpenClaw bridge server installed (`./cli ai-agent openclaw install`)
- LiteLLM component installed (`./cli ai-gateway litellm install`)
- Open WebUI component installed (`./cli gui-app openwebui install`)
- Git credentials configured in `.env`
- Docker with Buildx support

## Installation

### 1. Configure Environment Variables

Add to `.env`:

```bash
# Required
LITELLM_API_KEY=sk-1234567890abcdef

# Git credentials for doc-writer
OPENCLAW_DOC_WRITER_GIT_USERNAME=your-github-username
OPENCLAW_DOC_WRITER_GIT_TOKEN=ghp_your_github_token

# Optional (for observability)
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
```

### 2. Install Document Writer Agent

```bash
./cli examples openclaw doc-writer install
```

This will:
1. Create ECR repository for the agent image
2. Build multi-arch Docker image with Git and Claude Code
3. Push image to ECR
4. Deploy agent as Kubernetes Deployment
5. Create Service at `http://doc-writer.openclaw:8080`

### 3. Verify Installation

```bash
# Check pods
kubectl get pods -n openclaw -l app=doc-writer

# Check service
kubectl get svc -n openclaw doc-writer

# Check logs
kubectl logs -n openclaw -l app=doc-writer

# Test health endpoint
kubectl port-forward -n openclaw svc/doc-writer 8080:8080
curl http://localhost:8080/health
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Authentication token | `openclaw-gateway-token` |
| `LITELLM_BASE_URL` | LiteLLM API endpoint | `http://litellm.litellm:4000` |
| `LITELLM_API_KEY` | LiteLLM API key | From `.env` |
| `LITELLM_MODEL_NAME` | Model to use | `vllm/qwen3-30b-instruct-fp8` |
| `GIT_USERNAME` | Git username | From `.env` |
| `GIT_TOKEN` | Git personal access token | From `.env` |
| `LANGFUSE_HOST` | Langfuse endpoint (optional) | Auto-detected |

### config.json

```json
{
  "examples": {
    "openclaw": {
      "doc-writer": {
        "env": {
          "LITELLM_MODEL_NAME": "vllm/qwen3-30b-instruct-fp8",
          "OPENCLAW_GATEWAY_TOKEN": "openclaw-gateway-token"
        }
      }
    }
  }
}
```

## Open WebUI Integration

### 1. Install Pipe Function

1. Open Open WebUI in your browser
2. Navigate to **Admin Panel** → **Functions**
3. Click **+ Add Function**
4. Copy the contents of `openwebui_pipe_function.py`
5. Paste into the function editor
6. Click **Save**

### 2. Configure Pipe Function

In the function settings (Valves):

| Setting | Value |
|---|---|
| `AGENT_ENDPOINT` | `http://doc-writer.openclaw:8080/message` |
| `AGENT_AUTH_TOKEN` | Leave empty (or set if using auth) |
| `REQUEST_TIMEOUT` | `300` (5 minutes) |

### 3. Use the Agent

1. Start a new chat in Open WebUI
2. Select **OpenClaw - Document Writer** from the model dropdown
3. Send a message like:

```
Write a comprehensive README for https://github.com/myorg/myproject

Include:
- Project overview
- Installation instructions
- Usage examples
- API documentation
- Contributing guidelines
```

The agent will:
1. Clone the repository
2. Analyze the code structure
3. Generate documentation
4. Commit and push changes
5. Stream the response back to you

## Example Tasks

### Generate README

```
Write a README for https://github.com/user/repo

Include:
- Project description
- Installation steps
- Quick start guide
- Configuration options
```

### Update API Documentation

```
Update the API documentation in https://github.com/user/api-server

Focus on:
- REST endpoints
- Request/response formats
- Authentication
- Error codes
```

### Create Changelog

```
Generate a CHANGELOG.md for https://github.com/user/project

Based on recent commits, create entries for:
- New features
- Bug fixes
- Breaking changes
```

### Write Contributing Guide

```
Create a CONTRIBUTING.md for https://github.com/user/opensource-project

Include:
- Code of conduct
- Development setup
- Pull request process
- Coding standards
```

## KEDA Scale-to-Zero

The Document Writer Agent uses KEDA to scale to zero when idle, minimizing costs:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: doc-writer-scaler
spec:
  scaleTargetRef:
    name: doc-writer
  minReplicaCount: 0
  maxReplicaCount: 10
```

- **Idle**: Scales to 0 replicas after 5 minutes of inactivity
- **Active**: Scales up when tasks are submitted
- **Cost**: $0 when idle, ~$0.02-0.05 per task execution

## Git Workflow

The agent follows this Git workflow:

1. **Clone**: `git clone https://${GIT_USERNAME}:${GIT_TOKEN}@github.com/user/repo`
2. **Analyze**: Read code files, understand structure
3. **Generate**: Use LLM to create documentation
4. **Commit**: `git add . && git commit -m "docs: Update documentation"`
5. **Push**: `git push origin main`

### Git Configuration

The agent is pre-configured with:

```bash
git config --system user.name "OpenClaw Doc Writer"
git config --system user.email "openclaw-doc-writer@noreply"
```

## Troubleshooting

### Agent Not Responding

```bash
# Check pod status
kubectl get pods -n openclaw -l app=doc-writer

# Check logs
kubectl logs -n openclaw -l app=doc-writer

# Restart pod
kubectl delete pod -n openclaw -l app=doc-writer
```

### Git Authentication Failed

```bash
# Verify Git credentials in config
kubectl get deployment -n openclaw doc-writer -o yaml | grep GIT

# Test Git access manually
kubectl exec -it -n openclaw deployment/doc-writer -- \
  git ls-remote https://${GIT_USERNAME}:${GIT_TOKEN}@github.com/user/repo
```

### LLM API Errors

```bash
# Check LiteLLM is running
kubectl get pods -n litellm

# Test LiteLLM API
kubectl port-forward -n litellm svc/litellm 4000:4000
curl http://localhost:4000/health
```

### Slow Response Times

- **Model selection**: Try a faster model (e.g., `vllm/qwen3-8b` instead of `qwen3-30b`)
- **Repository size**: Large repos take longer to analyze
- **Network latency**: Check Git clone speed

### KEDA Not Scaling

```bash
# Check KEDA is installed
kubectl get pods -n keda

# Check ScaledObject
kubectl get scaledobject -n openclaw

# Check HPA
kubectl get hpa -n openclaw
```

## Langfuse Observability

If Langfuse is installed, view agent traces:

1. Open Langfuse UI
2. Navigate to **Traces**
3. Filter by `doc-writer` tag
4. View:
   - Task submission time
   - LLM API calls
   - Token usage
   - Response latency
   - Error events

## Security Considerations

- **Git credentials**: Stored as environment variables (consider using Kubernetes Secrets)
- **Repository access**: Agent has write access to repos (use fine-grained tokens)
- **Code execution**: Agent does not execute code, only reads and writes files
- **Network**: Agent can access external Git repositories

## Cost Optimization

- **KEDA scale-to-zero**: $0 when idle
- **Spot instances**: Karpenter provisions Spot ARM64 nodes (up to 90% savings)
- **Job-based execution**: Consider using Jobs instead of Deployment for one-off tasks
- **Model selection**: Smaller models reduce LLM API costs

## Uninstallation

```bash
./cli examples openclaw doc-writer uninstall
```

This will:
1. Delete Kubernetes resources (Deployment, Service, ServiceAccount, KEDA ScaledObject)
2. Destroy ECR repository via Terraform

## References

- [OpenClaw Repository](https://github.com/openclaw/openclaw)
- [Open WebUI Pipe Functions](https://docs.openwebui.com/features/pipe-functions)
- [KEDA Documentation](https://keda.sh/docs/)
- [GitHub Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
