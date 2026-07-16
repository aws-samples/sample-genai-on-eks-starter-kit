# Just the Endpoint

Deploy a minimal GenAI gateway on EKS: one LiteLLM endpoint that aggregates self-hosted models (Trainium) and Bedrock, with Langfuse for observability.

Following these steps won't deploy any of the agents that are built into the GenAI starter kit — but you can absolutely use agents with the endpoint. It's fully OpenAI-compatible, so point any agentic framework (Claude Code, Cursor, Continue, Strands, LangChain, your own code) at it and go.

## What you get

| Component | Purpose | URL |
|-----------|---------|-----|
| LiteLLM | OpenAI-compatible proxy (all models behind one endpoint) | `https://<domain>/litellm` |
| Langfuse | Observability (traces, costs, evals) | `https://<domain>/langfuse` |
| vLLM on Trainium | Self-hosted model (qwen3-8b, 32k context, on inf2.8xlarge) | Internal (routed via LiteLLM) |
| Bedrock | 20 managed models (Claude, Nova, Llama, Mistral, etc.) | Via LiteLLM |

## Prerequisites

- AWS account with Bedrock model access enabled in your region
- `inf2.8xlarge` quota (2 Neuron cores) — request via Service Quotas if needed
- Domain name (optional — ALB provides a raw URL if no domain configured)
- Node.js 18+, Terraform 1.5+, kubectl, Helm 3

## Deploy

```bash
git clone https://github.com/aws-samples/sample-genai-on-eks-starter-kit.git
cd sample-genai-on-eks-starter-kit

# This example lives on its own branch, not main
git checkout example/just-the-endpoint

# Install CLI dependencies (needed before any ./cli command)
npm install

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

### opencode (AI coding agent)

[opencode](https://opencode.ai) is a terminal coding agent. It works against this endpoint over the OpenAI-compatible API — both the managed Bedrock models and the self-hosted Qwen3.

**1. Install:**

```bash
curl -fsSL https://opencode.ai/install | bash
```

**2. Export your LiteLLM key** (the value of `LITELLM_API_KEY` from your `.env.local`):

```bash
export LITELLM_API_KEY=<your-litellm-key>   # add to ~/.bashrc to persist
```

**3. Create `~/.config/opencode/opencode.json`:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "litellm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "GenAI-on-EKS LiteLLM",
      "options": {
        "baseURL": "https://litellm.<your-domain>/v1",
        "apiKey": "{env:LITELLM_API_KEY}"
      },
      "models": {
        "bedrock/claude-sonnet-4.6": { "name": "Claude Sonnet 4.6 (Bedrock)", "limit": { "context": 200000, "output": 16384 }, "tool_call": true },
        "bedrock/claude-opus-4.8":  { "name": "Claude Opus 4.8 (Bedrock)",  "limit": { "context": 200000, "output": 16384 }, "tool_call": true },
        "vllm/qwen3-8b-neuron-32k":     { "name": "Qwen3-8B (self-hosted Neuron)", "limit": { "context": 32768, "output": 8192 }, "tool_call": true, "reasoning": true }
      }
    }
  },
  "model": "litellm/bedrock/claude-sonnet-4.6"
}
```

Two things that will break it if you skip them:
- **Model keys must include the `bedrock/` or `vllm/` prefix** — they must match the LiteLLM model names exactly (the ones in the tables above). `litellm/claude-sonnet-4.6` is wrong; `litellm/bedrock/claude-sonnet-4.6` is right.
- **Set `limit.output` on the self-hosted model.** Without it opencode requests a huge `max_tokens` and every call fails with `ContextWindowExceededError`. 8192 leaves room for input inside the 32k window.

**4. Run:**

```bash
opencode run -m litellm/bedrock/claude-sonnet-4.6 "explain this repo"   # managed, 200k context
opencode run -m litellm/vllm/qwen3-8b-neuron-32k "add a docstring to main.py"  # self-hosted, 32k context
```

#### Context management: how long a session lasts

opencode is stateless per request — every turn it re-sends the **entire** conversation (its system prompt, all tool schemas, every prior message, and every tool result, which includes file contents) as one prompt. The model's context window has to hold that whole growing transcript, not just your latest message. That has direct consequences for the self-hosted Qwen3:

- **Fixed overhead is real.** opencode's system prompt plus tool definitions is on the order of ~8–12k tokens before you type anything.
- **Qwen3 is a reasoning model** — its thinking traces add ~1–3k tokens per turn on top of the visible answer.
- **File reads dominate.** One moderate source file is 2–5k tokens, and each read stays in history.

**On `vllm/qwen3-8b-neuron-32k` (32k context), expect roughly 3–6 substantive rounds, or a few file reads, before you approach the limit.** When you hit it, the request returns a clean `ContextWindowExceededError` (HTTP 400) rather than crashing the model, and opencode automatically compacts older turns (summarizing them) so the session can continue with less detail.

To get more room:
- **Use a Bedrock model for anything long or multi-file** — Claude Sonnet/Opus on this same endpoint have a 200k context window (~6× more headroom) and stronger tool-calling.
- **Start focused sessions.** Point the agent at specific files rather than asking it to explore the whole repo; clear the session (`/new` in the TUI) between unrelated tasks.
- **Treat the self-hosted Qwen3 as the cheap, always-on option for bounded tasks** (single-file edits, quick questions), not for long open-ended agent runs.

> The self-hosted Qwen3 serves **one request at a time** (`--max-num-seqs=1`, required to fit 32k on a single Inferentia2 chip — see below). It's sized for a single developer, not a shared team endpoint.

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
| Model | LiteLLM name | Context | Instance |
|-------|-------------|---------|----------|
| Qwen3 8B (32k) | `vllm/qwen3-8b-neuron-32k` | 32k | inf2.8xlarge |

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
