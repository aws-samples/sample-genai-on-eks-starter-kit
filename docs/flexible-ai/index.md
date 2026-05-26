---
title: "Flexible AI Overview"
description: "Flexible AI Platform on AWS — run any model anywhere with full sovereignty, enterprise governance, and granular cost control on Amazon EKS."
hreflang_en: https://aws-samples.github.io/sample-genai-on-eks-starter-kit/flexible-ai/
hreflang_ko: https://aws-samples.github.io/sample-genai-on-eks-starter-kit/flexible-ai/index.ko/
---
[한국어](index.ko.md){ .md-button } [English](index.md){ .md-button .md-button--primary }

# Architecting Flexible AI Platform on AWS

> **Run Any Model, Anywhere.** A next-generation AI platform built on **flexibility**, **sovereignty**, and **granular control**.

Teams running AI in production keep hitting the same wall:

- "New models drop every week, but plugging them into our existing pipeline is rework every time."
- "Each business unit runs its own GPUs and deploys models in isolation, so we have no enterprise-wide cost visibility or governance."
- "API-based model spend is growing faster than we can control."
- "We want to scale into the cloud, but we also need to keep getting value out of the on-prem GPUs we already paid for."

**Flexible AI Platform on AWS** — Flexible AI for short — is the integrated answer to those production realities.

It composes AWS's **core infrastructure** (Graviton, GPU, Trainium / Inferentia, EKS, S3 Vectors) with **proven open-source components** (LangGraph, Mem0, LiteLLM, Langfuse, vLLM, Qwen, …) so customers can pick the models and frameworks they want and run a full-stack AI platform — data pipelines, training, serving, agentic applications — coherently in one environment, on top of pre-validated reference architectures and adoption guidance.

## Core stack

`LangGraph` · `LiteLLM` · `vLLM` · `Langfuse` · `Qwen` · `Mem0` · `EKS` · `Graviton` · `Inferentia/Trainium` · `S3 Vectors`

## Run Any Model, Anywhere

Three axes meet in Flexible AI:

<div class="grid cards" markdown>

-   :material-cloud-outline:{ .lg .middle } **AWS Services**

    ---

    Graviton, GPU, Trainium / Inferentia, EKS, S3 Vectors — the AWS infrastructure surface Flexible AI runs on.

-   :material-source-branch:{ .lg .middle } **Open-source Frameworks & Models**

    ---

    LangGraph, LiteLLM, Langfuse, vLLM, Qwen, and the rest of the OSS ecosystem — composable, swap-friendly, no vendor control plane.

-   :material-server-network:{ .lg .middle } **Deployment Options**

    ---

    AWS Cloud, on-premises, edge — same architecture pattern, deploy anywhere.

</div>

## Where to next

<div class="grid cards" markdown>

-   :material-help-circle-outline:{ .lg .middle } **Why Flexible AI**

    ---

    [:octicons-arrow-right-24: Value Proposition](why.md)

-   :material-sitemap-outline:{ .lg .middle } **Architecture**

    ---

    [:octicons-arrow-right-24: Five dimensions of flexibility & building blocks](architecture.md)

-   :material-flask-outline:{ .lg .middle } **Use Cases**

    ---

    [:octicons-arrow-right-24: Key use cases & benefits](use-cases.md)

-   :material-play-circle-outline:{ .lg .middle } **Get Started**

    ---

    [:octicons-arrow-right-24: Offerings & contact](get-started.md)

</div>
