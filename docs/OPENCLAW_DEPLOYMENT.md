# OpenClaw Deployment Guide

This guide provides step-by-step instructions for deploying the OpenClaw AI Agent Orchestrator component and examples on Amazon EKS.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Deployment Steps](#deployment-steps)
4. [Verification](#verification)
5. [Open WebUI Integration](#open-webui-integration)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Components

Before deploying OpenClaw, ensure the following components are installed:

1. **EKS Cluster**: Running cluster with at least 3 nodes
2. **LiteLLM**: AI Gateway for model routing
3. **Open WebUI**: GUI for interacting with agents
4. **Langfuse** (Optional): Observability and tracing

### Required Tools

- AWS CLI configured with appropriate credentials
- kubectl configured to access your EKS cluster
- Docker with Buildx support
- Node.js 18+ and npm

### Environment Variables

Ensure the following variables are set in `.env`:

```bash
# Required
REGION=ap-northeast-2
EKS_CLUSTER_NAME=your-cluster-name
LITELLM_API_KEY=sk-1234567890abcdef

# Optional (for observability)
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx

# Git credentials for doc-writer
OPENCLAW_DOC_WRITER_GIT_USERNAME=your-github-username
OPENCLAW_DOC_WRITER_GIT_TOKEN=ghp_your_github_token

# Git credentials for devops-agent
OPENCLAW_DEVOPS_AGENT_GIT_USERNAME=your-github-username
OPENCLAW_DEVOPS_AGENT_GIT_TOKEN=ghp_your_github_token
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User / Developer                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
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
│  (K8s Deployment)    │                  │   (K8s Deployment)   │
│  Port: 8080          │                  │   Port: 8080         │
└──────────┬───────────┘                  └──────────┬───────────┘
           │                                          │
           └───────────────────┬───────────────────────┘
                               ▼
                     ┌──────────────────────┐
                     │   LiteLLM Gateway    │
                     │   Port: 4000         │
                     └──────────┬───────────┘
                                │
                                ▼
                     ┌──────────────────────┐
                     │  vLLM / SGLang / etc │
                     └──────────────────────┘
```

## Deployment Steps

### Step 1: Install Prerequisites

#### 1.1 Install LiteLLM

```bash
./cli ai-gateway litellm install
```

Wait for LiteLLM to be ready:

```bash
kubectl wait --for=condition=ready pod -l app=litellm -n litellm --timeout=300s
```

#### 1.2 Install Open WebUI

```bash
./cli gui-app openwebui install
```

Wait for Open WebUI to be ready:

```bash
kubectl wait --for=condition=ready pod -l app=open-webui -n open-webui --timeout=300s
```

#### 1.3 Install Langfuse (Optional)

```bash
./cli o11y langfuse install
```

Wait for Langfuse to be ready:

```bash
kubectl wait --for=condition=ready pod -l app=web -n langfuse --timeout=300s
```

### Step 2: Install OpenClaw Component

Install the OpenClaw bridge server:

```bash
./cli ai-agent openclaw install
```

This will:
1. Create ECR repository
2. Build and push Docker image
3. Deploy bridge server to `openclaw` namespace
4. Create Kubernetes Service

Expected output:
```
Applying Terraform configuration...
Building OpenClaw bridge server Docker image...
Applying Kubernetes manifests...
OpenClaw component installed successfully!
Bridge server will be available at: http://openclaw.openclaw:8080
```

### Step 3: Verify OpenClaw Component

```bash
# Check namespace
kubectl get namespace openclaw

# Check pods
kubectl get pods -n openclaw

# Expected output:
# NAME                        READY   STATUS    RESTARTS   AGE
# openclaw-xxxxxxxxxx-xxxxx   1/1     Running   0          2m

# Check service
kubectl get svc -n openclaw

# Expected output:
# NAME       TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
# openclaw   ClusterIP   10.100.x.x      <none>        8080/TCP   2m

# Check logs
kubectl logs -n openclaw -l app=openclaw --tail=50

# Expected output should include:
# Waiting for OpenClaw Gateway to be ready...
# OpenClaw Gateway connected.
# Bridge server listening on port 8080
```

### Step 4: Install Example Agents

#### 4.1 Install Document Writer Agent

```bash
./cli examples openclaw doc-writer install
```

Verify:
```bash
kubectl get pods -n openclaw -l app=doc-writer
kubectl logs -n openclaw -l app=doc-writer --tail=20
```

#### 4.2 Install DevOps Agent

```bash
./cli examples openclaw devops-agent install
```

Verify:
```bash
kubectl get pods -n openclaw -l app=devops-agent
kubectl logs -n openclaw -l app=devops-agent --tail=20
```

### Step 5: Verify All Components

```bash
# Check all pods in openclaw namespace
kubectl get pods -n openclaw

# Expected output:
# NAME                             READY   STATUS    RESTARTS   AGE
# openclaw-xxxxxxxxxx-xxxxx        1/1     Running   0          5m
# doc-writer-xxxxxxxxxx-xxxxx      1/1     Running   0          3m
# devops-agent-xxxxxxxxxx-xxxxx    1/1     Running   0          2m

# Check all services
kubectl get svc -n openclaw

# Expected output:
# NAME           TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
# openclaw       ClusterIP   10.100.x.x      <none>        8080/TCP   5m
# doc-writer     ClusterIP   10.100.x.x      <none>        8080/TCP   3m
# devops-agent   ClusterIP   10.100.x.x      <none>        8080/TCP   2m
```

## Verification

### Test OpenClaw Bridge Server

```bash
# Port-forward to bridge server
kubectl port-forward -n openclaw svc/openclaw 8080:8080 &

# Test health endpoint
curl http://localhost:8080/health

# Expected output:
# {"status":"ok"}

# Test status endpoint
curl http://localhost:8080/status

# Expected output:
# {"status":"running","uptime":300,"lastActivity":"2025-02-14T11:30:00.000Z"}
```

### Test Document Writer Agent

```bash
# Port-forward to doc-writer
kubectl port-forward -n openclaw svc/doc-writer 8081:8080 &

# Test health endpoint
curl http://localhost:8081/health

# Expected output:
# {"status":"ok"}
```

### Test DevOps Agent

```bash
# Port-forward to devops-agent
kubectl port-forward -n openclaw svc/devops-agent 8082:8080 &

# Test health endpoint
curl http://localhost:8082/health

# Expected output:
# {"status":"ok"}
```

## Open WebUI Integration

### Step 1: Access Open WebUI

Get the Open WebUI URL:

```bash
kubectl get ingress -n open-webui
# Or use port-forward:
kubectl port-forward -n open-webui svc/open-webui 3000:80
```

Open browser: `http://localhost:3000`

### Step 2: Install Pipe Functions

#### For Document Writer Agent

1. Navigate to **Admin Panel** → **Functions**
2. Click **+ Add Function**
3. Copy contents from `examples/openclaw/doc-writer/openwebui_pipe_function.py`
4. Paste into editor
5. Click **Save**

Configure Valves:
- `AGENT_ENDPOINT`: `http://doc-writer.openclaw:8080/message`
- `AGENT_AUTH_TOKEN`: (leave empty)
- `REQUEST_TIMEOUT`: `300`

#### For DevOps Agent

1. Navigate to **Admin Panel** → **Functions**
2. Click **+ Add Function**
3. Copy contents from `examples/openclaw/devops-agent/openwebui_pipe_function.py`
4. Paste into editor
5. Click **Save**

Configure Valves:
- `AGENT_ENDPOINT`: `http://devops-agent.openclaw:8080/message`
- `AGENT_AUTH_TOKEN`: (leave empty)
- `REQUEST_TIMEOUT`: `300`

## Testing

### Test Document Writer Agent

1. Start new chat in Open WebUI
2. Select **OpenClaw - Document Writer** from model dropdown
3. Send message:

```
Write a README for https://github.com/myorg/myproject

Include:
- Project overview
- Installation instructions
- Usage examples
```

Expected behavior:
- Agent clones repository
- Analyzes code structure
- Generates documentation
- Commits and pushes changes
- Streams response back

### Test DevOps Agent

1. Start new chat in Open WebUI
2. Select **OpenClaw - DevOps Agent** from model dropdown
3. Send message:

```
List all pods in the default namespace and their status
```

Expected behavior:
- Agent runs `kubectl get pods -n default`
- Analyzes output
- Provides formatted response with recommendations

### Test with Langfuse Observability

If Langfuse is installed:

1. Open Langfuse UI
2. Navigate to **Traces**
3. Filter by `openclaw`, `doc-writer`, or `devops-agent`
4. View execution traces:
   - Task submission time
   - LLM API calls
   - Token usage
   - Response latency

## Troubleshooting

### Bridge Server Not Starting

```bash
# Check pod status
kubectl describe pod -n openclaw -l app=openclaw

# Check logs
kubectl logs -n openclaw -l app=openclaw --tail=100

# Common issues:
# 1. LiteLLM not available
kubectl get pods -n litellm

# 2. Invalid API key
kubectl get deployment -n openclaw openclaw -o yaml | grep LITELLM_API_KEY
```

### Agent Not Responding

```bash
# Check pod status
kubectl get pods -n openclaw

# Check logs
kubectl logs -n openclaw -l app=doc-writer --tail=100
kubectl logs -n openclaw -l app=devops-agent --tail=100

# Restart pods
kubectl delete pod -n openclaw -l app=doc-writer
kubectl delete pod -n openclaw -l app=devops-agent
```

### Image Pull Errors

```bash
# Check ECR repositories
aws ecr describe-repositories --region ap-northeast-2 | grep openclaw

# Re-authenticate Docker
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-northeast-2.amazonaws.com

# Rebuild and push images
./cli ai-agent openclaw uninstall
./cli ai-agent openclaw install
```

### Git Authentication Failed (Doc Writer)

```bash
# Verify Git credentials
kubectl get deployment -n openclaw doc-writer -o yaml | grep GIT

# Test Git access
kubectl exec -it -n openclaw deployment/doc-writer -- \
  git ls-remote https://${GIT_USERNAME}:${GIT_TOKEN}@github.com/user/repo
```

### RBAC Permission Denied (DevOps Agent)

```bash
# Verify ClusterRole
kubectl get clusterrole devops-agent-reader

# Verify ClusterRoleBinding
kubectl get clusterrolebinding devops-agent-reader-binding

# Test permissions
kubectl auth can-i get pods --as=system:serviceaccount:openclaw:devops-agent
```

### LiteLLM Connection Failed

```bash
# Check LiteLLM is running
kubectl get pods -n litellm

# Test LiteLLM API
kubectl port-forward -n litellm svc/litellm 4000:4000
curl http://localhost:4000/health

# Check network connectivity
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://litellm.litellm:4000/health
```

## Cleanup

### Uninstall Examples

```bash
./cli examples openclaw doc-writer uninstall
./cli examples openclaw devops-agent uninstall
```

### Uninstall Component

```bash
./cli ai-agent openclaw uninstall
```

### Verify Cleanup

```bash
# Check namespace
kubectl get namespace openclaw

# Check ECR repositories
aws ecr describe-repositories --region ap-northeast-2 | grep openclaw
```

## Next Steps

- Explore additional agent use cases
- Customize agent prompts and behaviors
- Integrate with CI/CD pipelines
- Set up monitoring and alerting
- Configure KEDA for scale-to-zero
- Implement production-grade authentication

## References

- [OpenClaw Component README](../components/ai-agent/openclaw/README.md)
- [Document Writer Agent README](../examples/openclaw/doc-writer/README.md)
- [DevOps Agent README](../examples/openclaw/devops-agent/README.md)
- [OpenClaw Repository](https://github.com/openclaw/openclaw)
- [LiteLLM Documentation](https://docs.litellm.ai/)
- [Open WebUI Documentation](https://docs.openwebui.com/)
