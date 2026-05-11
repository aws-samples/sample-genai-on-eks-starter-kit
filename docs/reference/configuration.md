# Configuration Guide

This guide explains how to configure the GenAI on EKS Starter Kit, including environment variables, configuration files, and advanced settings.

## Configuration Hierarchy

Configuration files are loaded in order, with later sources overriding earlier ones:

```
.env → config.json → .env.local → config.local.json
```

- **`.env`** - Default environment variables (tracked in git)
- **`config.json`** - Default component configuration (tracked in git)
- **`.env.local`** - User-specific environment overrides (gitignored)
- **`config.local.json`** - User-specific configuration overrides (gitignored)

!!! tip
    Always use `.env.local` and `config.local.json` for your customizations. Never commit these files to version control.

---

## Environment Variables

### Core Variables

#### REGION

AWS region for infrastructure deployment.

```bash
REGION=us-west-2
```

**Default:** `us-west-2`

**Common values:**
- `us-west-2` - Oregon (default)
- `us-east-1` - N. Virginia
- `eu-west-1` - Ireland
- `ap-northeast-1` - Tokyo

---

#### EKS_CLUSTER_NAME

Name of the EKS cluster.

```bash
EKS_CLUSTER_NAME=genai-on-eks
```

**Default:** `genai-on-eks`

This value is used for:
- EKS cluster name
- Terraform workspace name
- kubectl context selection

---

#### EKS_MODE

EKS deployment mode.

```bash
EKS_MODE=auto
```

**Options:**
- `auto` - EKS Auto Mode (default) - fully managed nodes
- `standard` - Standard EKS with self-managed Karpenter

**Auto Mode Benefits:**
- Fully managed node lifecycle
- Automatic scaling
- Built-in best practices
- Lower operational overhead

---

#### DOMAIN

Domain name for ingress with Route 53 hosted zone.

```bash
DOMAIN=example.com
```

**Default:** _(empty)_

**With domain:**
- Single shared ALB with HTTPS
- Wildcard ACM certificate
- Route 53 DNS records
- Services accessible at `<service>.<DOMAIN>` (e.g., `litellm.example.com`)

**Without domain:**
- Multiple ALBs with HTTP
- No DNS records
- Only one service with Nginx basic auth can be exposed

---

#### HF_TOKEN

Hugging Face user access token.

```bash
HF_TOKEN=hf_your_token_here
```

**Required for:**
- Downloading gated models (e.g., Llama, Mistral)
- Text Embedding Inference (TEI)
- Some vLLM/SGLang models

**How to get:**
1. Create account at [huggingface.co](https://huggingface.co)
2. Go to [Settings → Access Tokens](https://huggingface.co/settings/tokens)
3. Create a new token with `read` access

---

### Service API Keys

#### LITELLM_API_KEY

API key for accessing LiteLLM proxy.

```bash
LITELLM_API_KEY=sk-1234567890abcdef
```

**Default:** Auto-generated random string

Used by:
- AI agents to authenticate with LiteLLM
- Examples (calculator agents, OpenClaw)
- Open WebUI for model access

---

#### OPENCLAW_GATEWAY_TOKEN

Authentication token for OpenClaw bridge server.

```bash
OPENCLAW_GATEWAY_TOKEN=openclaw-gateway-token
```

**Default:** `openclaw-gateway-token`

Used by OpenClaw agents (doc-writer, devops-agent) to authenticate with the bridge server.

---

### Git Credentials (Optional)

#### OpenClaw Document Writer

```bash
OPENCLAW_DOC_WRITER_GIT_USERNAME=your-github-username
OPENCLAW_DOC_WRITER_GIT_TOKEN=ghp_your_fine_grained_token
```

**Purpose:** Allow doc-writer agent to push commits

**Security:** Use fine-grained tokens with minimal permissions

See [Document Writer Security](../examples/openclaw/doc-writer.md#git-credentials-optional) for details.

---

### Observability (Optional)

#### Langfuse

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
LANGFUSE_HOST=https://langfuse.example.com
```

**Purpose:** Enable LLM observability and tracing

**Auto-detected:** If Langfuse is installed, `LANGFUSE_HOST` is automatically set to the service URL

---

## config.json Structure

The `config.json` file configures components, models, and infrastructure settings.

### Component Configuration

```json
{
  "components": {
    "litellm": {
      "replicas": 2,
      "env": {
        "DATABASE_URL": "postgresql://...",
        "STORE_MODEL_IN_DB": "True"
      },
      "resources": {
        "requests": { "cpu": "500m", "memory": "512Mi" },
        "limits": { "cpu": "2000m", "memory": "2Gi" }
      }
    }
  }
}
```

---

### Model Configuration

#### LLM Models

```json
{
  "components": {
    "llm-model": {
      "vllm": {
        "models": [
          {
            "name": "llama-3.1-8b-instruct",
            "huggingFaceId": "meta-llama/Llama-3.1-8B-Instruct",
            "instanceFamily": "g6e",
            "replicas": 1,
            "env": {
              "MAX_MODEL_LEN": "8192",
              "GPU_MEMORY_UTILIZATION": "0.9"
            }
          }
        ]
      }
    }
  }
}
```

**Fields:**
- `name` - Model deployment name (used in URLs)
- `huggingFaceId` - Hugging Face model repository
- `instanceFamily` - EC2 instance family (`g6e`, `g6`, `g5`, etc.)
- `replicas` - Number of replicas
- `env` - vLLM environment variables

---

#### Embedding Models

```json
{
  "components": {
    "embedding-model": {
      "tei": {
        "models": [
          {
            "name": "gte-large-en-v1.5",
            "huggingFaceId": "Alibaba-NLP/gte-large-en-v1.5",
            "instanceFamily": "g6e",
            "replicas": 1
          }
        ]
      }
    }
  }
}
```

---

#### Bedrock Models

```json
{
  "bedrock": {
    "llm": {
      "models": [
        {
          "name": "amazon-nova-premier",
          "model": "us.amazon.nova-premier-v1:0"
        },
        {
          "name": "claude-4-opus",
          "model": "us.anthropic.claude-opus-4-20250514-v1:0"
        }
      ]
    }
  }
}
```

**Fields:**
- `name` - Friendly name for LiteLLM
- `model` - Bedrock model ID

---

### Docker Build Settings

```json
{
  "docker": {
    "useBuildx": true,
    "arch": "linux/amd64,linux/arm64"
  }
}
```

**Options:**
- `useBuildx: true` - Multi-arch builds using Docker Buildx
- `useBuildx: false` - Single-arch builds (native)
- `arch` - Target architectures

**Disable multi-arch:**
```json
{
  "docker": {
    "useBuildx": false,
    "arch": "linux/amd64"
  }
}
```

---

### Bedrock Region Configuration

```json
{
  "bedrock": {
    "region": "us-west-2"
  }
}
```

**Default:** Uses the same region as `REGION` environment variable

**Use case:** Access Bedrock models in a different region than your EKS cluster

---

### Neuron Support

Enable AWS Neuron for Inferentia 2 instances.

```json
{
  "components": {
    "llm-model": {
      "vllm": {
        "enableNeuron": true,
        "models": [
          {
            "name": "llama-3.1-8b-instruct-neuron",
            "huggingFaceId": "meta-llama/Llama-3.1-8B-Instruct",
            "instanceFamily": "inf2",
            "neuron": {
              "tensorParallelSize": 8,
              "compile": true
            }
          }
        ]
      }
    }
  }
}
```

**Fields:**
- `enableNeuron: true` - Enable Neuron support (builds vLLM Neuron image)
- `neuron.tensorParallelSize` - Number of Neuron cores
- `neuron.compile: true` - Compile model on first run (requires inf2.8xlarge)
- `neuron.compile: false` - Use cached compilation (can use inf2.xlarge)

**Process:**
1. Set `enableNeuron: true` and `compile: true`
2. Deploy model (uses inf2.8xlarge for compilation)
3. Wait for compilation to complete (~20-30 mins)
4. Set `compile: false` to use cached model
5. Redeploy (can use smaller instance like inf2.xlarge for INT8 quantized models)

---

## ECR Pull Through Cache

ECR Pull Through Cache caches external container images in your private ECR registry to avoid rate limits.

### Configuration

```json
{
  "terraform": {
    "vars": {
      "enable_ecr_pull_through_cache": true,
      "dockerhub_username": "your-dockerhub-username",
      "dockerhub_access_token": "dckr_pat_xxx",
      "github_username": "your-github-username",
      "github_token": "ghp_xxx"
    }
  }
}
```

!!! warning
    Always use `config.local.json` for credentials, never commit to `config.json`.

### Why Disabled by Default?

- **Storage costs**: Cached images are stored in private ECR
- **Public registries work fine**: EKS nodes have internet access
- **Most use cases don't need it**: Rate limits rarely hit in typical usage

### When to Enable

- Hitting Docker Hub rate limits (100 pulls/6hrs anonymous, 200 pulls/6hrs authenticated)
- Need faster, more reliable pulls from within AWS
- Organization requires images in private registries
- Air-gapped or restricted network environments

### Getting Credentials

**Docker Hub:**
1. Create account at [hub.docker.com](https://hub.docker.com)
2. Go to [Security Settings](https://hub.docker.com/settings/security)
3. Click "New Access Token"
4. Copy username and token

**GitHub:**
1. Go to [Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Generate new token (classic)
3. Select `read:packages` scope
4. Copy username and token

### Supported Registries

- `vllm/*` → Docker Hub
- `lmsysorg/*` → Docker Hub
- `ollama/*` → Docker Hub
- `huggingface/*` → GitHub Container Registry

### Cleanup

When you run `terraform destroy`, cache rules are deleted but cached repositories remain.

**Manual cleanup:**
```bash
aws ecr describe-repositories --region $REGION | \
  jq -r '.repositories[] | select(.repositoryName | startswith("vllm/") or startswith("lmsysorg/") or startswith("ollama/") or startswith("huggingface/")) | .repositoryName' | \
  xargs -I {} aws ecr delete-repository --repository-name {} --force --region $REGION
```

---

## Terraform Variables

Advanced Terraform configuration in `config.json`:

```json
{
  "terraform": {
    "vars": {
      "enable_ecr_pull_through_cache": false,
      "instance_families": ["g6e", "g6", "g5"],
      "purchasing_options": ["spot", "on-demand"]
    }
  }
}
```

### Instance Families

```json
{
  "terraform": {
    "vars": {
      "instance_families": ["g6e", "g6", "g5", "p5", "p4d"]
    }
  }
}
```

**Default:** `["g6e", "g6", "g5"]`

**Common families:**
- `g6e` - NVIDIA L40S (newest, best price/performance)
- `g6` - NVIDIA L4
- `g5` - NVIDIA A10G
- `p5` - NVIDIA H100 (highest performance)
- `p4d` - NVIDIA A100
- `inf2` - AWS Inferentia 2 (Neuron)

---

### Purchasing Options

```json
{
  "terraform": {
    "vars": {
      "purchasing_options": ["spot", "on-demand"]
    }
  }
}
```

**Default:** `["spot", "on-demand"]`

**Options:**
- `spot` - Up to 90% savings, can be interrupted
- `on-demand` - Stable, no interruptions

---

## Configuration Examples

### Development Environment

```json
{
  "docker": {
    "useBuildx": false,
    "arch": "linux/amd64"
  },
  "components": {
    "litellm": {
      "replicas": 1
    },
    "llm-model": {
      "vllm": {
        "models": [
          {
            "name": "llama-3.1-8b-instruct",
            "replicas": 1
          }
        ]
      }
    }
  }
}
```

**Features:**
- Single-arch builds (faster)
- Minimal replicas (lower cost)
- Small models only

---

### Production Environment

```json
{
  "docker": {
    "useBuildx": true,
    "arch": "linux/amd64,linux/arm64"
  },
  "components": {
    "litellm": {
      "replicas": 3,
      "env": {
        "DATABASE_URL": "postgresql://...",
        "STORE_MODEL_IN_DB": "True"
      }
    },
    "llm-model": {
      "vllm": {
        "models": [
          {
            "name": "llama-3.1-70b-instruct",
            "replicas": 2
          }
        ]
      }
    }
  },
  "terraform": {
    "vars": {
      "enable_ecr_pull_through_cache": true,
      "purchasing_options": ["on-demand"]
    }
  }
}
```

**Features:**
- Multi-arch builds (flexibility)
- High availability (multiple replicas)
- ECR Pull Through Cache (reliability)
- On-demand instances (stability)
- Database persistence

---

### Cost-Optimized Environment

```json
{
  "terraform": {
    "vars": {
      "purchasing_options": ["spot"],
      "instance_families": ["g6e"]
    }
  },
  "components": {
    "llm-model": {
      "vllm": {
        "models": [
          {
            "name": "llama-3.1-8b-instruct",
            "instanceFamily": "g6e",
            "replicas": 1,
            "env": {
              "GPU_MEMORY_UTILIZATION": "0.95"
            }
          }
        ]
      }
    }
  }
}
```

**Features:**
- Spot instances only (up to 90% savings)
- Latest instance family (g6e - best price/performance)
- Small models
- High GPU utilization

---

## Security Best Practices

### Environment Variables

✅ **DO:**
- Use `.env.local` for sensitive values
- Generate strong random API keys
- Rotate credentials regularly
- Use fine-grained tokens with minimal permissions

❌ **DON'T:**
- Commit `.env.local` or `config.local.json` to git
- Use classic GitHub tokens (use fine-grained)
- Share API keys across environments
- Hardcode credentials in code

---

### Configuration Files

✅ **DO:**
- Keep `config.json` for defaults only
- Use `config.local.json` for overrides
- Document required environment variables
- Validate configuration on startup

❌ **DON'T:**
- Store credentials in `config.json`
- Commit `config.local.json` to git
- Use weak passwords or tokens

---

## Troubleshooting

### Configuration Not Loading

**Problem:** Changes to config files not taking effect

**Solution:**
1. Verify file names (`.env.local`, not `.env.local.txt`)
2. Check JSON syntax: `jq . config.local.json`
3. Restart component: `./cli <category> <component> install`

---

### Environment Variable Precedence

**Problem:** Wrong environment variable value used

**Solution:** Check loading order:
```bash
# Check effective configuration
cat .env
cat .env.local
echo $REGION
```

---

### Model Not Loading

**Problem:** Model fails to deploy

**Solution:**
1. Verify `huggingFaceId` is correct
2. Check `HF_TOKEN` is set for gated models
3. Ensure instance family has sufficient GPU memory
4. Review pod logs: `kubectl logs -n vllm -l model=<name>`

---

## See Also

- [CLI Commands Reference](cli-commands.md)
- [FAQ](faq.md)
- [Security Considerations](security.md)
- [Infrastructure Setup](../getting-started/infrastructure.md)
