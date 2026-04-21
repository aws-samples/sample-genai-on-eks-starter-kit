# Guardrails AI

Input/output validation framework for LLMs. Detects and filters PII, toxic content, and other policy violations in real-time, integrating with LiteLLM as a guardrail middleware.

| | |
|---|---|
| **Category** | guardrail |
| **Official Docs** | [Guardrails AI Documentation](https://www.guardrailsai.com/docs) |
| **CLI Install** | `./cli guardrail guardrails-ai install` |
| **CLI Uninstall** | `./cli guardrail guardrails-ai uninstall` |
| **Namespace** | `guardrails-ai` |

## Overview

Guardrails AI provides a validation layer for LLM inputs and outputs:
- **PII Detection**: Detect and mask emails, phone numbers, IP addresses, SSNs
- **Content Validation**: Check outputs against custom validation rules
- **LiteLLM Integration**: Acts as middleware in the LLM request pipeline
- **Guard Hub**: Access community-maintained validators
- **Streaming Support**: Validate streaming LLM responses in real-time

## Installation

### Prerequisites

- `GUARDRAILS_AI_API_KEY` environment variable set in `.env`

```bash
./cli guardrail guardrails-ai install
```

The installer:
1. Uses a pre-built public ECR image
2. Renders the deployment template with configuration
3. Deploys the Guardrails AI server to the cluster

## Verification

```bash
# Check pods
kubectl get pods -n guardrails-ai

# Check service
kubectl get svc -n guardrails-ai

# Port-forward for testing
kubectl port-forward svc/guardrails-ai 8000:8000 -n guardrails-ai --address 0.0.0.0 &

# Test PII detection
curl -X POST 'http://localhost:8000/guards/detect-pii/validate' \
  -H 'Content-Type: application/json' \
  -d '{
    "llmOutput": "My email address is john.doe@example.com, my IP address is 192.168.1.1, and my phone number is 123-456-7890"
  }'
```

## Configuration

### Environment Variables

Configure in `.env`:

```bash
# Required
GUARDRAILS_AI_API_KEY=your-guardrails-api-key
```

### Enabling in LiteLLM

Enable Guardrails AI as a middleware in `config.json`:

```json
{
  "litellm": {
    "enableGuardrailsAI": true
  }
}
```

Then reinstall LiteLLM:

```bash
./cli ai-gateway litellm uninstall
./cli ai-gateway litellm install
```

LiteLLM will route requests through Guardrails AI for content validation before sending to the LLM.

## Testing

### Via Open WebUI

Send messages containing PII to test detection:

```
Validate this email address - genai-on-eks@example.com
Validate this IP address - 50.0.10.1
Validate this phone number - 829-456-7890
```

### Via curl

```bash
curl -X POST 'http://localhost:8000/guards/detect-pii/validate' \
  -H 'Content-Type: application/json' \
  -d '{
    "llmOutput": "My email address is john.doe@example.com, my IP address and 192.168.1.1, and my phone number is 123-456-7890"
  }'
```

## Troubleshooting

### Pod not starting

```bash
# Check pod events
kubectl describe pod -n guardrails-ai -l app=guardrails-ai

# Check logs
kubectl logs -n guardrails-ai -l app=guardrails-ai

# Verify API key
kubectl get secret -n guardrails-ai -o yaml
```

### Guardrails not triggering in LiteLLM

```bash
# Verify enableGuardrailsAI is true in config
cat config.json | grep enableGuardrailsAI

# Check LiteLLM logs for guardrail integration
kubectl logs -n litellm -l app=litellm | grep guardrail
```

## Learn More

- [Guardrails AI Documentation](https://www.guardrailsai.com/docs)
- [Guardrails Hub](https://hub.guardrailsai.com)
- [PII Detection Guard](https://github.com/guardrails-ai/detect_pii)
- [Guardrails Lite Server](https://github.com/guardrails-ai/guardrails-lite-server)
