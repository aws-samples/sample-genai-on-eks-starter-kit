# Frequently Asked Questions (FAQ)

Common questions and answers about the GenAI on EKS Starter Kit.

---

## Configuration

### How do the config files work?

`.env` and `config.json` are loaded first as defaults. Then, the configuration is merged/overridden with values from `.env.local` and `config.local.json` if they exist.

**Loading order:**
```
.env → config.json → .env.local → config.local.json
```

**Best practice:**
- Keep defaults in `.env` and `config.json` (tracked in git)
- Keep your customizations in `.env.local` and `config.local.json` (gitignored)

**Example:**
```bash
# .env (default)
REGION=us-west-2

# .env.local (your override)
REGION=us-east-1
```

The final value will be `us-east-1`.

---

## Domain & Networking

### How can I use this starter kit without having a Route 53 hosted zone?

There are two ingress configurations:

**With a domain (recommended):**
- Single shared ALB with HTTPS
- Wildcard ACM certificate
- Route 53 DNS records
- All services accessible at `<service>.<DOMAIN>`
- Example: `litellm.example.com`, `openwebui.example.com`

**Without a domain:**
- Multiple ALBs with HTTP
- No DNS records required
- Only one service requiring Nginx Ingress basic auth (e.g., Milvus, Qdrant) can be exposed
- Access services via ALB DNS names (long URLs)

**To use without a domain:**

1. Leave `DOMAIN` empty in `.env`:
   ```bash
   DOMAIN=
   ```

2. Each public-facing service will get its own ALB

3. Find service URLs:
   ```bash
   kubectl get ingress --all-namespaces
   ```

**Limitations without domain:**
- Cannot expose multiple services with basic auth
- HTTP only (no HTTPS)
- Long ALB DNS names instead of friendly URLs

---

## Model Management

### How can I configure and update the LiteLLM proxy model list?

LiteLLM automatically discovers self-hosted models (vLLM, SGLang, Ollama, TGI) running in the cluster.

For **Bedrock models**, the model list is configured in `config.json`:

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

**To update:**

1. Edit `config.json` or `config.local.json` (recommended)
2. Reinstall LiteLLM:
   ```bash
   ./cli ai-gateway litellm install
   ```

**Self-hosted models:**

Self-hosted models are automatically detected from running pods and added to LiteLLM's config.

To add a new model:
```bash
./cli llm-model vllm add-models
```

To update models:
```bash
./cli llm-model vllm update-models
```

---

## Infrastructure

### How can I change the EC2 GPU instance families and purchasing options?

The default instance families are `g6e`, `g6`, and `g5`. The default purchasing options are `spot` and `on-demand`.

**To change:**

1. Edit `terraform/0-common.tf` directly, OR
2. Edit `config.json` or `config.local.json`:

```json
{
  "terraform": {
    "vars": {
      "instance_families": ["g6e", "p5", "p4d"],
      "purchasing_options": ["on-demand"]
    }
  }
}
```

3. Apply the changes:
```bash
./cli terraform apply
```

**Note:** Model deployment manifests use `nodeSelector` to lock to specific instance families:

```yaml
nodeSelector:
  eks.amazonaws.com/instance-family: g6e
```

You'll need to adjust the `instanceFamily` field in model configurations accordingly.

**Common instance families:**
- `g6e` - NVIDIA L40S (newest, best price/performance)
- `g6` - NVIDIA L4
- `g5` - NVIDIA A10G
- `p5` - NVIDIA H100 (highest performance)
- `p4d` - NVIDIA A100
- `inf2` - AWS Inferentia 2 (for Neuron)

---

## Neuron & Inferentia

### How can I use LLM models with AWS Neuron and EC2 Inferentia 2?

Supported models have the `-neuron` suffix. To enable Neuron support:

1. Enable Neuron in `config.json` or `config.local.json`:
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

2. Install the component (builds vLLM Neuron image, takes ~20-30 mins):
```bash
./cli llm-model vllm install
```

**First-time deployment:**

When a Neuron model is deployed for the first time, Neuron performs just-in-time (JIT) compilation which takes ~20-30 minutes. The compiled model is cached on EFS for subsequent deployments.

**Using INT8 quantization on inf2.xlarge:**

Models like Llama-3.1-8B-Instruct, DeepSeek-R1-Distill-Llama-8B, and Mistral-7B-Instruct-v0.3 support INT8 quantization to run on a single inf2.xlarge. However, compilation still requires inf2.8xlarge.

**Process:**

1. Deploy with `compile: true` (uses inf2.8xlarge for compilation):
```json
{
  "neuron": {
    "tensorParallelSize": 8,
    "compile": true
  }
}
```

2. Wait for compilation to complete (~20-30 mins)

3. Change to `compile: false` in config:
```json
{
  "neuron": {
    "tensorParallelSize": 8,
    "compile": false
  }
}
```

4. Delete the model deployment:
```bash
kubectl delete deployment <model-name> -n vllm
```

5. Redeploy (now uses inf2.xlarge with cached model):
```bash
./cli llm-model vllm install
```

---

## Docker & Multi-Arch

### How can I disable the multi-arch container image build?

By default, Docker Buildx is used to build multi-arch container images (`linux/amd64` and `linux/arm64`).

**To disable:**

1. Edit `config.json` or `config.local.json`:
```json
{
  "docker": {
    "useBuildx": false,
    "arch": "linux/amd64"
  }
}
```

2. Set `arch` based on your machine's OS architecture:
   - Intel/AMD Mac: `linux/amd64`
   - M1/M2/M3 Mac: `linux/arm64`
   - Intel/AMD Linux: `linux/amd64`
   - ARM Linux: `linux/arm64`

**When to disable:**
- Faster builds during development
- Don't need ARM64 support
- Buildx not available

**When to keep enabled:**
- Production deployments
- Need both AMD64 and ARM64 support
- Using Karpenter with mixed instance types

---

## Bedrock

### How can I use a different AWS region for Bedrock?

By default, Bedrock uses the same region as your EKS cluster (`REGION` environment variable).

**To use a different region:**

1. Edit `config.json` or `config.local.json`:
```json
{
  "bedrock": {
    "region": "us-east-1"
  }
}
```

2. Reinstall LiteLLM:
```bash
./cli ai-gateway litellm install
```

**Use cases:**
- Access models not available in your EKS region
- Use Bedrock in a region with lower latency
- Comply with data residency requirements

**Example:**
```json
{
  "bedrock": {
    "region": "us-east-1",
    "llm": {
      "models": [
        {
          "name": "claude-4-opus",
          "model": "us.anthropic.claude-opus-4-20250514-v1:0"
        }
      ]
    }
  }
}
```

---

## Multi-Cluster

### How can I provision and manage multiple EKS clusters?

You can manage multiple clusters by changing the values of `REGION`, `EKS_CLUSTER_NAME`, and `DOMAIN` in `.env` or `.env.local`.

Terraform workspace and kubectl context automatically use these values when running `./cli` commands.

**Example workflow:**

1. Configure first cluster:
```bash
# .env.local
REGION=us-west-2
EKS_CLUSTER_NAME=genai-on-eks-west
DOMAIN=west.example.com
```

2. Deploy first cluster:
```bash
./cli demo-setup
```

3. Configure second cluster:
```bash
# .env.local
REGION=us-east-1
EKS_CLUSTER_NAME=genai-on-eks-east
DOMAIN=east.example.com
```

4. Deploy second cluster:
```bash
./cli demo-setup
```

**How it works:**

- Terraform uses workspace named after `EKS_CLUSTER_NAME`
- kubectl context is automatically selected based on cluster name
- Each cluster has independent state

**Switch between clusters:**

```bash
# Edit .env.local to change EKS_CLUSTER_NAME
# All subsequent commands target the specified cluster
./cli ai-gateway litellm install
```

---

## ECR Pull Through Cache

### What is ECR Pull Through Cache and should I enable it?

ECR Pull Through Cache caches external container images (from Docker Hub, GitHub Container Registry) in your private ECR registry.

**Benefits:**
- Avoids rate limits from public registries
- Faster pulls from within AWS
- Images stay within your AWS infrastructure
- More reliable (no external registry downtime)

**Default: Disabled** (`enable_ecr_pull_through_cache = false`)

**Why disabled by default?**
- Cached images stored in ECR incur storage costs
- Public registries work fine for most use cases (EKS nodes have internet access)
- Requires Docker Hub and GitHub authentication

**Rate limits:**
- Docker Hub anonymous: 100 pulls/6 hours
- Docker Hub authenticated: 200 pulls/6 hours
- GitHub: Generally higher limits

**When to enable:**
- Hitting rate limits (frequent large-scale deployments)
- Need faster, more reliable pulls
- Organization requires private registry storage
- Air-gapped or restricted network environments

**To enable:**

1. Get credentials:
   - [Docker Hub access token](https://hub.docker.com/settings/security)
   - [GitHub Personal Access Token](https://github.com/settings/tokens) with `read:packages`

2. Add to `config.local.json`:
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

3. Apply:
```bash
./cli terraform apply
```

**Supported registries:**
- `vllm/*` → Docker Hub
- `lmsysorg/*` → Docker Hub
- `ollama/*` → Docker Hub
- `huggingface/*` → GitHub Container Registry

**Cleanup:**

When you run `terraform destroy`, cache rules are deleted but cached repositories remain.

Manual cleanup:
```bash
aws ecr describe-repositories --region $REGION | \
  jq -r '.repositories[] | select(.repositoryName | startswith("vllm/") or startswith("lmsysorg/") or startswith("ollama/") or startswith("huggingface/")) | .repositoryName' | \
  xargs -I {} aws ecr delete-repository --repository-name {} --force --region $REGION
```

---

## Troubleshooting

### Components fail to install

**Problem:** `./cli <category> <component> install` fails

**Common causes:**

1. **Prerequisites not installed:**
   - Check: `kubectl version`, `helm version`, `docker version`
   - Solution: Install missing tools

2. **Cluster not accessible:**
   - Check: `kubectl get nodes`
   - Solution: Run `aws eks update-kubeconfig --name $EKS_CLUSTER_NAME --region $REGION`

3. **Dependencies not installed:**
   - Some components depend on others (e.g., examples need LiteLLM)
   - Solution: Install dependencies first

4. **Resource limits:**
   - Insufficient GPU nodes
   - Solution: Check node availability: `kubectl get nodes -l eks.amazonaws.com/compute-type=gpu`

---

### Models fail to deploy

**Problem:** Model pod stays in `Pending` or `ImagePullBackOff`

**Solutions:**

1. **Pending (no nodes):**
   ```bash
   kubectl describe pod -n vllm <pod-name>
   # Check Events for "no nodes available"
   ```
   - Solution: Wait for Karpenter to provision nodes (~5 mins)
   - Or check instance families are available in your region

2. **ImagePullBackOff:**
   ```bash
   kubectl describe pod -n vllm <pod-name>
   # Check Events for image pull errors
   ```
   - Solution: Verify HF_TOKEN is set for gated models
   - Or check Docker Hub rate limits (enable ECR Pull Through Cache)

3. **CrashLoopBackOff:**
   ```bash
   kubectl logs -n vllm <pod-name>
   # Check logs for OOM or CUDA errors
   ```
   - Solution: Increase GPU memory utilization or use larger instance

---

### Services not accessible

**Problem:** Cannot access services via ingress

**Solutions:**

1. **With domain:**
   - Verify Route 53 hosted zone exists
   - Check DNS records: `nslookup litellm.$DOMAIN`
   - Check ALB: `kubectl get ingress -n litellm`

2. **Without domain:**
   - Find ALB DNS name: `kubectl get ingress --all-namespaces`
   - Use ALB DNS name directly

3. **Certificate issues:**
   - Check ACM certificate status in AWS console
   - Ensure DNS validation records exist

---

## See Also

- [Configuration Guide](configuration.md)
- [CLI Commands Reference](cli-commands.md)
- [Security Considerations](security.md)
- [Demo Walkthrough](../getting-started/demo-walkthrough.md)
