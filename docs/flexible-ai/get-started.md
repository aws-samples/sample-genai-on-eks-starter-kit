---
title: "Get Started with Flexible AI"
description: "Adoption paths for Flexible AI Platform — reference architecture deployment, starter kit setup, and AWS support engagement models."
hreflang_en: https://aws-samples.github.io/sample-genai-on-eks-starter-kit/flexible-ai/get-started/
hreflang_ko: https://aws-samples.github.io/sample-genai-on-eks-starter-kit/flexible-ai/get-started.ko/
---
[한국어](get-started.ko.md){ .md-button } [English](get-started.md){ .md-button .md-button--primary }

# Offerings

Whether you are building from scratch or hardening an existing environment, Flexible AI offers an architecture, support model, and starter kit for every stage.

<div class="grid cards" markdown>

-   :material-pillar:{ .lg .middle } **Baseline for Building Full-stack AI Platform**

    ---

    - Pre-validated **reference architectures** combining GPUs, OSS frameworks, and AWS services
    - Flexible, scalable design patterns covering many use cases and deployment options
    - **Self-service portal** for unified model and agent access

-   :material-handshake-outline:{ .lg .middle } **White-glove Support**

    ---

    - **AWS specialist guidance** across compute, Kubernetes, storage, and more
    - Best practices to maximize GPU value in production
    - Deployment support across AWS, on-premises, and edge

-   :material-shopping-outline:{ .lg .middle } **Open-source via AWS Marketplace**

    ---

    - OSS stacks pre-configured and optimized by experts
    - **1-click launch** AMIs — skip the integration code
    - Enterprise Edition with hardened security and governance, or BYOL options

-   :material-toolbox-outline:{ .lg .middle } **Production-ready Starter Kit**

    ---

    - GenAI infrastructure toolkit that accelerates enterprise AI deployment
    - AI Gateway, LLM serving, vector DB, embedding models, and E2E observability included
    - **Production-ready out of the box**

</div>

# Start now

The starter kit is ready to use directly from this repository. Three on-ramps:

## Path 1 — Read the docs

Skim before installing anything:

1. [Why Flexible AI](why.md) — value proposition and the five flexibility dimensions.
2. [Architecture](architecture.md) — building blocks and the layered stack.
3. [Components Overview](../components/index.md) — 25+ component catalog.
4. [Use Cases](use-cases.md) — five scenarios and benefits.

No cluster required.

## Path 2 — Run the demo

If you have an AWS account and the tools listed in [Prerequisites](../getting-started/prerequisites.md), start here:

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (writes .env.local)
./cli configure

# 3. Provision infra and deploy the curated stack in parallel
./cli demo-setup
```

Optional flags:

```bash
./cli --parallelism 6 demo-setup   # raise install concurrency
./cli --sequential   demo-setup    # legacy serial behavior
```

Tear it down with `./cli cleanup-everything`.

## Path 3 — Take the workshop

The Workshop Studio workshop under `workshops/eks-genai-workshop/` runs three modules:

1. **Module 1** — interacting with models (gateway + Open WebUI).
2. **Module 2** — adding GenAI components (vector DB, observability, guardrails).
3. **Module 3** — building and deploying an agentic application (Loan Buddy).

Delivery instructions live in [`workshops/eks-genai-workshop/README.md`](https://github.com/aws-samples/sample-genai-on-eks-starter-kit/blob/main/workshops/eks-genai-workshop/README.md).

# Customer Stories

!!! info "Coming soon"
    Stories from customers redefining their AI infrastructure strategy with the Flexible AI approach will land here shortly.

# Get in touch

If you'd like to discuss adoption, please reach out via:

- **GitHub Issues / Discussions** — [aws-samples/sample-genai-on-eks-starter-kit](https://github.com/aws-samples/sample-genai-on-eks-starter-kit/issues)
- For a direct meeting with the AWS Korea specialist team, please go through your AWS account team (SA / TAM).

Contributions and PRs are welcome — see the [Contributing Guide](https://github.com/aws-samples/sample-genai-on-eks-starter-kit/blob/main/CONTRIBUTING.md).
