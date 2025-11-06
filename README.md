# GenAI on EKS Starter Kit

A starter kit for deploying and managing GenAI components and examples on Amazon EKS (Elastic Kubernetes Service). This project provides a collection of tools, configurations, components and examples to help you quickly set up a GenAI project on Kubernetes.

The starter kit includes the configurable components and examples from several categories:

- AI Gateway - [LiteLLM](https://www.litellm.ai), [Kong AI Gateway OSS](https://github.com/Kong/kong)
- LLM Model - [vLLM](https://docs.vllm.ai), [SGLang](https://docs.sglang.ai), [Ollama](https://ollama.com)
- Embedding Model - [Text Embedding Inference (TEI)](https://huggingface.co/docs/text-embeddings-inference)
- Observability (o11y) - [Langfuse](https://langfuse.com), [Phoenix](https://phoenix.arize.com)
- GUI App - [Open WebUI](https://docs.openwebui.com)
- Vector Database - [Qdrant](https://qdrant.tech), [Chroma](https://docs.trychroma.com), [Milvus](https://milvus.io)
- Workflow Automation - [n8n](https://docs.n8n.io)
- MCP Server - [FastMCP 2.0](https://gofastmcp.com)
- AI Agent Framework - [Strands Agents ](https://strandsagents.com), [Agno](https://docs.agno.com)

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

This command will:

1. Set up the required infrastructure using Terraform (check [Infrastructure Setup](docs/INFRA_SETUP.md) for more information)
2. Deploy the demo components and examples specified in the config.json file in the right order

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

With a domain name already configured with a Route 53 hosted zone, a single shared ALB with HTTPS is used together with a wildcard ACM cert and Route 53 DNS records to expose all public facing services e.g. litellm.<DOMAIN> and openwebui.<DOMAIN>.

Alternatively, when the `DOMAIN` filed on `.env` (or `.env.local`) is empty, mulitple ALBs with HTTP will be created for each public facing service. In this case, only one service requiring the Nginx Ingress basic auth (e.g. Milvus and Qdrant) can be exposed.

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

## Disclaimer

⚠️ **This repository is intended for demonstration and learning purposes only.**
It is **not** intended for production use. The code provided here is for educational purposes and should not be used in a live environment without proper testing, validation, and modifications.

Use at your own risk. The authors are not responsible for any issues, damages, or losses that may result from using this code in production.

Check [Security Considerations](docs/SECURITY.md) for more information on the security scans.

## Contributing

Contributions welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) for more information.

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file.
