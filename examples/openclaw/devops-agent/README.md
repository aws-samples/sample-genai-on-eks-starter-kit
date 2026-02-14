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
- Docker with Buildx support
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
./cli examples openclaw devops-agent install
```

This will:
1. Create ECR repository for the agent image
2. Build multi-arch Docker image with kubectl, helm, AWS CLI
3. Push image to ECR
4. Deploy agent as Kubernetes Deployment
5. Create ServiceAccount with read-only ClusterRole
6. Create Service at `http://devops-agent.openclaw:8080`

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
| `LITELLM_MODEL_NAME` | Model to use | `vllm/qwen3-30b-instruct-fp8` |
| `LANGFUSE_HOST` | Langfuse endpoint (optional) | Auto-detected |

### config.json

```json
{
  "examples": {
    "openclaw": {
      "devops-agent": {
        "env": {
          "LITELLM_MODEL_NAME": "vllm/qwen3-30b-instruct-fp8",
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
|---|---|---|
| `AGENT_ENDPOINT` | `http://devops-agent.openclaw:8080/message` |
| `AGENT_AUTH_TOKEN` | Leave empty (or set if using auth) |
| `REQUEST_TIMEOUT` | `300` (5 minutes) |

### 3. Use the Agent

1. Start a new chat in Open WebUI
2. Select **OpenClaw - DevOps Agent** from the model dropdown
3. Ask questions about your cluster

## Example Queries

### Cluster Health Check

```
Check the overall health of my Kubernetes cluster.

Include:
- Node status
- Pod failures
- Resource usage
- Recent events
```

### Pod Troubleshooting

```
Why is the pod "my-app-xyz" in default namespace failing?

Analyze:
- Pod status and events
- Container logs
- Resource limits
- Image pull status
```

### Resource Inspection

```
List all deployments in the production namespace and their replica counts.
```

```
Show me all services of type LoadBalancer across all namespaces.
```

```
What pods are consuming the most CPU in the kube-system namespace?
```

### Helm Release Management

```
List all Helm releases in the cluster and their status.
```

```
Show me the values used for the "litellm" Helm release in the litellm namespace.
```

### AWS Resource Queries

```
List all EKS clusters in us-west-2 region.
```

```
Show me the security groups attached to my EKS cluster.
```

```
What is the current status of my RDS instances?
```

### Log Analysis

```
Analyze the logs from the "api-server" deployment in the default namespace for errors.
```

```
Show me the last 100 lines of logs from all pods with label app=frontend.
```

### Configuration Recommendations

```
Review the resource requests and limits for the "web-app" deployment.
Suggest optimizations based on actual usage.
```

```
Analyze the ingress configuration for "my-service" and recommend improvements.
```

## Available Tools

The DevOps Agent has access to:

### kubectl

```bash
# Examples the agent can run
kubectl get pods --all-namespaces
kubectl describe deployment my-app
kubectl logs -f deployment/my-app
kubectl get events --sort-by='.lastTimestamp'
kubectl top nodes
kubectl top pods
```

### helm

```bash
# Examples the agent can run
helm list --all-namespaces
helm status my-release -n my-namespace
helm get values my-release -n my-namespace
helm history my-release -n my-namespace
```

### AWS CLI

```bash
# Examples the agent can run
aws eks list-clusters --region us-west-2
aws ec2 describe-security-groups
aws rds describe-db-instances
aws s3 ls
aws iam list-roles
```

## Troubleshooting

### Agent Not Responding

```bash
# Check pod status
kubectl get pods -n openclaw -l app=devops-agent

# Check logs
kubectl logs -n openclaw -l app=devops-agent

# Restart pod
kubectl delete pod -n openclaw -l app=devops-agent
```

### RBAC Permission Denied

```bash
# Verify ClusterRole exists
kubectl get clusterrole devops-agent-reader

# Verify ClusterRoleBinding
kubectl get clusterrolebinding devops-agent-reader-binding

# Check ServiceAccount
kubectl get sa -n openclaw devops-agent

# Test permissions
kubectl auth can-i get pods --as=system:serviceaccount:openclaw:devops-agent
```

### kubectl Commands Failing

```bash
# Verify kubectl is installed
kubectl exec -it -n openclaw deployment/devops-agent -- kubectl version --client

# Test kubectl access
kubectl exec -it -n openclaw deployment/devops-agent -- kubectl get pods -n default
```

### AWS CLI Not Working

```bash
# Verify AWS CLI is installed
kubectl exec -it -n openclaw deployment/devops-agent -- aws --version

# Check AWS credentials (if using IRSA)
kubectl exec -it -n openclaw deployment/devops-agent -- aws sts get-caller-identity
```

### LLM API Errors

```bash
# Check LiteLLM is running
kubectl get pods -n litellm

# Test LiteLLM API
kubectl port-forward -n litellm svc/litellm 4000:4000
curl http://localhost:4000/health
```

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

- **Read-only access**: Agent cannot modify cluster resources
- **RBAC**: ClusterRole limits permissions to get, list, watch
- **No exec**: Agent cannot execute commands in pods
- **No secrets**: Agent cannot read Kubernetes Secrets
- **Network**: Agent can access Kubernetes API and AWS APIs
- **Audit**: All kubectl commands are logged in Kubernetes audit logs

### Recommended Security Enhancements

For production use, consider:

1. **Namespace-scoped access**: Use Role instead of ClusterRole
2. **Resource filtering**: Limit access to specific resource types
3. **Audit logging**: Enable Kubernetes audit logging
4. **Network policies**: Restrict agent network access
5. **Pod security**: Use Pod Security Standards

## Cost Optimization

- **Long-lived deployment**: Runs continuously for low-latency responses
- **Resource limits**: Configured with minimal CPU/memory requests
- **Spot instances**: Karpenter provisions Spot ARM64 nodes (up to 90% savings)
- **Model selection**: Use smaller models for faster, cheaper responses

Estimated cost: ~$0.01-0.02 per hour (excluding LLM API costs)

## Uninstallation

```bash
./cli examples openclaw devops-agent uninstall
```

This will:
1. Delete Kubernetes resources (Deployment, Service, ServiceAccount)
2. Delete RBAC resources (ClusterRole, ClusterRoleBinding)
3. Destroy ECR repository via Terraform

## References

- [OpenClaw Repository](https://github.com/openclaw/openclaw)
- [kubectl Documentation](https://kubernetes.io/docs/reference/kubectl/)
- [Helm Documentation](https://helm.sh/docs/)
- [AWS CLI Documentation](https://docs.aws.amazon.com/cli/)
- [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
