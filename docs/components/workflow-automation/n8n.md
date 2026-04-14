# n8n

Open-source workflow automation platform with a visual editor. Build complex AI-powered workflows by connecting LLMs, APIs, databases, and services with a no-code/low-code interface.

| | |
|---|---|
| **Category** | workflow-automation |
| **Official Docs** | [n8n Documentation](https://docs.n8n.io) |
| **CLI Install** | `./cli workflow-automation n8n install` |
| **CLI Uninstall** | `./cli workflow-automation n8n uninstall` |
| **Namespace** | `n8n` |

## Overview

n8n enables visual workflow automation:
- **Visual Editor**: Drag-and-drop workflow builder
- **400+ Integrations**: Connect to databases, APIs, SaaS tools
- **AI Nodes**: Built-in LLM, chat, and AI agent nodes
- **Code Nodes**: Write custom JavaScript/Python when needed
- **Webhooks**: Trigger workflows from HTTP requests
- **Scheduling**: Cron-based workflow execution
- **Self-Hosted**: Full control over data and execution

## Installation

```bash
./cli workflow-automation n8n install
```

The installer:
1. Renders Helm values with domain configuration
2. Deploys n8n via OCI Helm chart
3. Creates the `n8n` namespace

No additional environment variables are required (beyond optional `DOMAIN`).

## Verification

```bash
# Check pods
kubectl get pods -n n8n

# Check service
kubectl get svc -n n8n

# Port-forward for local access
kubectl port-forward svc/n8n 5678:5678 -n n8n --address 0.0.0.0 &

# Access n8n UI
open http://localhost:5678
```

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `DOMAIN` | Domain for ingress (optional) |

## Usage

### AI Workflows with LiteLLM

Create AI-powered workflows by connecting n8n to [LiteLLM](../ai-gateway/litellm.md):

1. Add an **HTTP Request** node or **OpenAI** node
2. Set the base URL to `http://litellm.litellm:4000/v1`
3. Configure the API key (LiteLLM master key)
4. Select the model and configure parameters

### Example: Chat Workflow

1. **Webhook Trigger**: Receive incoming messages
2. **OpenAI Chat**: Send to LLM via LiteLLM
3. **HTTP Response**: Return the generated response

### Example: RAG Workflow

1. **Webhook Trigger**: Receive a question
2. **Qdrant Search**: Find relevant documents
3. **OpenAI Chat**: Generate answer with context
4. **HTTP Response**: Return the answer

## Troubleshooting

### UI not loading

```bash
# Check pod status
kubectl get pods -n n8n

# Check logs
kubectl logs -n n8n -l app=n8n
```

### Cannot connect to cluster services

```bash
# n8n runs inside the cluster, use internal DNS
# LiteLLM: http://litellm.litellm:4000
# Qdrant: http://qdrant.qdrant:6333
# TEI: http://tei.tei:8080

# Test from n8n pod
kubectl exec -it -n n8n <n8n-pod> -- curl http://litellm.litellm:4000/health
```

## Learn More

- [n8n Documentation](https://docs.n8n.io)
- [n8n GitHub](https://github.com/n8n-io/n8n)
- [n8n AI Nodes](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.lmchatopenai/)
- [n8n Workflow Templates](https://n8n.io/workflows/)
