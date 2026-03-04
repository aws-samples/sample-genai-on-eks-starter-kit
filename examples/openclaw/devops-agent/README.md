# OpenClaw DevOps Agent

An interactive AI assistant for Kubernetes cluster management and troubleshooting. The agent has kubectl, helm, and AWS CLI access with read-only RBAC permissions, making it a safe and powerful tool for cluster inspection and recommendations.

## Use Case

The DevOps Agent is designed for:
- Cluster health checks and diagnostics
- Resource inspection (pods, services, deployments)
- Helm release management queries
- AWS resource queries
- Log analysis and troubleshooting
- Configuration recommendations
- Best practices guidance

## Architecture

```
User (Open WebUI)
  │
  ├─> "List all pods in default namespace"
  │
  ▼
DevOps Agent (K8s Deployment)
  │
  ├─> kubectl get pods -n default
  ├─> Call LiteLLM API for analysis
  ├─> Generate recommendations
  └─> Stream response back to user
```

## Prerequisites

- OpenClaw bridge server installed (`./cli ai-agent openclaw install`)
- LiteLLM component installed (`./cli ai-gateway litellm install`)
- Open WebUI component installed (`./cli gui-app openwebui install`)
- Kubernetes cluster with RBAC enabled

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

### 2. Install DevOps Agent

```bash
./cli openclaw devops-agent install
```

This will:
1. Deploy agent as Kubernetes Deployment using a pre-built image
2. Create ServiceAccount with read-only ClusterRole
3. Create Service at `http://devops-agent.openclaw:8080`

### 3. Verify Installation

```bash
# Check pods
kubectl get pods -n openclaw -l app=devops-agent

# Check service
kubectl get svc -n openclaw devops-agent

# Check RBAC
kubectl get clusterrole devops-agent-reader
kubectl get clusterrolebinding devops-agent-reader-binding

# Check logs
kubectl logs -n openclaw -l app=devops-agent

# Test health endpoint
kubectl port-forward -n openclaw svc/devops-agent 8080:8080
curl http://localhost:8080/health
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Authentication token | `openclaw-gateway-token` |
| `LITELLM_BASE_URL` | LiteLLM API endpoint | `http://litellm.litellm:4000` |
| `LITELLM_API_KEY` | LiteLLM API key | From `.env` |
| `LITELLM_MODEL_NAME` | Model to use | `bedrock/claude-4.5-sonnet` |
| `LANGFUSE_HOST` | Langfuse endpoint (optional) | Auto-detected |

### config.json

```json
{
  "examples": {
    "openclaw": {
      "devops-agent": {
        "env": {
          "LITELLM_MODEL_NAME": "bedrock/claude-4.5-sonnet",
          "OPENCLAW_GATEWAY_TOKEN": "openclaw-gateway-token"
        }
      }
    }
  }
}
```

## RBAC Permissions

The DevOps Agent has read-only access to cluster resources:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: devops-agent-reader
rules:
- apiGroups: ["*"]
  resources: ["*"]
  verbs: ["get", "list", "watch"]
```

This allows the agent to:
- ✅ List and describe resources
- ✅ View logs
- ✅ Check resource status
- ❌ Create, update, or delete resources
- ❌ Execute commands in pods
- ❌ Modify configurations

## Open WebUI Integration

The pipe function is **automatically registered** in Open WebUI when the agent is installed via `./cli openclaw devops-agent install`. No manual setup is needed.

> **Note:** If Open WebUI was not running during install, re-run `./cli openclaw devops-agent install` to register the function.

### Use the Agent

1. Start a new chat in Open WebUI
2. Select **OpenClaw - DevOps Agent** from the model dropdown
3. Ask questions about your cluster

## Example Queries

| Category | Example Prompt |
|----------|---------------|
| Cluster Health | Check the overall health of my cluster — node status, pod failures, resource usage, recent events |
| Pod Troubleshooting | Why is pod "my-app-xyz" in default namespace failing? Analyze status, events, logs, resource limits |
| Resource Inspection | List all deployments in the production namespace and their replica counts |
| Resource Inspection | Show all services of type LoadBalancer across all namespaces |
| Resource Inspection | What pods are consuming the most CPU in kube-system? |
| Helm Releases | List all Helm releases in the cluster and their status |
| Helm Releases | Show the values used for the "litellm" Helm release in the litellm namespace |
| AWS Resources | List all EKS clusters in us-west-2 region |
| AWS Resources | Show security groups attached to my EKS cluster |
| Log Analysis | Analyze logs from "api-server" deployment in default namespace for errors |
| Log Analysis | Show last 100 lines of logs from all pods with label app=frontend |
| Recommendations | Review resource requests/limits for "web-app" deployment and suggest optimizations |
| Recommendations | Analyze ingress configuration for "my-service" and recommend improvements |

## Available Tools

| Tool | Example Commands |
|------|-----------------|
| **kubectl** | `get pods --all-namespaces`, `describe deployment my-app`, `logs -f deployment/my-app`, `get events --sort-by='.lastTimestamp'`, `top nodes`, `top pods` |
| **helm** | `list --all-namespaces`, `status my-release -n my-namespace`, `get values my-release -n my-namespace`, `history my-release -n my-namespace` |
| **AWS CLI** | `eks list-clusters --region us-west-2`, `ec2 describe-security-groups`, `rds describe-db-instances`, `s3 ls`, `iam list-roles` |

## Langfuse Observability

If Langfuse is installed, view agent traces:

1. Open Langfuse UI
2. Navigate to **Traces**
3. Filter by `devops-agent` tag
4. View:
   - Query submission time
   - kubectl/helm/aws commands executed
   - LLM API calls
   - Token usage
   - Response latency

## Security Considerations

> ⚠️ **Security Warning: Cluster-Wide Read Access**
>
> The DevOps Agent uses a **ClusterRole** that grants read access (`get`, `list`, `watch`) to pods, deployments, configmaps, nodes, events, and logs **across all namespaces**. Combined with `automountServiceAccountToken: true`, an LLM-driven agent with this level of access poses security risks:
>
> - **Prompt injection**: A malicious prompt could instruct the agent to read sensitive configmaps, pod specs, or environment variables from any namespace
> - **Data exfiltration**: The agent could be tricked into including sensitive cluster data in its responses
> - **Lateral discovery**: Full cluster visibility reveals infrastructure details that should be compartmentalized
>
> **For production use, replace the ClusterRole/ClusterRoleBinding with namespace-scoped Role/RoleBinding** to limit the blast radius. See "Recommended Security Enhancements" below.

- **Read-only access**: Agent cannot modify cluster resources
- **RBAC**: ClusterRole limits permissions to get, list, watch
- **No exec**: Agent cannot execute commands in pods
- **No secrets**: Agent cannot read Kubernetes Secrets
- **Network**: Agent can access Kubernetes API and AWS APIs
- **Audit**: All kubectl commands are logged in Kubernetes audit logs

### Recommended Security Enhancements

For production use:

1. **Namespace-scoped access** (strongly recommended): Replace `ClusterRole`/`ClusterRoleBinding` with `Role`/`RoleBinding` scoped to specific namespaces the agent needs to inspect
2. **Resource filtering**: Limit access to specific resource types (e.g., remove `configmaps` if not needed)
3. **Audit logging**: Enable Kubernetes audit logging to track all agent API calls
4. **Network policies**: Restrict agent network access to only the Kubernetes API and LiteLLM
5. **Pod security**: Use Pod Security Standards
6. **Review agent output**: Periodically review agent responses for unintended data exposure

## Cost Optimization

- **Long-lived deployment**: Runs continuously for low-latency responses
- **Resource limits**: Configured with minimal CPU/memory requests
- **Spot instances**: Karpenter provisions Spot ARM64 nodes (up to 90% savings)
- **Model selection**: Use smaller models for faster, cheaper responses

Estimated cost: ~$0.01-0.02 per hour (excluding LLM API costs)

## Uninstallation

```bash
./cli openclaw devops-agent uninstall
```

This will delete Kubernetes resources (Deployment, Service, ServiceAccount) and RBAC resources (ClusterRole, ClusterRoleBinding).

## References

- [OpenClaw Repository](https://github.com/openclaw/openclaw)
- [kubectl Documentation](https://kubernetes.io/docs/reference/kubectl/)
- [Helm Documentation](https://helm.sh/docs/)
- [AWS CLI Documentation](https://docs.aws.amazon.com/cli/)
- [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
