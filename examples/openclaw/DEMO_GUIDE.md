# OpenClaw Demo Guide

This guide walks you through deploying and using OpenClaw AI agents with Open WebUI on Amazon EKS.

## Overview

OpenClaw provides AI-powered agents that can interact with your Kubernetes cluster through a conversational interface. This demo includes two example agents:

- **DevOps Agent**: Interactive cluster management and troubleshooting assistant
- **Doc Writer Agent**: Automated documentation generation from Git repositories

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Open WebUI                               │
│                  (Browser-based Chat Interface)                  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP POST /message
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Bridge Server                        │
│                  http://openclaw.openclaw:8080                   │
└─────────┬───────────────────────────────────────────┬───────────┘
          │                                           │
          ▼                                           ▼
┌──────────────────────┐                  ┌──────────────────────┐
│  DevOps Agent        │                  │   Doc Writer Agent   │
│  Port: 8080          │                  │   (KEDA-scaled)      │
└──────────┬───────────┘                  └──────────┬───────────┘
           │                                          │
           └──────────────────┬───────────────────────┘
                              ▼
                    ┌──────────────────────┐
                    │   LiteLLM Gateway    │
                    │   (Model Router)     │
                    └──────────────────────┘
```

## Prerequisites

Before starting, ensure you have:

- EKS cluster deployed (Auto Mode or Standard Mode)
- LiteLLM installed: `./cli ai-gateway litellm install`
- Open WebUI installed: `./cli gui-app openwebui install`
- Langfuse installed (optional, for observability): `./cli observability langfuse install`
- Domain configured in `.env.local` (optional, for HTTPS access via ALB)

**Quick Start**: If you've run `./cli demo-setup`, most components are already installed. You only need to install Open WebUI and OpenClaw separately.

## Step 1: Install OpenClaw Bridge Server

The OpenClaw bridge server orchestrates communication between Open WebUI and agent containers.

```bash
# Install the bridge server
./cli ai-agent openclaw install
```

This will:
1. Create an ECR repository for the bridge server image
2. Build a multi-arch Docker image (amd64, arm64)
3. Push the image to ECR
4. Deploy the bridge server to the `openclaw` namespace
5. Create a Kubernetes Service at `http://openclaw.openclaw:8080`

### Verify Installation

```bash
# Check pod status
kubectl get pods -n openclaw

# Expected output:
# NAME                        READY   STATUS    RESTARTS   AGE
# openclaw-6f6945f985-xxxxx   1/1     Running   0          2m

# Check service
kubectl get svc -n openclaw

# Expected output:
# NAME       TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)    AGE
# openclaw   ClusterIP   172.20.xxx.xxx   <none>        8080/TCP   2m

# Check logs
kubectl logs -n openclaw deployment/openclaw --tail=20
```

You should see logs indicating:
- OpenClaw Gateway is connected
- Bridge server is listening on port 8080
- Agent model is configured (e.g., `anthropic/claude-opus-4-6`)

## Step 2: Install DevOps Agent

The DevOps Agent provides read-only access to your Kubernetes cluster for inspection and troubleshooting.

```bash
# Install the DevOps Agent
./cli examples openclaw devops-agent install
```

This will:
1. Create an ECR repository for the agent image
2. Build a Docker image with kubectl, helm, and AWS CLI
3. Deploy the agent with read-only RBAC permissions
4. Create a Service at `http://devops-agent.openclaw:8080`

### Verify Installation

```bash
# Check pod status
kubectl get pods -n openclaw -l app=devops-agent

# Check RBAC permissions
kubectl get clusterrole devops-agent-reader
kubectl get clusterrolebinding devops-agent-reader-binding

# Test agent health
kubectl port-forward -n openclaw svc/devops-agent 8081:8080 &
curl http://localhost:8081/health
# Expected: {"status":"ok"}
```

## Step 3: Configure Open WebUI

Now we'll add the OpenClaw agents as available models in Open WebUI using Pipe Functions.

### 3.1 Access Open WebUI

Open WebUI is accessible via HTTPS through the Application Load Balancer (ALB):

```bash
# Get the Open WebUI Ingress details
kubectl get ingress -n openwebui

# The URL will be: https://openwebui.<DOMAIN>
# Example: https://openwebui.yjeong.people.aws.dev
```

If you don't have a domain configured, use port-forward for local access:

```bash
# Port-forward to local machine
kubectl port-forward -n openwebui svc/openwebui 8080:80

# Then open in browser: http://localhost:8080
```

On first access, you'll need to create an admin account.

### 3.2 Install DevOps Agent Pipe Function

1. Log in to Open WebUI as an admin user
2. Navigate to **Admin Panel** → **Functions**
3. Click **+ Add Function**
4. Copy the contents of `examples/openclaw/devops-agent/openwebui_pipe_function.py`
5. Paste into the function editor
6. Click **Save**

### 3.3 Configure Function Settings (Valves)

After saving, click on the function to configure its settings:

| Setting | Value | Description |
|---------|-------|-------------|
| `AGENT_ENDPOINT` | `http://devops-agent.openclaw:8080/message` | Agent service endpoint |
| `AGENT_AUTH_TOKEN` | (leave empty) | Optional authentication token |
| `REQUEST_TIMEOUT` | `300` | Timeout in seconds (5 minutes) |

Click **Save** to apply the settings.

### 3.4 Enable the Function

1. Go to **Admin Panel** → **Functions**
2. Find **OpenClaw - DevOps Agent**
3. Toggle the switch to **Enabled**

## Step 4: Use the DevOps Agent

### 4.1 Start a New Chat

1. In Open WebUI, click **+ New Chat**
2. Click the model selector dropdown at the top
3. Select **OpenClaw - DevOps Agent**

### 4.2 Example Queries

Try these example queries to interact with your cluster:

#### Cluster Health Check

```
Check the overall health of my Kubernetes cluster.

Include:
- Node status
- Pod failures across all namespaces
- Resource usage
- Recent events
```

#### Pod Inspection

```
List all pods in the openclaw namespace and show their status
```

#### Resource Analysis

```
Show me all deployments in the litellm namespace with their replica counts and resource requests
```

#### Helm Release Management

```
List all Helm releases in the cluster and their status
```

#### Log Analysis

```
Analyze the logs from the openclaw deployment for any errors or warnings
```

#### AWS Resource Queries

```
List all EKS clusters in the ap-northeast-2 region
```

### 4.3 Understanding Agent Responses

The DevOps Agent will:
1. Execute kubectl/helm/aws commands based on your query
2. Analyze the output using the LLM
3. Provide insights, recommendations, and formatted results
4. Stream responses back in real-time

## Step 5: Install Doc Writer Agent (Optional)

The Doc Writer Agent can clone Git repositories, analyze code, and generate documentation.

```bash
# Install the Doc Writer Agent
./cli examples openclaw doc-writer install
```

Then follow the same process as Step 3 to add the Doc Writer Pipe Function to Open WebUI using `examples/openclaw/doc-writer/openwebui_pipe_function.py`.

## Observability with Langfuse

If you have Langfuse installed, all agent interactions are automatically traced.

### View Agent Traces

1. Access Langfuse UI:
   ```bash
   kubectl get ingress -n langfuse
   ```

2. Navigate to **Traces**

3. Filter by agent name (e.g., `devops-agent`)

4. View detailed traces including:
   - User query
   - Commands executed (kubectl, helm, aws)
   - LLM API calls
   - Token usage
   - Response latency
   - Error events

## Troubleshooting

### Agent Not Responding

```bash
# Check pod status
kubectl get pods -n openclaw

# Check logs
kubectl logs -n openclaw deployment/openclaw
kubectl logs -n openclaw deployment/devops-agent

# Restart pods if needed
kubectl rollout restart deployment/openclaw -n openclaw
kubectl rollout restart deployment/devops-agent -n openclaw
```

### Connection Errors in Open WebUI

If you see "Could not connect to agent endpoint":

1. Verify the agent service exists:
   ```bash
   kubectl get svc -n openclaw devops-agent
   ```

2. Test connectivity from within the cluster:
   ```bash
   kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
     curl http://devops-agent.openclaw:8080/health
   ```

3. Check the endpoint URL in the Pipe Function settings matches the service name

### RBAC Permission Denied

If the agent reports permission errors:

```bash
# Verify ClusterRole exists
kubectl get clusterrole devops-agent-reader

# Verify ClusterRoleBinding
kubectl get clusterrolebinding devops-agent-reader-binding

# Test permissions
kubectl auth can-i get pods --as=system:serviceaccount:openclaw:devops-agent
```

### LLM API Errors

If you see LLM-related errors:

```bash
# Check LiteLLM is running
kubectl get pods -n litellm

# Check LiteLLM logs
kubectl logs -n litellm deployment/litellm

# Verify API key is configured
kubectl get secret -n openclaw openclaw-env -o yaml
```

## Security Considerations

### DevOps Agent Permissions

The DevOps Agent has **read-only** access to cluster resources:

- ✅ Can list and describe resources
- ✅ Can view logs
- ✅ Can check resource status
- ❌ Cannot create, update, or delete resources
- ❌ Cannot execute commands in pods
- ❌ Cannot read Kubernetes Secrets

### Network Security

- All agents run within the cluster (ClusterIP services)
- No external exposure by default
- Communication between components uses internal DNS
- Optional: Add NetworkPolicies to restrict traffic

### Authentication

- Pipe Functions can be configured with Bearer token authentication
- Set `AGENT_AUTH_TOKEN` in both the agent deployment and Pipe Function
- Tokens should be stored as Kubernetes Secrets

## Cost Optimization

OpenClaw follows a cost-first design:

- **Stateless containers**: No persistent storage needed
- **Scale-to-zero**: Doc Writer uses KEDA to scale to 0 when idle
- **Spot instances**: Karpenter provisions Spot ARM64 nodes (up to 90% savings)
- **Efficient models**: Use smaller models for faster, cheaper responses

Estimated cost:
- Bridge server: ~$0.01-0.02 per hour
- DevOps Agent: ~$0.01-0.02 per hour
- Doc Writer: ~$0 at rest, ~$0.02-0.05 per task
- LLM API costs: Variable based on model and usage

## Advanced Configuration

### Using Different LLM Models

Edit `config.json` to change the model:

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

### Adding Custom Agents

Create a new agent by following the pattern in `examples/openclaw/devops-agent/`:

1. Create a Dockerfile with required tools
2. Implement the agent logic
3. Create Kubernetes manifests
4. Create an Open WebUI Pipe Function
5. Register in `cli-menu.json`

## Cleanup

To remove all OpenClaw components:

```bash
# Uninstall agents
./cli examples openclaw devops-agent uninstall
./cli examples openclaw doc-writer uninstall

# Uninstall bridge server
./cli ai-agent openclaw uninstall
```

This will delete all Kubernetes resources and ECR repositories.

## Next Steps

- Explore the [OpenClaw Repository](https://github.com/openclaw/openclaw) for more examples
- Read the [DevOps Agent README](devops-agent/README.md) for detailed usage examples
- Read the [Doc Writer README](doc-writer/README.md) for documentation automation
- Check [Langfuse](https://langfuse.com/docs) for advanced observability features

## Support

For issues or questions:
- Check the troubleshooting section above
- Review logs: `kubectl logs -n openclaw deployment/<agent-name>`
- Open an issue in the repository
- Consult the OpenClaw documentation

