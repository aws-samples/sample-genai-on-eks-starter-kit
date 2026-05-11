# Quick Start

This guide will help you set up and deploy the GenAI on EKS Starter Kit.

## Initial Setup

### 1. Install Dependencies

Clone the repository and install Node.js dependencies:

```bash
npm install
```

### 2. Configure Environment

Run the configuration command to set up environment variables:

```bash
./cli configure
```

You'll be prompted to enter values for key environment variables:

```bash
✔ Enter value for REGION: us-west-2
✔ Enter value for EKS_CLUSTER_NAME: genai-on-eks
✔ Enter value for DOMAIN: 
```

The values are saved to `.env.local`.

#### Key Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `REGION` | AWS region for infrastructure | `us-west-2` |
| `EKS_CLUSTER_NAME` | Name of the EKS cluster | `genai-on-eks` |
| `EKS_MODE` | EKS mode: `auto` (default) or `standard` | `auto` |
| `DOMAIN` | Domain name with Route 53 hosted zone (optional) | `example.com` |
| `HF_TOKEN` | Hugging Face user access token | `hf_...` |

!!! tip "Configuration Hierarchy"
    Configuration files are loaded in order with later sources overriding earlier ones:
    
    `.env` → `config.json` → `.env.local` → `config.local.json`

## Environment Setup

Choose one of two setup methods:

=== "Method 1: Quick Demo Setup"

    Deploy a curated demo environment with essential components:

    ```bash
    ./cli demo-setup
    ```

    This command will:

    1. Provision AWS infrastructure using Terraform ([details](infrastructure.md))
    2. Deploy demo components and examples in the correct order:
        - LiteLLM (AI Gateway)
        - vLLM with Qwen3 models
        - Langfuse (Observability)
        - Open WebUI (GUI)
        - Qdrant (Vector Database)
        - TEI with Qwen3-Embedding model
        - Calculator MCP Server
        - Strands Calculator Agent

    See the [Demo Walkthrough](demo-walkthrough.md) for usage instructions.

=== "Method 2: Interactive Setup"

    Customize your setup by selecting specific components:

    ```bash
    ./cli interactive-setup
    ```

    You'll be presented with a menu to select components by category:

    ```bash
    ✔ Select AI Gateway components to install: litellm
    ✔ Select LLM Model components to install: vllm
    ? Select Embedding Model components to install: 
      ❯◉ Text Embedding Inference (TEI)
    ```

    This command will:

    1. Prompt you to select components and examples
    2. Provision infrastructure using Terraform
    3. Install all selected components

    !!! warning "Deployment Order"
        Unlike the demo setup, components may not be deployed in the required order. Some components may need to be reinstalled by running the CLI install command again.

## NVIDIA Dynamo Platform Setup

For optimized LLM inference with NVIDIA Dynamo on EKS:

### Installation Order

Install components sequentially:

```bash
# 1. Monitoring stack
./cli nvidia-platform monitoring install

# 2. GPU operator
./cli nvidia-platform gpu-operator install

# 3. Dynamo platform
./cli nvidia-platform dynamo-platform install

# 4. Deploy a model with vLLM
./cli nvidia-platform dynamo-vllm install
```

### Optional Components

Run benchmarks and auto-configuration:

```bash
# Concurrency sweep benchmarks
./cli nvidia-platform benchmark install

# TP/PP recommendations and SLA deployment
./cli nvidia-platform aiconfigurator install
```

For full details on platform prerequisites, deployment modes, KV cache routing, monitoring, and benchmarking, see the [NVIDIA Platform Overview](../components/nvidia-platform/index.md).

## Component Management

### Install a Component or Example

```bash
./cli <category> <component> install
```

**Examples:**

```bash
./cli ai-gateway litellm install
./cli llm-model vllm install
./cli strands-agents calculator-agent install
```

### Uninstall a Component or Example

```bash
./cli <category> <component> uninstall
```

**Examples:**

```bash
./cli ai-gateway litellm uninstall
./cli llm-model vllm uninstall
./cli strands-agents calculator-agent uninstall
```

## Model Management

Manage LLM and embedding models for hosting components:

### Configure Models

Set which models should be deployed:

```bash
./cli llm-model <component> configure-models
./cli embedding-model <component> configure-models
```

**Examples:**

```bash
./cli llm-model vllm configure-models
./cli embedding-model tei configure-models
```

### Update Models

Add and/or remove models:

```bash
./cli llm-model <component> update-models
./cli embedding-model <component> update-models
```

### Add Models

Add missing models only:

```bash
./cli llm-model <component> add-models
./cli embedding-model <component> add-models
```

### Remove All Models

Remove all models for a component:

```bash
./cli llm-model <component> remove-all-models
./cli embedding-model <component> remove-all-models
```

!!! tip "LiteLLM Model Updates"
    Run `./cli litellm install` again to update the LiteLLM proxy model list. Bedrock models are configured in `config.json`.

## Cleanup

Choose one of two cleanup methods:

=== "Method 1: Selective Cleanup"

    Uninstall components individually, then destroy infrastructure:

    ```bash
    # Uninstall each component
    ./cli strands-agents calculator-agent uninstall
    ./cli ai-gateway litellm uninstall
    # ... uninstall other components as needed

    # Destroy infrastructure
    ./cli cleanup-infra
    ```

    This method gives you precise control over the cleanup process.

=== "Method 2: Complete Cleanup"

    Remove everything in one command:

    ```bash
    ./cli cleanup-everything
    ```

    This command will:

    1. Uninstall all deployed examples and components
    2. Destroy infrastructure using Terraform

    !!! danger "Destructive Operation"
        This command removes all resources. Ensure you've backed up any data you need before running.

## Verification

After setup, verify your deployment:

```bash
# Check cluster connectivity
kubectl cluster-info

# List all pods
kubectl get pods --all-namespaces

# Check services
kubectl get svc --all-namespaces

# Check ingress endpoints
kubectl get ingress --all-namespaces
```

## Next Steps

- Review [Infrastructure Setup](infrastructure.md) for details on provisioned resources
- Follow the [Demo Walkthrough](demo-walkthrough.md) to explore features
- Check the [FAQs](../reference/faq.md) for common questions and troubleshooting
