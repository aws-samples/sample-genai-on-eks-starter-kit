# Just the Endpoint

Deploy a minimal GenAI gateway on EKS: one LiteLLM endpoint that aggregates self-hosted models (Trainium) and Bedrock, with Langfuse for observability.

Following these steps won't deploy any of the agents that are built into the GenAI starter kit — but you can absolutely use agents with the endpoint. It's fully OpenAI-compatible, so point any agentic framework (Claude Code, Cursor, Continue, Strands, LangChain, your own code) at it and go.

## What you get

| Component | Purpose | URL |
|-----------|---------|-----|
| LiteLLM | OpenAI-compatible proxy (all models behind one endpoint) | `https://<domain>/litellm` |
| Langfuse | Observability (traces, costs, evals) | `https://<domain>/langfuse` |
| vLLM on Neuron | Self-hosted model — pick one (see [Choose your endpoint](#choose-your-endpoint)) | Internal (routed via LiteLLM) |
| Bedrock | 20 managed models (Claude, Nova, Llama, Mistral, etc.) | Via LiteLLM |

## Choose your endpoint

This example ships **two self-hosted model options**. They run on different Neuron instance types, so pick the one that matches the hardware you can get in your region — you deploy one at a time by toggling its `deploy` flag in `config.json` (`llm-model.vllm.models`).

| | **Option A — Qwen3-8B 32k** (default) | **Option B — Qwen3.6-27B 64k** |
|---|---|---|
| `config.json` name | `qwen3-8b-neuron-32k` | `qwen3-6-27b-neuron` |
| Instance | `inf2.8xlarge` (Inferentia2) | `trn2.3xlarge` (Trainium2, Capacity Block) |
| Context | 32k | 64k |
| Model | Qwen3-8B (dense) | Qwen3.6-27B (dense, stronger on code) |
| Availability | inf2 is broadly available (On-Demand / quota) in most regions | trn2.3xlarge only in `ap-southeast-4` / `sa-east-1`, **Capacity Block only** (~$2.25/hr) — see [Trainium capacity](#trainium-capacity-regions-and-capacity-blocks) |
| LiteLLM name | `vllm/qwen3-8b-neuron-32k` | `vllm/qwen3-6-27b-neuron` |

**Default is Option A** (8B on inf2) because Inferentia2 is far easier to obtain than a trn2 Capacity Block. To use Option B instead, set `qwen3-6-27b-neuron` to `deploy: true` and `qwen3-8b-neuron-32k` to `deploy: false` in `config.json`, and read the Trainium-capacity section first.

Both entries can technically be `deploy: true` at once, but that requires *both* an inf2.8xlarge and a trn2.3xlarge Capacity Block in the same region — rarely satisfiable (ap-southeast-4 has trn2 but no inf2; most other regions are the reverse). Treat it as one-or-the-other.

## Prerequisites

- AWS account with Bedrock model access enabled in your region
- **For Option A:** an `inf2.8xlarge` (On-Demand or quota increase for Inferentia2)
- **For Option B:** a `trn2.3xlarge` **Capacity Block** (see [Trainium capacity](#trainium-capacity-regions-and-capacity-blocks) below)
- Domain name (optional — ALB provides a raw URL if no domain configured)
- Node.js 18+, Terraform 1.5+, kubectl, Helm 3

## Trainium capacity: regions and Capacity Blocks

> **Only relevant for Option B (Qwen3.6-27B).** The default Option A (Qwen3-8B on inf2.8xlarge) uses Inferentia2, which is broadly available on-demand — skip this section unless you're deploying the 27B model.

Option B runs on **trn2.3xlarge** (1 Trainium2 chip, 96 GB accelerator memory). Before deploying it, understand where and how you can actually get one:

**Regions.** As of July 2026, trn2.3xlarge exists in exactly two regions: **sa-east-1** (São Paulo, 3 AZs) and **ap-southeast-4** (Melbourne, `ap-southeast-4c` only). There is no US or EU availability. This example defaults to `ap-southeast-4` — the whole stack (EKS, LiteLLM, Langfuse) deploys there, so expect the corresponding latency from wherever you sit.

**Spot and On-Demand don't work.** The instance type shows up in pricing pages and placement scores, but live launches return `InsufficientInstanceCapacity` in every AZ of both regions, for both Spot and On-Demand. Don't burn time on quota requests hoping otherwise.

**Capacity Blocks are the path that works.** [EC2 Capacity Blocks for ML](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-blocks.html) let you reserve the instance for a fixed window (hours to weeks), paid upfront (~$2.25/hr for trn2.3xlarge in ap-southeast-4; ≈$54/24h, ≈$1,600/mo continuous). Purchase flow:

```bash
# 1. Find an offering (blocks start on AWS's schedule, ≥ ~30 min lead time)
aws ec2 describe-capacity-block-offerings --region ap-southeast-4 \
  --instance-type trn2.3xlarge --instance-count 1 --capacity-duration-hours 24

# 2. Purchase it — TAG IT with your cluster name so Karpenter can find it
aws ec2 purchase-capacity-block --region ap-southeast-4 \
  --capacity-block-offering-id <offering-id> --instance-platform Linux/UNIX \
  --tag-specifications 'ResourceType=capacity-reservation,Tags=[{Key=karpenter.sh/discovery,Value=<your-cluster-name>}]'
```

**How the cluster consumes it.** The Terraform in this kit creates a `neuron-reserved` Karpenter NodePool that launches **only** into Capacity Blocks tagged `karpenter.sh/discovery=<cluster-name>` (via `capacityReservationSelectorTerms` — no hardcoded reservation IDs). Until the block's start time, the model pod just stays `Pending`; once the block is active, Karpenter launches the node within a minute or two. EC2 reclaims the instance 30 minutes before the block ends (Karpenter starts draining ~10 minutes before that warning), so the pod goes back to `Pending` until you buy the next block.

**Model compile cache.** First boot compiles the model for the Neuron chip (~40 minutes). The compiled artifacts persist on an EFS-backed volume, so pod restarts and *subsequent capacity blocks* boot in minutes, not another 40.

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
# Set REGION=ap-southeast-4 (or sa-east-1) — see Trainium capacity above.
./cli configure

# Deploy EKS cluster + all components
./cli demo-setup
```

Deployment takes ~15-20 minutes for the cluster and gateway. The self-hosted model then compiles for Neuron on first boot (~40 minutes, one-time — cached after). If you chose **Option B (27B)**, it additionally needs an **active Capacity Block** or the pod stays `Pending` (see [Trainium capacity](#trainium-capacity-regions-and-capacity-blocks)).

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

[opencode](https://opencode.ai) is a terminal coding agent. It works against this endpoint over the OpenAI-compatible API — both the managed Bedrock models and the self-hosted Qwen3.6.

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
        "vllm/qwen3-8b-neuron-32k":  { "name": "Qwen3-8B 32k (self-hosted, Option A)", "limit": { "context": 32768, "output": 8192 }, "tool_call": true },
        "vllm/qwen3-6-27b-neuron":   { "name": "Qwen3.6-27B 64k (self-hosted, Option B)", "limit": { "context": 65536, "output": 8192 }, "tool_call": true }
      }
    }
  },
  "model": "litellm/bedrock/claude-sonnet-4.6"
}
```

Two things that will break it if you skip them:
- **Model keys must include the `bedrock/` or `vllm/` prefix** — they must match the LiteLLM model names exactly (the ones in the tables above). `litellm/claude-sonnet-4.6` is wrong; `litellm/bedrock/claude-sonnet-4.6` is right.
- **Set `limit.output` on the self-hosted model.** Without it opencode requests a huge `max_tokens` and every call fails with `ContextWindowExceededError`. 8192 leaves room for input inside the 64k window.

**4. Run:**

```bash
opencode run -m litellm/bedrock/claude-sonnet-4.6 "explain this repo"           # managed, 200k context
opencode run -m litellm/vllm/qwen3-8b-neuron-32k "add a docstring to main.py"   # self-hosted Option A, 32k
opencode run -m litellm/vllm/qwen3-6-27b-neuron "add a docstring to main.py"    # self-hosted Option B, 64k
```

Use whichever self-hosted model you deployed (`deploy: true` in `config.json`). The `vllm/` name only resolves in LiteLLM if that model was actually deployed.

#### Context management: how long a session lasts

opencode is stateless per request — every turn it re-sends the **entire** conversation (its system prompt, all tool schemas, every prior message, and every tool result, which includes file contents) as one prompt. The model's context window has to hold that whole growing transcript, not just your latest message. For the self-hosted Qwen3.6:

- **Fixed overhead is real.** opencode's system prompt plus tool definitions is on the order of ~8–12k tokens before you type anything.
- **File reads dominate.** One moderate source file is 2–5k tokens, and each read stays in history.

**On `vllm/qwen3-6-27b-neuron` (64k context), expect a healthy multi-file session — roughly 2× the headroom of a typical 32k self-hosted setup.** When you do hit the limit, the request returns a clean `ContextWindowExceededError` (HTTP 400) rather than crashing the model, and opencode automatically compacts older turns (summarizing them) so the session can continue with less detail.

Two Neuron-specific characteristics to know:
- **Long prompts have proportionally long time-to-first-token.** Prefill is chunked through a fixed small-token kernel, so TTFT scales roughly linearly with prompt length — a 40k-token transcript takes ~10× longer to start answering than a 4k one. Decode speed is unaffected.
- **Concurrency is limited (one developer, not an org-wide endpoint).** On a single accelerator the 27B/trn2 option in particular serves **one request at a time** (`max-num-seqs: 1`) — the 27B BF16 weights nearly fill each Trainium core's memory, so a larger batch overcommits and fails; concurrent requests queue rather than run in parallel. Fine for a solo coding session; size up (or use Bedrock) for shared load.

To get more room:
- **Use a Bedrock model for anything long or multi-file** — Claude Sonnet/Opus on this same endpoint have a 200k context window (~3× more headroom) and stronger tool-calling.
- **Start focused sessions.** Point the agent at specific files rather than asking it to explore the whole repo; clear the session (`/new` in the TUI) between unrelated tasks.
- **Treat the self-hosted Qwen3.6 as the always-on option for bounded coding tasks** — it's a dense 27B coding model that Alibaba benchmarks above much larger MoE models on code.

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

### Self-hosted on Neuron (deployed on your cluster — pick one, see [Choose your endpoint](#choose-your-endpoint))
| Model | LiteLLM name | Context | Instance | Default |
|-------|-------------|---------|----------|---------|
| Qwen3-8B 32k | `vllm/qwen3-8b-neuron-32k` | 32k | inf2.8xlarge | ✅ `deploy: true` |
| Qwen3.6 27B | `vllm/qwen3-6-27b-neuron` | 64k | trn2.3xlarge (Capacity Block) | opt-in (`deploy: false`) |

The config also ships `deepseek-r1-qwen3-8b-neuron` (inf2.xlarge, `deploy: false`) as a third option.

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
