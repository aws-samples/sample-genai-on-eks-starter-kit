# Components Overview

The GenAI on EKS Starter Kit provides a curated collection of production-ready components for building and deploying GenAI applications on Kubernetes. All components are installed via the CLI: `./cli <category> <component> install`.

## Component Categories

| Category | Description | Components |
|----------|-------------|------------|
| **NVIDIA Platform** | NVIDIA Dynamo LLM serving platform with GPU acceleration, monitoring, and benchmarking | GPU Operator, Monitoring, Dynamo Platform, Dynamo vLLM, AIPerf Benchmark, AIConfigurator |
| **AI Gateway** | API gateways and proxies for LLM routing, load balancing, and rate limiting | LiteLLM, Kong |
| **LLM Model** | Large Language Model serving engines | vLLM, SGLang, TGI, Ollama |
| **Embedding Model** | Text embedding generation services | TEI (Text Embeddings Inference) |
| **Guardrail** | Content safety and policy enforcement | Guardrails AI |
| **Observability** | Monitoring, tracing, and analytics for GenAI applications | Langfuse, MLflow, Phoenix |
| **GUI Application** | User interfaces for interacting with LLMs | Open WebUI |
| **Vector Database** | High-performance vector storage for RAG applications | Qdrant, Chroma, Milvus |
| **Workflow Automation** | Visual workflow builders and automation platforms | n8n |
| **AI Agent** | Agent orchestration and task routing systems | OpenClaw |

## Quick Start

```bash
# Install a component
./cli <category> <component> install

# Example: Install vLLM
./cli llm-model vllm install

# Uninstall a component
./cli <category> <component> uninstall
```

## Component Index

### NVIDIA Platform
- [Overview](nvidia-platform/index.md) - NVIDIA Dynamo Platform architecture and installation guide
- [GPU Operator](nvidia-platform/gpu-operator.md) - NVIDIA GPU resource management
- [Monitoring](nvidia-platform/monitoring.md) - Prometheus + Grafana with Dynamo dashboards
- [Dynamo Platform](nvidia-platform/dynamo-platform.md) - CRDs, Operator, etcd, NATS
- [Dynamo vLLM](nvidia-platform/dynamo-vllm.md) - Aggregated/disaggregated vLLM serving
- [AIPerf Benchmark](nvidia-platform/benchmark.md) - Comprehensive LLM benchmarking suite
- [AIConfigurator](nvidia-platform/aiconfigurator.md) - Auto TP/PP recommendation and SLA-driven deployment

### AI Gateway
- [LiteLLM](ai-gateway/litellm.md) - Universal LLM gateway with unified API
- [Kong](ai-gateway/kong.md) - API gateway with rate limiting and authentication

### LLM Model
- [vLLM](llm-model/vllm.md) - High-throughput LLM serving with PagedAttention
- [SGLang](llm-model/sglang.md) - Efficient LLM serving with RadixAttention
- [TGI](llm-model/tgi.md) - HuggingFace Text Generation Inference
- [Ollama](llm-model/ollama.md) - Local LLM serving made simple

### Embedding Model
- [TEI](embedding-model/tei.md) - Text Embeddings Inference for vector generation

### Guardrail
- [Guardrails AI](guardrail/guardrails-ai.md) - LLM output validation and content safety

### Observability
- [Langfuse](observability/langfuse.md) - LLM observability and analytics
- [MLflow](observability/mlflow.md) - ML experiment tracking and model registry
- [Phoenix](observability/phoenix.md) - LLM observability and tracing

### GUI Application
- [Open WebUI](gui-app/openwebui.md) - ChatGPT-style web interface for LLMs

### Vector Database
- [Qdrant](vector-database/qdrant.md) - High-performance vector search engine
- [Chroma](vector-database/chroma.md) - Open-source embedding database
- [Milvus](vector-database/milvus.md) - Cloud-native vector database

### Workflow Automation
- [n8n](workflow-automation/n8n.md) - Visual workflow automation platform

### AI Agent
- [OpenClaw](ai-agent/openclaw.md) - AI agent orchestration bridge server

## Configuration

Components are configured via:

1. **config.json** - Component-specific settings
2. **.env** - Environment variables and credentials
3. **config.local.json** - Local overrides (gitignored)
4. **.env.local** - Local environment overrides (gitignored)

Configuration hierarchy (later sources override earlier ones):
```
.env -> config.json -> .env.local -> config.local.json
```

## Architecture Patterns

### Typical GenAI Stack

```
┌─────────────────────────────────────────────────────────────┐
│                     Open WebUI (Frontend)                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              LiteLLM (AI Gateway + Router)                   │
└──┬────────────────┬────────────────┬────────────────────┬───┘
   │                │                │                    │
   ▼                ▼                ▼                    ▼
┌─────────┐   ┌─────────┐   ┌─────────────┐   ┌──────────────┐
│  vLLM   │   │ SGLang  │   │ AWS Bedrock │   │ Guardrails AI│
└─────────┘   └─────────┘   └─────────────┘   └──────────────┘
   │                │
   ▼                ▼
┌──────────────────────────────┐
│    Langfuse (Observability)  │
└──────────────────────────────┘
```

### RAG Application Stack

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                    LiteLLM Gateway                           │
└──┬────────────────────────────────────────────────────┬─────┘
   │                                                     │
   ▼                                                     ▼
┌─────────────────┐                           ┌──────────────────┐
│ LLM (vLLM/SGLang)│                          │  TEI (Embedding) │
└─────────────────┘                           └────────┬─────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────┐
                                              │ Vector DB (Qdrant)│
                                              └──────────────────┘
```

## Learn More

- [Getting Started Guide](../getting-started/quick-start.md)
- [Security Best Practices](../reference/security.md)
