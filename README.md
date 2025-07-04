# GenAI on EKS Starter Kit

A starter kit for deploying and managing GenAI components on Amazon EKS (Elastic Kubernetes Service). This project provides a collection of tools, configurations, and components to help you quickly set up a GenAI project on Kubernetes.

The starter kit includes the configurable components from several categories:

- AI Gateway - [LiteLLM](https://www.litellm.ai)
- LLM Model - [vLLM](https://docs.vllm.ai), [SGLang](https://docs.sglang.ai), [Ollama](https://ollama.com/)
- Embedding Model - [Text Embedding Inference (TEI)](https://huggingface.co/docs/text-embeddings-inference)
- Observability (o11y) - [Langfuse](https://langfuse.com), [Phoenix](https://phoenix.arize.com)
- GUI App - [Open WebUI](https://docs.openwebui.com/)
- Vector Database - [Milvus](https://milvus.io), [Qdrant](https://qdrant.tech)
- Workflow Automation - [n8n](https://docs.n8n.io)

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
- DOMAIN - Domain name (already configured with a Route 53 hosted zone)
- HF_TOKEN - Hugging Face [user access token](https://huggingface.co/docs/hub/en/security-tokens)

## Environment Setup

There are two methods to setup your environment:

### Method 1: Quick Demo Setup

To quickly set up a demo environment with infrastructure and essential components:

```bash
./cli demo-setup
```

This command will:

1. Set up the required infrastructure using Terraform
2. Deploy the demo components specified in the config.json file

These components will be deployed:

- LiteLLM for AI gateway
- vLLM for deploying and serving LLM models, with 2 models deployed:
  - [Qwen/Qwen3-30B-A3B-FP8](https://huggingface.co/Qwen/Qwen3-30B-A3B-FP8) - 8-bit quantization (BF16) on single g6e EC2 instance, fast model ~75 token/sec with tools and thinking support
  - [Qwen3-32B-FP8](https://huggingface.co/Qwen/Qwen3-32B-FP8) - 8-bit quantization (BF16) on single g6e EC2 instance, slow model ~15 token/sec with tools and thinking support
- Langfuse for observability
- Open WebUI fore GUI App
- Qdrant for vector database
- Text Embedding Inference (TEI) deploying and serving Embedding models, with 1 model deployed:
  - [Qwen3-Embedding-4B](https://huggingface.co/Qwen/Qwen3-Embedding-4B) - 16-bit quantization (BF16) on single r7i EC2 instance.

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

1. Present you with a list of available components organized by category
2. Allow you to select which components you want to install
3. Set up the required infrastructure using Terraform
4. Install all the selected components

## Install/Uninstall Components

You can install or uninstall individual components using the CLI:

### Install a Component

```bash
./cli <category> <component> install

# Examples:
# ./cli ai-gateway litellm install
# ./cli vector-database milvus install
# ./cli o11y phoenix install
```

### Uninstall a Component

```bash
./cli <category> <component> uninstall

# Examples:
# ./cli ai-gateway litellm uninstall
# ./cli vector-database milvus uninstall
# ./cli o11y phoenix uninstall
```

## LLM/Embedding Model - Model Management

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

This will prompt you to select which models should be deployed for the component.

## Cleanup

There are two methods to clean up your environment:

### Method 1: Uninstall Components Individually and Destroy Infrastructure

This method gives you more control over the cleanup process:

1. Uninstall each component:

```bash
# Examples:
# ./cli ai-gateway litellm uninstall
# ./cli llm-model vllm uninstall
# ... uninstall other components as needed
```

2. Destroy the infrastructure:

```bash
./cli cleanup-infra
```

### Method 2: Cleanup Everything at Once

This method provides a one-command solution to clean up all components and infrastructure:

```bash
./cli cleanup-everything
```

This command will:

1. Attempt to uninstall all deployed components
2. Destroy the infrastructure using Terraform

## FAQs

- **How can I change the EC2 GPU instance families and purchasing options?**

The default instance families are g6e, g6 and g5g and the default purchasing options are spot and on-demand. You can change the values on `terraform/0-common.tf` and then run `./cli terraform apply again`.

Note that the model deployment manifests use `nodeSelector` like `eks.amazonaws.com/instance-family: g6e` to lock the specific tested instance family which you will need to adjust accordingly.

- **How can I configure and update the LiteLLM proxy model list?**

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

For self-hosted models, they will be dynamically detected from the running model pods.

## Disclaimer

⚠️ **This repository is intended for demonstration and learning purposes only.**
It is **not** intended for production use. The code provided here is for educational purposes and should not be used in a live environment without proper testing, validation, and modifications.

Use at your own risk. The authors are not responsible for any issues, damages, or losses that may result from using this code in production.

## Contributing

Contributions welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) for more information.

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file.
