# GenAI on EKS Starter Kit

A starter kit for deploying and managing GenAI components and examples on Amazon EKS (Elastic Kubernetes Service). This project provides a collection of tools, configurations, components and examples to help you quickly set up a GenAI project on Kubernetes.

The starter kit includes the configurable components and examples from several categories:

- API Gateway - [kGateway](https://kgateway.dev) (Kubernetes Gateway API + OIDC), [OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/)
- AI Gateway - [LiteLLM](https://www.litellm.ai) (Team RBAC + Model Access Control), [Kong AI Gateway OSS](https://github.com/Kong/kong)
- LLM Model - [vLLM](https://docs.vllm.ai), [SGLang](https://docs.sglang.ai), [Ollama](https://ollama.com)
- Embedding Model - [Text Embedding Inference (TEI)](https://huggingface.co/docs/text-embeddings-inference)
- Observability (o11y) - [Langfuse](https://langfuse.com), [Phoenix](https://phoenix.arize.com), AMP/AMG
- GUI App - [Open WebUI](https://docs.openwebui.com)
- Vector Database - [Qdrant](https://qdrant.tech), [Chroma](https://docs.trychroma.com), [Milvus](https://milvus.io)
- Session Store - [Redis](https://redis.io) (OAuth2 + OpenWebUI session management)
- Workflow Automation - [n8n](https://docs.n8n.io)
- AI Agent - [OpenClaw](https://github.com/openclaw/openclaw)
- Security - [External Secrets Operator](https://external-secrets.io), [IAM Identity Center](https://aws.amazon.com/iam/identity-center/) (OIDC SSO)
- MCP Server - [FastMCP 2.0](https://gofastmcp.com)
- AI Agent Framework - [Strands Agents](https://strandsagents.com), [Agno](https://docs.agno.com)

## Prerequisites

Before you begin, ensure you have the following tools installed:

- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- [Terraform](https://www.terraform.io/downloads)
- [Node.js](https://nodejs.org/en/download)
- [kubectl](https://kubernetes.io/docs/tasks/tools)
- [Helm](https://helm.sh/docs/intro/install)
- [Docker](https://docs.docker.com/get-started/) and [Buildx](https://docs.docker.com/build/concepts/overview/#buildx)

## Initial Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
./cli configure
# Example:
# ✔ Enter value for REGION: us-west-2
# ✔ Enter value for EKS_CLUSTER_NAME: genai-on-eks
# ? Enter value for DOMAIN:
```

This will prompt you to enter values for environment variables. Then, it will save the values on `.env.local`. There are a few important ones, including:

- REGION - AWS region to be used to provision the infrastructure
- EKS_CLUSTER_NAME - Name of the EKS cluster
- EKS_MODE - EKS mode, `auto` (default) or `standard`
- DOMAIN - Recommend to use a domain name already configured with a Route 53 hosted zone, check [FAQs](#faqs) more details
- HF_TOKEN - Hugging Face [user access token](https://huggingface.co/docs/hub/en/security-tokens)

## Environment Setup

There are two methods to setup your environment:

### Method 1: Quick Demo Setup

To quickly set up a demo environment with infrastructure and essential components and examples:

```bash
./cli demo-setup
```

This command uses a **2-pass install** to automatically handle OIDC configuration:

```
=== Pass 1: Base components ===
  1.  vllm                  (LLM inference - Qwen3 models)
  2.  langfuse              (Observability - tracing)
  3.  qdrant                (Vector database)
  4.  tei                   (Text embedding - Qwen3 Embedding)
  5.  litellm               (AI Gateway - model routing)
  6.  redis                 (Session store)
  7.  external-secrets      (K8s secret management)
  8.  iam-identity-center   (OIDC app + groups → auto-saved to config.local.json)
  9.  openwebui             (Chat UI)
  10. amp-amg               (Monitoring - Prometheus + Grafana)

  ↓ config.local.json reloaded (OIDC_CLIENT_ID, OIDC_ISSUER_URL auto-populated)
  ↓ OIDC_COOKIE_SECRET auto-generated

=== Pass 2: API Gateway + Auth (OIDC-dependent) ===
  11. oauth2-proxy          (OIDC authentication + Redis sessions)
  12. kgateway              (Unified routing + CloudFront/WAF/Shield)

=== Examples ===
  13. calculator MCP Server
  14. calculator-agent      (Strands Agents)
  15. code-review-agent     (RAG: TEI → Qdrant → LLM review)

=== Post-install ===
  16. LiteLLM Team RBAC     (auto-configured)
```

All OIDC credentials (`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_ISSUER_URL`) are **auto-generated** by IAM Identity Center install and saved to `.env.local`. No manual setup required.

After demo-setup, the only manual step is **assigning users to groups** (`senior-dev`, `junior-dev`) in the IAM Identity Center console.

#### Demo Architecture

```
CloudFront (WAF) → Shield → NLB → kGateway (unified routing)
  → OAuth2-Proxy (OIDC + Redis session) → IAM Identity Center
  → x-user-email, x-user-groups headers injected
  → OpenWebUI, LiteLLM (team RBAC), Langfuse, Qdrant
  → Code Review Agent (RAG: TEI embedding → Qdrant → LLM review)
```

#### Code Review Agent (RAG Example)

The demo includes a Code Review Agent that demonstrates the full RAG lifecycle:
- Indexes sample Python code into Qdrant using TEI embeddings on startup
- Users ask code review questions via OpenWebUI
- Agent retrieves relevant code via vector search and provides reviews using LLM
- All interactions traced in Langfuse

#### RBAC (Role-Based Access Control)

Users authenticate via IAM Identity Center SSO. User groups map to LiteLLM teams with different model access:
- `senior-dev` group → access to all models
- `junior-dev` group → access to limited models

Teams are configured in `config.json` under `litellm.rbac.teams` and automatically provisioned during demo-setup.

Check [Demo Walkthrough](docs/DEMO_WALKTHROUGH.md) on how to setup and use the demo

### Method 2: Interactive Setup

For a more customized setup, you can use the interactive setup command:

```bash
./cli interactive-setup
# Example:
# ✔ Select AI Gateway components to install: litellm
# ✔ Select LLM Model components to install: vllm
# ? Select Embedding Model components to install: (Press <space> to select, <a> to toggle all, <i> to invert selection, and <enter> to proceed)
# ❯◉ Text Embedding Inference (TEI)
```

This command will:

1. Present you with a list of available components and examples organized by category
2. Allow you to select which components and examples you want to install
3. Set up the required infrastructure using Terraform
4. Install all the selected components and examples

Note. Unlike the quick demo setup, the selected components and examples may not be deployed in the required order. Some components/examples might need to be refreshed by running the CLI install command again.

## NVIDIA Dynamo Platform Setup

This starter kit supports deploying [NVIDIA Dynamo](https://developer.nvidia.com/dynamo) for optimized LLM inference on Amazon EKS.

### Quick Start

1. Install components in order:

```bash
./cli nvidia-platform monitoring install      # Prometheus + Grafana
./cli nvidia-platform gpu-operator install     # NVIDIA GPU Operator
./cli nvidia-platform dynamo-platform install  # Dynamo CRDs, Operator, etcd, NATS
./cli nvidia-platform dynamo-vllm install      # Deploy a model with vLLM
```

2. Optionally run benchmarks and auto-configuration:

```bash
./cli nvidia-platform benchmark install       # AIPerf concurrency sweep
./cli nvidia-platform aiconfigurator install   # TP/PP recommendation + SLA deploy
```

For full details on platform prerequisites, deployment modes (aggregated vs disaggregated), KV cache routing, monitoring dashboards, benchmarking, and AIConfigurator, see the [NVIDIA Platform README](components/nvidia-platform/README.md).

## Components & Examples Management

You can install or uninstall individual components/examples using the CLI:

### Install a Component/Example

```bash
./cli <category> <component/example> install

# Examples:
# ./cli ai-gateway litellm install
# ./cli strands-agents calculator-agent install
```

### Uninstall a Component/Example

```bash
./cli <category> <component/example> uninstall

# Examples:
# ./cli ai-gateway litellm uninstall
# ./cli strands-agents calculator-agent uninstall
```

### API Gateway & Authentication Management

#### Setup kGateway (unified ingress + CloudFront/WAF)

```bash
./cli api-gateway kgateway install
./cli api-gateway kgateway uninstall
```

#### Setup OAuth2-Proxy (OIDC + Redis sessions)

```bash
./cli api-gateway oauth2-proxy install
./cli api-gateway oauth2-proxy uninstall
```

#### Setup LiteLLM Team RBAC

```bash
./cli ai-gateway litellm setup-rbac
```

Creates teams with model access groups and generates team API keys. Teams are configured in `config.json` under `litellm.rbac.teams`.

#### Setup IAM Identity Center (OIDC SSO)

```bash
./cli security iam-identity-center install
./cli security iam-identity-center uninstall
```

Provisions OIDC application and user groups (senior-dev, junior-dev) via Terraform. OIDC config is automatically saved to `config.local.json`.

## LLM/Embedding Model Management

The CLI provides commands to manage LLM/Embedding models for the hosting components:

### Configure Models

Configure which models should be deployed for a specific component:

```bash
./cli llm-model <component> configure-models
./cli embedding-model <component> configure-models

# Example:
# ./cli llm-model vllm configure-models
# ./cli embedding-model tei configure-models
```

### Update Models

Add and/or remove models for a specific component:

```bash
./cli llm-model <component> update-models
./cli embedding-model <component> update-models

# Example:
# ./cli llm-model vllm update-models
# ./cli embedding-model tei update-models
```

### Add Models

Only add missing models for a specific component:

```bash
./cli llm-model <component> add-models
./cli embedding-model <component> add-models

# Example:
# ./cli llm-model vllm add-models
# ./cli embedding-model tei add-models
```

### Remove All Models

Remove all models for a specific component:

```bash
./cli llm-model <component> remove-all-models
./cli embedding-model <component> remove-all-models

# Example:
# ./cli llm-model vllm remove-all-models
# ./cli embedding-model tei remove-all-models
```

## Cleanup

There are two methods to clean up your environment:

### Method 1: Uninstall Components/Examples Individually and Destroy Infrastructure

This method gives you more control over the cleanup process:

1. Uninstall each component/example:

```bash
# Examples:
# ./cli strands-agents calculator-agent uninstall
# ./cli ai-gateway litellm uninstall
# ... uninstall other components/examples as needed
```

2. Destroy the infrastructure:

```bash
./cli cleanup-infra
```

### Method 2: Cleanup Everything at Once

This method provides a one-command solution to clean up all examples, components and infrastructure:

```bash
./cli cleanup-everything
```

This command will:

1. Attempt to uninstall all deployed examples and components
2. Destroy the infrastructure using Terraform

## FAQs

### How the config files work?

`.env` and `config.json` will be loaded first. Then, the configs will be merged/overriden with the values from `.env.local` and `config.local.json` if exist.

### How can I use this starter kit without having a Route 53 hosted zone?

With a domain name already configured with a Route 53 hosted zone, a single shared ALB with HTTPS is used together with a wildcard ACM cert and Route 53 DNS records to expose all public facing services e.g. litellm.\<DOMAIN\> and openwebui.\<DOMAIN\>.

Alternatively, when the `DOMAIN` field on `.env` (or `.env.local`) is empty, multiple ALBs with HTTP will be created for each public facing service. In this case, only one service requiring the Nginx Ingress basic auth (e.g. Milvus and Qdrant) can be exposed.

### How does kGateway integrate with the existing ingress?

When `kgateway.enabled` is `true` in `config.json` (default), kGateway replaces all individual ALB Ingress resources with a unified Gateway API routing layer:

- **With kGateway**: CloudFront → NLB → kGateway → HTTPRoutes per service (subdomain-based)
- **Without kGateway** (`kgateway.enabled: false`): Falls back to per-service ALB Ingress (backward compatible)

kGateway uses OAuth2-Proxy for OIDC authentication with Redis-backed sessions and forwards identity headers (`x-user-email`, `x-user-groups`) to upstream services.

### How does the RBAC model access control work?

LiteLLM Team RBAC restricts which models each user group can access:

1. IAM Identity Center defines user groups (`senior-dev`, `junior-dev`)
2. Users authenticate via OIDC SSO through kGateway + OAuth2-Proxy
3. `x-user-groups` header is forwarded to LiteLLM
4. LiteLLM maps groups to teams with allowed model lists
5. Requests to unauthorized models return 400 error

Configure teams in `config.json` under `litellm.rbac.teams`. Run `./cli ai-gateway litellm setup-rbac` to apply.

### Can I disable CloudFront/WAF/Shield?

Shield Advanced is disabled by default (`kgateway.enableShieldAdvanced: false`) due to cost ($3,000/month). Shield Standard is free and always active.

CloudFront and WAF are provisioned as part of kGateway install. To skip them, install kGateway components individually instead of using `demo-setup`.

### How can I configure and update the LiteLLM proxy model list?

Run `./cli litellm install` again to update the LiteLLM models.

For Bedrock models, the model list hardcoded on config.json.

```json
# Example:
"bedrock": {
  "llm": {
    "models": [
      { "name": "amazon-nova-premier", "model": "us.amazon.nova-premier-v1:0" },
      { "name": "claude-4-opus", "model": "us.anthropic.claude-opus-4-20250514-v1:0" },
    ]
  }
}
```

### How can I change the EC2 GPU instance families and purchasing options?

The default instance families are g6e, g6 and g5g and the default purchasing options are spot and on-demand. You can change the values on `terraform/0-common.tf` and then run `./cli terraform apply again`.

Note that the model deployment manifests use `nodeSelector` like `eks.amazonaws.com/instance-family: g6e` to lock the specific tested instance family which you will need to adjust accordingly.

For self-hosted models, they will be dynamically detected from the running model pods.

### How can I use LLM models with AWS Neuron and EC2 Inferentia 2?

The supported models will have the `-neuron` suffix. To enable the support, on `config.json` (or `config.local.json`), change `enableNeuron` to `true` and then install the component again (e.g `./cli llm-model vllm install`) which will take ~20-30 mins to build the vLLM Neuron container image and push it to ECR.

When a supported LLM model is deployed for the first time, Neorun just-in-time (JIT) compilation will compile the model which will take ~20-30 mins. The compiled model then will be cached on EFS file system for the subsequent deployments.

Llama-3.1-8B-Instruct, DeepSeek-R1-Distill-Llama-8B, Mistral-7B-Instruct-v0.3 models can the INT8 quantization to run on single inf2.xlarge, but inf2.8xlarge is still required to compile.

- 1st step is to deploy the model with will used inf2.8xlarge first to compile and cache the model
- Then, on `config.json` (or `config.local.json`), change from `"compile": true` to `"compile": false`
- Then, delete the model deploymen and then deploy again which will use inf2.xlarge

### How can I disable the multi-arch container image build?

By default, `docker buildx` is used to build the multi-arch container images. To disable it, modify the `docker` section on `config.json` (or `config.local.json`) to set `"useBuildx": false` and `arch` based on your machine OS arch.

### How can I use the different AWS region for Bedrock?

By default, the same region as the EKS cluster will be used. To change it, modify the `bedrock` section on `config.json` (or `config.local.json`) to set `region` to the preferred region.

### How can I provision and manage multiple EKS clusters?

You can change the values of the `REGION`, `EKS_CLUSTER_NAME`, and `DOMAIN` fields on `.env` (or `.env.local`). Then, Terraform workspace and kubectl context will automatically use those values when running the related `./cli` commands.

### What is ECR Pull Through Cache and should I enable it?

ECR Pull Through Cache caches external container images (from Docker Hub, GitHub Container Registry) in your private ECR registry. This avoids rate limits from public registries and keeps images within your AWS infrastructure.

**Default: Disabled** (`enable_ecr_pull_through_cache = false`)

**Why disabled by default?**
- Cached images are stored in your private ECR, which incurs storage costs
- Public registries (Docker Hub, GHCR) work fine for most use cases since EKS nodes have internet access

**When to enable:**
- You're hitting Docker Hub rate limits (anonymous: 100 pulls/6hrs, authenticated: 200 pulls/6hrs)
- You want faster, more reliable pulls from within AWS
- Your organization requires images to be stored in private registries

**To enable:**

Docker Hub and GitHub Container Registry require authentication for ECR pull through cache. You'll need to provide credentials for both registries.

1. **Get Docker Hub credentials:**
   - Create a Docker Hub account at [hub.docker.com](https://hub.docker.com)
   - Generate an access token at [Docker Hub Security Settings](https://hub.docker.com/settings/security) → "New Access Token"
   - For more information, see [Create and manage access tokens](https://docs.docker.com/security/for-developers/access-tokens/) in the Docker documentation

2. **Get GitHub credentials:**
   - Generate a Personal Access Token (classic) at [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
   - The token needs `read:packages` scope to pull from GitHub Container Registry
   - For more information, see [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) in the GitHub documentation

3. **Configure credentials in `config.local.json`:**

```json
// config.local.json
{
  "terraform": {
    "vars": {
      "enable_ecr_pull_through_cache": true,
      "dockerhub_username": "your-dockerhub-username",
      "dockerhub_access_token": "your-dockerhub-access-token",
      "github_username": "your-github-username",
      "github_token": "your-github-personal-access-token"
    }
  }
}
```

4. **Apply the changes:**

```bash
./cli terraform apply
```

**Important:** Keep your credentials in `config.local.json` (which is gitignored) and never commit them to version control. The credentials are stored securely in AWS Secrets Manager with the `ecr-pullthroughcache/` prefix.

**Supported registries:**
- `vllm/*` → Docker Hub
- `lmsysorg/*` → Docker Hub  
- `ollama/*` → Docker Hub
- `huggingface/*` → GitHub Container Registry

**Note:** When you `terraform destroy`, the cache rules are deleted but the cached ECR repositories remain. To fully clean up, manually delete repositories starting with `vllm/`, `lmsysorg/`, `ollama/`, or `huggingface/` from ECR.

## Disclaimer

⚠️ **This repository is intended for demonstration and learning purposes only.**
It is **not** intended for production use. The code provided here is for educational purposes and should not be used in a live environment without proper testing, validation, and modifications.

Use at your own risk. The authors are not responsible for any issues, damages, or losses that may result from using this code in production.

Check [Security Considerations](docs/SECURITY.md) for more information on the security scans.

## Contributing

Contributions welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) for more information.

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file.
