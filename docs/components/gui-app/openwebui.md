# Open WebUI

Feature-rich, self-hosted web interface for interacting with LLMs. Provides a ChatGPT-like experience with support for multiple models, RAG, tools, and collaborative features.

| | |
|---|---|
| **Category** | gui-app |
| **Official Docs** | [Open WebUI Documentation](https://docs.openwebui.com) |
| **CLI Install** | `./cli gui-app openwebui install` |
| **CLI Uninstall** | `./cli gui-app openwebui uninstall` |
| **Namespace** | `openwebui` |

## Overview

Open WebUI serves as the primary user interface for the starter kit:
- **Chat Interface**: Conversational UI with streaming, markdown, and code highlighting
- **Multi-Model**: Switch between models via LiteLLM integration
- **RAG**: Built-in document upload and retrieval-augmented generation
- **Tools & Functions**: Extensible pipe functions for custom integrations
- **User Management**: Multi-user support with roles and permissions
- **Conversation History**: Persistent chat history and conversation export
- **Model Presets**: Save and share model configurations

## Installation

### Prerequisites

Configure in `.env`:

```bash
LITELLM_API_KEY=sk-1234567890abcdef
OPENWEBUI_ADMIN_EMAIL=admin@example.com
OPENWEBUI_ADMIN_PASSWORD=your-password
```

### Install

```bash
./cli gui-app openwebui install
```

The installer:
1. Adds the Open WebUI Helm chart repository
2. Renders Helm values with LiteLLM connection and admin credentials
3. Deploys Open WebUI via Helm chart (version 12.8.1)
4. Creates the `openwebui` namespace

## Verification

```bash
# Check pods
kubectl get pods -n openwebui

# Check service
kubectl get svc -n openwebui

# Check ingress
kubectl get ingress -n openwebui

# Port-forward for local access
kubectl port-forward svc/openwebui 3000:8080 -n openwebui --address 0.0.0.0 &

# Access Open WebUI
open http://localhost:3000
```

Log in with `OPENWEBUI_ADMIN_EMAIL` and `OPENWEBUI_ADMIN_PASSWORD`.

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `LITELLM_API_KEY` | LiteLLM API key for model access |
| `OPENWEBUI_ADMIN_EMAIL` | Admin account email |
| `OPENWEBUI_ADMIN_PASSWORD` | Admin account password |
| `DOMAIN` | Domain for ingress (e.g., `openwebui.example.com`) |

### LiteLLM Backend

Open WebUI connects to [LiteLLM](../ai-gateway/litellm.md) as its backend:

```bash
OPENAI_API_BASE_URL=http://litellm.litellm:4000/v1
OPENAI_API_KEY=sk-1234
```

All models configured in LiteLLM (vLLM, SGLang, TGI, Ollama, Bedrock) appear in the Open WebUI model selector.

### OpenClaw Integration

Open WebUI integrates with [OpenClaw](../ai-agent/openclaw.md) via pipe functions to enable AI agent capabilities directly from the chat interface.

## Features

### Document Upload (RAG)

1. Click the attachment icon in the chat input
2. Upload a document (PDF, TXT, DOCX, etc.)
3. Ask questions about the uploaded document
4. Open WebUI uses embedded models to retrieve relevant content

### Custom Pipe Functions

Extend Open WebUI with custom Python functions:

```python
# Example: OpenClaw integration pipe
class Pipe:
    def __init__(self):
        self.valves = Valves(
            OPENCLAW_URL="http://openclaw.openclaw:8080",
            OPENCLAW_TOKEN="openclaw-gateway-token"
        )

    def pipe(self, body):
        # Route request to OpenClaw agent
        pass
```

## Troubleshooting

### Cannot connect to models

```bash
# Check LiteLLM is running
kubectl get pods -n litellm

# Check Open WebUI environment
kubectl exec -it -n openwebui <openwebui-pod> -- env | grep OPENAI

# Check LiteLLM connectivity from Open WebUI
kubectl exec -it -n openwebui <openwebui-pod> -- \
  curl http://litellm.litellm:4000/v1/models
```

### Login fails

```bash
# Check admin credentials in values
kubectl get secret -n openwebui -o yaml

# Check Open WebUI logs
kubectl logs -n openwebui -l app=openwebui
```

### Slow responses

```bash
# Check LLM backend health
kubectl get pods -n vllm
kubectl get pods -n sglang

# Check Open WebUI pod resources
kubectl top pod -n openwebui
```

## Learn More

- [Open WebUI Documentation](https://docs.openwebui.com)
- [Open WebUI GitHub](https://github.com/open-webui/open-webui)
- [Open WebUI Helm Charts](https://github.com/open-webui/helm-charts)
- [Pipe Functions Guide](https://docs.openwebui.com/tutorials/plugin/functions)
