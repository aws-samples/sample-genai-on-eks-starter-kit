# CLI Commands Reference

The starter kit provides a unified CLI (`./cli`) for managing infrastructure, components, and examples. This page documents all available commands and their usage.

## Core Commands

### configure

Configure environment variables for the project.

```bash
./cli configure
```

Interactive prompts for:

- `REGION` - AWS region (e.g., `us-west-2`)
- `EKS_CLUSTER_NAME` - Name of the EKS cluster
- `EKS_MODE` - EKS mode: `auto` (default) or `standard`
- `DOMAIN` - Domain name for ingress (optional)
- `HF_TOKEN` - Hugging Face user access token

Values are saved to `.env.local`.

**Example:**
```bash
./cli configure
# ✔ Enter value for REGION: us-west-2
# ✔ Enter value for EKS_CLUSTER_NAME: genai-on-eks
# ✔ Enter value for DOMAIN: example.com
```

---

### demo-setup

Quick setup with infrastructure and curated demo components.

```bash
./cli demo-setup
```

This command:

1. Sets up required infrastructure using Terraform
2. Deploys demo components specified in `config.json`
3. Installs components in the correct dependency order

See [Demo Walkthrough](../getting-started/demo-walkthrough.md) for details.

---

### interactive-setup

Guided setup with component selection.

```bash
./cli interactive-setup
```

This command:

1. Presents interactive menus for component selection
2. Sets up required infrastructure using Terraform
3. Installs selected components (order not guaranteed)

**Example:**
```bash
./cli interactive-setup
# ✔ Select AI Gateway components to install: litellm
# ✔ Select LLM Model components to install: vllm
# ✔ Select Embedding Model components to install: tei
```

!!! note
    Some components may need to be re-installed after initial setup due to dependencies.

---

## Component Management

### Install a Component

```bash
./cli <category> <component> install
```

**Categories:**
- `nvidia-platform` - NVIDIA Platform components
- `ai-gateway` - AI Gateway components
- `llm-model` - LLM Model components
- `embedding-model` - Embedding Model components
- `guardrail` - Guardrail components
- `o11y` - Observability components
- `gui-app` - GUI App components
- `vector-database` - Vector Database components
- `workflow-automation` - Workflow Automation components
- `ai-agent` - AI Agent components

**Examples:**
```bash
./cli ai-gateway litellm install
./cli llm-model vllm install
./cli embedding-model tei install
./cli o11y langfuse install
./cli gui-app openwebui install
./cli vector-database qdrant install
./cli ai-agent openclaw install
```

---

### Uninstall a Component

```bash
./cli <category> <component> uninstall
```

**Examples:**
```bash
./cli ai-gateway litellm uninstall
./cli llm-model vllm uninstall
./cli embedding-model tei uninstall
```

---

## Example Management

### Install an Example

```bash
./cli <category> <example> install
```

**Categories:**
- `mcp-server` - MCP Server examples
- `strands-agents` - Strands Agents examples
- `agno` - Agno examples
- `openclaw` - OpenClaw examples

**Examples:**
```bash
./cli mcp-server calculator install
./cli strands-agents calculator-agent install
./cli agno calculator-agent install
./cli openclaw doc-writer install
./cli openclaw devops-agent install
```

---

### Uninstall an Example

```bash
./cli <category> <example> uninstall
```

**Examples:**
```bash
./cli mcp-server calculator uninstall
./cli strands-agents calculator-agent uninstall
./cli agno calculator-agent uninstall
./cli openclaw doc-writer uninstall
./cli openclaw devops-agent uninstall
```

---

## Model Management

### Configure Models

Configure which models should be deployed for a component.

```bash
./cli llm-model <component> configure-models
./cli embedding-model <component> configure-models
```

**Examples:**
```bash
./cli llm-model vllm configure-models
./cli llm-model sglang configure-models
./cli embedding-model tei configure-models
```

This command presents an interactive menu to select models from the available list in `config.json`.

---

### Update Models

Add and/or remove models for a component.

```bash
./cli llm-model <component> update-models
./cli embedding-model <component> update-models
```

**Examples:**
```bash
./cli llm-model vllm update-models
./cli embedding-model tei update-models
```

Interactive prompts:
1. Select models to add (from available models)
2. Select models to remove (from currently deployed models)

---

### Add Models

Add missing models without removing existing ones.

```bash
./cli llm-model <component> add-models
./cli embedding-model <component> add-models
```

**Examples:**
```bash
./cli llm-model vllm add-models
./cli embedding-model tei add-models
```

This only adds new models - existing deployments are not touched.

---

### Remove All Models

Remove all deployed models for a component.

```bash
./cli llm-model <component> remove-all-models
./cli embedding-model <component> remove-all-models
```

**Examples:**
```bash
./cli llm-model vllm remove-all-models
./cli embedding-model tei remove-all-models
```

!!! warning
    This will delete all model deployments for the specified component.

---

## NVIDIA Platform Commands

### Install NVIDIA Components

```bash
./cli nvidia-platform monitoring install          # Prometheus + Grafana
./cli nvidia-platform gpu-operator install        # NVIDIA GPU Operator
./cli nvidia-platform dynamo-platform install     # Dynamo CRDs, Operator, etcd, NATS
./cli nvidia-platform dynamo-vllm install         # Deploy model with vLLM
./cli nvidia-platform benchmark install           # AIPerf concurrency sweep
./cli nvidia-platform aiconfigurator install      # TP/PP recommendation + SLA deploy
```

See [NVIDIA Platform Overview](../components/nvidia-platform/index.md) for detailed documentation.

---

## Cleanup Commands

### cleanup-infra

Destroy infrastructure using Terraform.

```bash
./cli cleanup-infra
```

This command:

1. Runs `terraform destroy` to remove all AWS resources
2. Keeps component/example deployments (if any remain)

!!! warning
    This will destroy the EKS cluster and all associated AWS resources.

---

### cleanup-everything

Comprehensive cleanup of components, examples, and infrastructure.

```bash
./cli cleanup-everything
```

This command:

1. Attempts to uninstall all deployed examples
2. Attempts to uninstall all deployed components
3. Destroys infrastructure using Terraform

!!! warning
    This is a destructive operation. Ensure you have backups of any important data.

---

## Terraform Commands

### terraform apply

Apply Terraform configuration.

```bash
./cli terraform apply
```

This command:

1. Initializes Terraform workspace based on `EKS_CLUSTER_NAME`
2. Runs `terraform apply` with auto-approve
3. Applies infrastructure changes

**Use cases:**
- Update infrastructure after changing Terraform variables
- Apply configuration changes from `config.json`
- Re-apply infrastructure after manual modifications

**Example:**
```bash
# Update ECR Pull Through Cache settings
# Edit config.local.json to enable ECR Pull Through Cache
./cli terraform apply
```

---

## Command Options

### Common Patterns

All component/example commands follow the pattern:
```bash
./cli <category> <component|example> <action>
```

Where:
- `<category>` - Component or example category
- `<component|example>` - Specific component or example name
- `<action>` - `install` or `uninstall`

### Finding Available Components

List all available components and examples in `cli-menu.json`:

```bash
cat cli-menu.json | jq '.componentCategories[].components[].name'
cat cli-menu.json | jq '.exampleCategories[].examples[].name'
```

---

## Environment Variables

The CLI uses environment variables from:

1. `.env` (default values)
2. `config.json` (default configuration)
3. `.env.local` (user overrides)
4. `config.local.json` (user configuration)

Later sources override earlier ones.

### Key Variables

| Variable | Description | Default |
|---|---|---|
| `REGION` | AWS region | `us-west-2` |
| `EKS_CLUSTER_NAME` | EKS cluster name | `genai-on-eks` |
| `EKS_MODE` | EKS mode | `auto` |
| `DOMAIN` | Domain name for ingress | _(empty)_ |
| `HF_TOKEN` | Hugging Face token | _(required)_ |
| `LITELLM_API_KEY` | LiteLLM API key | _(generated)_ |
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw token | `openclaw-gateway-token` |

---

## Troubleshooting

### Command Not Found

**Problem:** `./cli: command not found`

**Solution:** Ensure you're in the project root directory:
```bash
cd /path/to/sample-genai-on-eks-starter-kit
./cli configure
```

### Permission Denied

**Problem:** `./cli: Permission denied`

**Solution:** Make the CLI executable:
```bash
chmod +x ./cli
./cli configure
```

### Component Installation Fails

**Problem:** Component fails to install

**Solution:**
1. Check prerequisites are installed (kubectl, helm, docker)
2. Verify AWS credentials are configured
3. Check cluster is accessible: `kubectl get nodes`
4. Review component logs: `kubectl logs -n <namespace> -l app=<component>`

### Terraform Errors

**Problem:** Terraform commands fail

**Solution:**
1. Ensure Terraform is installed: `terraform version`
2. Check AWS credentials: `aws sts get-caller-identity`
3. Review Terraform state: `cd terraform && terraform show`
4. Clean and re-initialize: `cd terraform && rm -rf .terraform && terraform init`

---

## Examples

### Complete Setup Flow

```bash
# 1. Configure environment
./cli configure

# 2. Deploy infrastructure and demo components
./cli demo-setup

# 3. Install additional components
./cli o11y langfuse install
./cli vector-database qdrant install

# 4. Install examples
./cli mcp-server calculator install
./cli agno calculator-agent install

# 5. Configure models
./cli llm-model vllm add-models

# 6. Access services
kubectl get ingress --all-namespaces
```

### Selective Installation

```bash
# Infrastructure only
./cli terraform apply

# Core components
./cli ai-gateway litellm install
./cli llm-model vllm install
./cli gui-app openwebui install

# Configure models
./cli llm-model vllm configure-models

# Install specific examples
./cli openclaw doc-writer install
```

### Cleanup

```bash
# Remove specific components
./cli llm-model vllm uninstall
./cli ai-gateway litellm uninstall

# Complete cleanup
./cli cleanup-everything
```

---

## See Also

- [Configuration Guide](configuration.md)
- [FAQ](faq.md)
- [Demo Walkthrough](../getting-started/demo-walkthrough.md)
- [Infrastructure Setup](../getting-started/infrastructure.md)
