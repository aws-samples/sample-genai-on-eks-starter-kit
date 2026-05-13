---
title: Architecture
---

[한국어](architecture.ko.md){ .md-button } [English](architecture.md){ .md-button .md-button--primary }

# Functional View & Building Blocks

Flexible AI spans every layer from the application surface down to cloud, on-premises, and edge infrastructure. Adopt the components you need today and grow into the rest, or stand up the integrated platform in one pass.

## Layered stack

```mermaid
flowchart TB
    subgraph U["Users & Clients"]
        UI["Open WebUI / Self-service portal"]
        APP["Custom apps & agents"]
        WF["Workflow automation (n8n)"]
    end

    subgraph G["Gateway & Guardrails"]
        GW["AI Gateway<br/>(LiteLLM / Kong)"]
        GR["Guardrails AI"]
    end

    subgraph A["Agentic Layer"]
        AG["Agents<br/>(LangGraph / Strands / Agno / OpenClaw)"]
        MCP["MCP Servers (A2A)"]
        VDB["Vector DB / S3 Vectors<br/>(Qdrant / Chroma / Milvus)"]
        MEM["Memory (Mem0)"]
    end

    subgraph M["Model Serving"]
        LLM["Self-hosted LLM<br/>(vLLM / SGLang / Ollama / Ray)"]
        EMB["Embedding (TEI)"]
        DYN["NVIDIA Dynamo Platform"]
        BR["Amazon Bedrock / Nova / SageMaker"]
        EXT["External LLM<br/>(OpenAI / Gemini / Anthropic)"]
    end

    subgraph O["Observability"]
        LF["Langfuse"]
        PHX["Phoenix"]
        ML["MLflow"]
    end

    subgraph I["Compute & Infrastructure"]
        EKS["Amazon EKS / EKS Hybrid Node"]
        GPU["GPU"]
        TRN["Trainium / Inferentia"]
        GRV["Graviton"]
        ALB["ALB + ACM"]
        S3V["S3 Vectors / EFS"]
        IAM["IRSA + Secrets Manager"]
    end

    UI --> GW
    APP --> GW
    WF --> GW
    GW --> GR
    GR --> LLM
    GR --> BR
    GR --> EXT
    GW --> AG
    AG --> MCP
    AG --> VDB
    AG --> MEM
    AG --> LLM
    LLM --> DYN
    GW --> LF
    AG --> LF
    LLM --> PHX
    AG --> ML

    EKS --- GPU
    EKS --- TRN
    EKS --- GRV
    EKS --- ALB
    EKS --- S3V
    EKS --- IAM
```

## Building blocks

### Application layer

- **Self-service portal** — single UI for unified access to models and agents.
- **Open WebUI / custom apps / n8n** — users and workflows enter through the same gateway.

### Gateway & Guardrails

- [LiteLLM](../components/ai-gateway/litellm.md) — OpenAI-compatible proxy with multi-provider routing.
- [Kong AI Gateway OSS](../components/ai-gateway/kong.md) — Kong with AI plugins.
- [Guardrails AI](../components/guardrail/guardrails-ai.md) — policy enforcement and safety guards.

### Agentic layer

- **LangGraph / Strands / Agno / OpenClaw** — agent workflow frameworks, fully controllable at the code level.
- **MCP servers** — expose tools as services over Model Context Protocol ([Calculator MCP](../examples/mcp-server/calculator.md)).
- **Vector DB / S3 Vectors / Memory (Mem0)** — RAG and long-term memory.

### Model serving

- Self-hosted: [vLLM](../components/llm-model/vllm.md), [SGLang](../components/llm-model/sglang.md), [TGI](../components/llm-model/tgi.md), [Ollama](../components/llm-model/ollama.md), [TEI](../components/embedding-model/tei.md).
- AWS-managed: Amazon Bedrock, Nova, SageMaker.
- External LLMs: OpenAI, Gemini, Anthropic — same gateway entry point.
- Acceleration path: [NVIDIA Dynamo Platform](../components/nvidia-platform/index.md) (KV-cache routing, AIPerf, AIConfigurator).

### Observability

- [Langfuse](../components/observability/langfuse.md) — LLM and agent tracing with session / tag attribution.
- [Phoenix](../components/observability/phoenix.md) — evaluation and monitoring.
- [MLflow](../components/observability/mlflow.md) — experiment tracking.

### Compute & infrastructure

- **Amazon EKS / EKS Hybrid Node** — unify AWS Cloud and on-premises in one cluster.
- **Heterogeneous compute** — mix GPU / Trainium / Inferentia / Graviton per workload.
- **ALB + ACM, S3 Vectors / EFS, IRSA + Secrets Manager** — production-grade defaults.

## Configuration model

Every component reads configuration from this merge order:

```
.env -> config.json -> .env.local -> config.local.json
```

CLI subcommands consume the merged result, render Handlebars manifests into `*.rendered.yaml`, and apply them. The same pattern repeats across every category, so once you've read one component the rest are familiar.

See [Configuration](../reference/configuration.md) for the full schema.

## Deployment shapes

- **Demo setup** — `./cli demo-setup` deploys the curated stack in parallel with explicit dependency ordering (e.g. `openwebui` waits for `litellm`). See [Quick Start](../getting-started/quick-start.md).
- **Interactive setup** — `./cli interactive-setup` lets you pick components per category. Both produce the same cluster shape.

[:octicons-arrow-right-24: Use Cases](use-cases.md){ .md-button .md-button--primary }
[:octicons-arrow-right-24: Get Started](get-started.md){ .md-button }
