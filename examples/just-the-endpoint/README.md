# Just the Endpoint

Deploy a minimal GenAI gateway on EKS: one LiteLLM endpoint that aggregates self-hosted models (Trainium) and Bedrock, with Langfuse for observability. No UI, no agents, no extras.

## What you get

| Component | Purpose | URL |
|-----------|---------|-----|
| LiteLLM | OpenAI-compatible proxy (all models behind one endpoint) | `https://<domain>/litellm` |
| Langfuse | Observability (traces, costs, evals) | `https://<domain>/langfuse` |
| vLLM on Trainium | Self-hosted model (qwen3-8b on inf2.xlarge) | Internal (routed via LiteLLM) |
| Bedrock | 20 managed models (Claude, Nova, Llama, Mistral, etc.) | Via LiteLLM |

## Prerequisites

- AWS account with Bedrock model access enabled in your region
- `inf2.xlarge` quota (2 Neuron cores) — request via Service Quotas if needed
- Domain name (optional — ALB provides a raw URL if no domain configured)
- Node.js 18+, Terraform 1.5+, kubectl, Helm 3

## Deploy

```bash
git clone https://github.com/aws-samples/sample-genai-on-eks-starter-kit.git
cd sample-genai-on-eks-starter-kit

# Use the slim config (deep-merges on top of config.json, arrays are replaced)
cp examples/just-the-endpoint/config.json config.local.json

# Interactive env setup — generates .env.local with your region, keys, etc.
./cli configure

# Deploy EKS cluster + all components
./cli demo-setup
```

Deployment takes ~15-20 minutes (EKS cluster creation + Trainium node scheduling).

**Get your endpoint URLs after deploy:**

```bash
# If you set a DOMAIN in .env.local:
#   LiteLLM:  https://litellm.<your-domain>
#   Langfuse: https://langfuse.<your-domain>

# If DOMAIN is empty (no custom domain), get the raw ALB DNS:
kubectl get ingress -A -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.loadBalancer.ingress[0].hostname}{"\n"}{end}'
```

The ALB hostname is your base URL — LiteLLM serves at the root path on its own ingress.

## Connect your tools

### VS Code (Continue extension)

```json
{
  "models": [{
    "title": "LiteLLM Gateway",
    "provider": "openai",
    "model": "bedrock/claude-4.5-sonnet",
    "apiBase": "https://<your-alb>/litellm",
    "apiKey": "sk-1234"
  }]
}
```

### LM Studio / Any OpenAI-compatible client

```
Base URL: https://<your-alb>/litellm
API Key:  sk-1234  (your LITELLM_API_KEY)
Model:    bedrock/claude-4.5-sonnet
```

### curl

```bash
curl https://<your-alb>/litellm/v1/chat/completions \
  -H "Authorization: Bearer sk-1234" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bedrock/claude-4.5-sonnet",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Available models

All models are accessible via LiteLLM using the prefix shown:

### Bedrock (managed, no infra needed)
| Model | LiteLLM name |
|-------|-------------|
| Claude Opus 4.8 | `bedrock/claude-opus-4.8` |
| Claude Opus 4.7 | `bedrock/claude-opus-4.7` |
| Claude Opus 4.6 | `bedrock/claude-opus-4.6` |
| Claude Sonnet 4.6 | `bedrock/claude-sonnet-4.6` |
| Claude Sonnet 4 | `bedrock/claude-sonnet-4` |
| Claude 4.5 Opus | `bedrock/claude-4.5-opus` |
| Claude 4.5 Sonnet | `bedrock/claude-4.5-sonnet` |
| Claude 4.5 Haiku | `bedrock/claude-4.5-haiku` |
| Claude 4.1 Opus | `bedrock/claude-4.1-opus` |
| Nova Premier | `bedrock/amazon-nova-premier` |
| Nova Pro | `bedrock/amazon-nova-pro` |
| Nova Lite | `bedrock/amazon-nova-lite` |
| Nova Micro | `bedrock/amazon-nova-micro` |
| Nova 2 Lite | `bedrock/amazon-nova-2-lite` |
| Nova 2 Sonic | `bedrock/amazon-nova-2-sonic` |
| DeepSeek R1 | `bedrock/deepseek-r1` |
| DeepSeek V3.2 | `bedrock/deepseek-v3.2` |
| DeepSeek V3.1 | `bedrock/deepseek-v3.1` |
| Llama 4 Maverick | `bedrock/llama4-maverick` |
| Llama 4 Scout | `bedrock/llama4-scout` |
| Llama 3.3 70B | `bedrock/llama3.3-70b` |
| Llama 3.2 90B | `bedrock/llama3.2-90b` |
| Llama 3.2 11B | `bedrock/llama3.2-11b` |
| Mistral Large 3 (675B) | `bedrock/mistral-large-3` |
| Mistral Large 2 | `bedrock/mistral-large-2` |
| Magistral Small | `bedrock/magistral-small` |
| Devstral 2 (123B) | `bedrock/devstral-2-123b` |
| Pixtral Large | `bedrock/pixtral-large` |
| Cohere Command R+ | `bedrock/cohere-command-r-plus` |
| Cohere Command R | `bedrock/cohere-command-r` |

### Self-hosted on Trainium (deployed on your cluster)
| Model | LiteLLM name | Instance |
|-------|-------------|----------|
| Qwen3 8B | `vllm/qwen3-8b-neuron` | inf2.xlarge |

## Add more models at runtime

LiteLLM stores model configs in its database — no redeploy needed.

### Add a Bedrock model

```bash
curl -X POST https://<your-alb>/litellm/model/new \
  -H "Authorization: Bearer sk-1234" \
  -H "Content-Type: application/json" \
  -d '{
    "model_name": "bedrock/my-new-model",
    "litellm_params": {
      "model": "bedrock/us.amazon.nova-pro-v1:0"
    }
  }'
```

### Add a self-hosted model

For self-hosted models, use the model management skill (see `.claude/skills/model-manager/`).

## Other useful commands

```bash
# Install/reinstall a single component
./cli ai-gateway litellm install

# Manage models via CLI
./cli llm-model vllm configure-models   # interactive model selection
./cli llm-model vllm update-models      # re-deploy model changes

# Terraform only
./cli terraform plan
./cli terraform output

# Tear down everything (uninstalls components, then destroys infra)
./cli cleanup-everything
```
