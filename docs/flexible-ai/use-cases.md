---
title: "Flexible AI Use Cases"
description: "Production use cases for Flexible AI — self-hosted LLM serving, agentic workflows, hybrid GPU inference, multi-region, and RAG pipelines on AWS."
hreflang_en: https://aws-samples.github.io/sample-genai-on-eks-starter-kit/flexible-ai/use-cases/
hreflang_ko: https://aws-samples.github.io/sample-genai-on-eks-starter-kit/flexible-ai/use-cases.ko/
---
[한국어](use-cases.ko.md){ .md-button } [English](use-cases.md){ .md-button .md-button--primary }

# Key Use Cases

GPU-backed model serving, AI gateway, and observability are **shared building blocks**. Compose them with use-case-specific components to fit a wide range of scenarios.

## 01. Self-hosted Model Serving on AWS

Stand up a self-hosted model serving environment on EKS.

- **AI Gateway**: LiteLLM, Kong.
- **Inference Engines**: Ray, SGLang, vLLM.
- **Observability**: Langfuse, MLflow.
- **Vector DB**: Qdrant, Chroma, Milvus.

Native HuggingFace integration keeps you close to the latest models. The result is **data sovereignty** plus **enhanced observability** spanning system metrics through to AI-level signals.

## 02. Hybrid Model Serving

Run self-hosted, AWS-managed (Bedrock, Nova, SageMaker), and external (OpenAI, Gemini, Anthropic) models on a single platform.

- The AI gateway performs **workload-optimized routing** — switch models per workload without code changes.
- **Centralized policy management** keeps governance consistent across providers.

## 03. Agentic AI

Start with AWS-native agent runtimes (Bedrock, Strands, AgentCore), then extend into self-hosted on EKS.

- **Custom agent workflows**: LangGraph, MCP / A2A.
- Combine with **domain-specific small language models**.
- **Heterogeneous compute allocation** — Graviton for planning, GPU for reasoning, Trainium / Inferentia for inference — to optimize cost.

Reference workloads: the [Loan Buddy agent](../examples/strands-agents/calculator-agent.md), [OpenClaw DevOps Agent](../examples/openclaw/devops-agent.md), and [OpenClaw Document Writer](../examples/openclaw/doc-writer.md).

## 04. Hybrid Cluster

Connect AWS Cloud and on-premises into a single cluster via **EKS Hybrid Node**.

- Regulated and sensitive workloads stay on-prem; the rest run on AWS.
- Automatic fallback to AWS during on-prem incidents.
- "Train on-prem, serve globally on AWS" works without re-architecting.

## 05. Cost Optimization with Trainium / Inferentia

AWS purpose-built AI silicon delivers up to **40-60% cost savings** versus comparable EC2 instances and industry-leading OTPS.

- Native PyTorch support and the **Neuron Kernel Interface** for fine-grained tuning.
- **Neuron Explorer** for execution-flow tracing.

# Key Benefits

<div class="grid cards" markdown>

-   :material-rocket-launch:{ .lg .middle } **Run Any Model Anywhere**

    ---

    - Unified access control
    - No vendor lock-in
    - Data residency and regulatory compliance
    - Self-hosted models, AWS-managed services (Bedrock), and external LLMs — all reachable
    - Self-service portal

-   :material-cash-multiple:{ .lg .middle } **Optimize Costs**

    ---

    - Optimize model and GPU utilization
    - Apply and orchestrate heterogeneous compute (GPU / Trainium / Graviton) per workload
    - Smooth migration path from Amazon Bedrock to self-hosted

-   :material-shield-check-outline:{ .lg .middle } **Protect Existing AI Investment**

    ---

    - **Bolt-on** to existing on-prem environments
    - Hybrid deployment without re-architecting
    - Unified management across on-prem and cloud GPUs

-   :material-robot-outline:{ .lg .middle } **Agentic AI & Compute Modernization**

    ---

    - One environment for autonomous agent operations
    - **End-to-end observability** across infrastructure, agent behavior, and outputs
    - Full code-level control over workflows

</div>

[:octicons-arrow-right-24: Get Started](get-started.md){ .md-button .md-button--primary }
[:octicons-arrow-right-24: Architecture](architecture.md){ .md-button }
