# LiteLLM

Universal LLM gateway that provides a unified OpenAI-compatible API for 100+ LLM providers. Route requests across vLLM, SGLang, TGI, AWS Bedrock, and more with built-in load balancing, rate limiting, and cost tracking.

| | |
|---|---|
| **Category** | ai-gateway |
| **Official Docs** | [LiteLLM Documentation](https://docs.litellm.ai) |
| **CLI Install** | `./cli ai-gateway litellm install` |
| **CLI Uninstall** | `./cli ai-gateway litellm uninstall` |
| **Namespace** | `litellm` |

## Overview

LiteLLM acts as a proxy layer between your applications and LLM providers, offering:
- **Unified API**: Single OpenAI-compatible interface for all providers
- **Model Routing**: Automatic failover and load balancing across models
- **Cost Tracking**: Real-time spend monitoring and budget limits
- **Rate Limiting**: Per-user, per-key, or per-model throttling
- **Guardrails Integration**: Optional Guardrails AI and AWS Bedrock Guardrails
- **Observability**: Langfuse tracing and analytics

## Installation

```bash
./cli ai-gateway litellm install
```

The installer automatically:
1. Detects deployed vLLM, SGLang, TGI models
2. Configures AWS Bedrock models from `config.json`
3. Generates `config.yaml` with model routing
4. Deploys LiteLLM proxy to `litellm` namespace
5. Configures Guardrails AI if enabled
6. Sets up Langfuse integration if installed

## Verification

```bash
# Check LiteLLM pods
kubectl get pods -n litellm

# Check service
kubectl get svc -n litellm

# Port-forward for testing
kubectl port-forward svc/litellm 4000:4000 -n litellm --address 0.0.0.0 &

# List available models
curl http://localhost:4000/v1/models

# Test chat completion
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-1234" \
  -d '{
    "model": "vllm/qwen3-30b-instruct-fp8",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }'
```

## Configuration

### Model Routing

LiteLLM automatically discovers and configures models from:
- **vLLM**: Detects Dynamo vLLM deployments in `dynamo-system` namespace
- **SGLang/TGI/Ollama**: Detects deployments in respective namespaces
- **AWS Bedrock**: Reads from `config.json` → `bedrock.llm.models`

Example generated `config.yaml`:

```yaml
model_list:
  # vLLM models (auto-detected)
  - model_name: qwen3-30b-instruct-fp8
    litellm_params:
      model: openai/qwen3-30b-instruct-fp8
      api_base: http://qwen3-30b-fp8-frontend.dynamo-system:8000/v1

  # AWS Bedrock models (from config.json)
  - model_name: claude-4.5-sonnet
    litellm_params:
      model: bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0
      aws_region_name: us-east-1

  # SGLang models (auto-detected)
  - model_name: qwen3-32b-fp8-sglang
    litellm_params:
      model: openai/qwen3-32b-fp8
      api_base: http://qwen3-32b-fp8.sglang:8000/v1
```

### Guardrails Integration

Enable Guardrails AI in `config.json`:

```json
{
  "litellm": {
    "enableBedrockGuardrail": false,
    "enableGuardrailsAI": true
  }
}
```

Then reinstall:
```bash
./cli ai-gateway litellm uninstall
./cli ai-gateway litellm install
```

LiteLLM will route requests through Guardrails AI for content validation before sending to the LLM.

### Environment Variables

Configure in `.env`:

```bash
# AWS Credentials (for Bedrock)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-1

# LiteLLM Master Key
LITELLM_MASTER_KEY=sk-1234567890abcdef

# Langfuse (optional)
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
```

## Usage

### From Applications

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-1234",  # LiteLLM master key
    base_url="http://litellm.litellm:4000"
)

response = client.chat.completions.create(
    model="vllm/qwen3-30b-instruct-fp8",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### From Open WebUI

Configure Open WebUI to use LiteLLM as the backend:

```bash
# Set in Open WebUI environment
OPENAI_API_BASE_URL=http://litellm.litellm:4000/v1
OPENAI_API_KEY=sk-1234
```

### From curl

```bash
curl http://litellm.litellm:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-1234" \
  -d '{
    "model": "vllm/qwen3-30b-instruct-fp8",
    "messages": [{"role": "user", "content": "Explain quantum computing"}],
    "max_tokens": 200,
    "temperature": 0.7
  }'
```

## Load Balancing

Configure multiple endpoints for the same model to enable load balancing:

```yaml
model_list:
  - model_name: qwen3-30b-fp8
    litellm_params:
      model: openai/qwen3-30b-fp8
      api_base: http://qwen3-replica-1.dynamo-system:8000/v1
  
  - model_name: qwen3-30b-fp8
    litellm_params:
      model: openai/qwen3-30b-fp8
      api_base: http://qwen3-replica-2.dynamo-system:8000/v1
```

LiteLLM will automatically round-robin requests across replicas.

## Rate Limiting

Add to `config.yaml`:

```yaml
litellm_settings:
  max_parallel_requests: 100
  max_requests_per_minute: 1000
  
  # Per-key limits
  api_key_limits:
    sk-user1: 100  # requests per minute
    sk-user2: 500
```

## Cost Tracking

LiteLLM tracks token usage and estimated costs. View in logs:

```bash
kubectl logs -n litellm -l app=litellm | grep "cost"
```

For detailed analytics, enable [Langfuse integration](../observability/langfuse.md).

## Observability

If [Langfuse](../observability/langfuse.md) is installed, LiteLLM automatically sends traces:

```bash
# Check Langfuse integration
kubectl logs -n litellm -l app=litellm | grep langfuse
```

View traces in Langfuse UI:
- Request/response pairs
- Token usage
- Latency breakdown
- Model routing decisions

## Troubleshooting

### Models not appearing

```bash
# Check LiteLLM config
kubectl get cm -n litellm litellm-config -o yaml

# Check logs for discovery errors
kubectl logs -n litellm -l app=litellm | grep ERROR
```

### Connection refused to backend

```bash
# Check backend service exists
kubectl get svc -n dynamo-system | grep frontend
kubectl get svc -n sglang
kubectl get svc -n tgi

# Test connectivity from LiteLLM pod
kubectl exec -it -n litellm <litellm-pod> -- curl http://<backend-svc>.<namespace>:8000/v1/models
```

### AWS Bedrock authentication errors

```bash
# Check AWS credentials
kubectl get secret -n litellm litellm-secrets -o yaml

# Test AWS credentials
kubectl exec -it -n litellm <litellm-pod> -- aws bedrock list-foundation-models --region us-east-1
```

## Learn More

- [LiteLLM Documentation](https://docs.litellm.ai)
- [LiteLLM Proxy Configuration](https://docs.litellm.ai/docs/proxy/configs)
- [Supported LLM Providers](https://docs.litellm.ai/docs/providers)
