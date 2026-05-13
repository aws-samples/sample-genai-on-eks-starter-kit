---
title: Flex AI 개요
---

[한국어](index.ko.md){ .md-button .md-button--primary } [English](index.md){ .md-button }

# Architecting Flexible AI Platform on AWS

> **Run Any Model, Anywhere.** 유연성(Flexibility), 주권(Sovereignty), 그리고 세밀한 제어(Granular Control)를 갖춘 차세대 AI 플랫폼.

AI를 프로덕션에서 운영하는 기업들은 공통된 과제에 직면합니다.

- "새로운 모델이 매주 쏟아지는데, 기존 파이프라인에 적용하려면 매번 재작업이 필요하다"
- "사업부·팀마다 GPU를 따로 쓰고 모델을 개별 배포하다 보니, 전사 차원의 비용 가시성과 통합 관리가 불가능하다"
- "API 기반 모델 호출 비용이 통제 불가능한 속도로 증가하고 있다"
- "클라우드로 확장하고 싶지만, 그동안 투자해 온 온프레미스 GPU 자산도 함께 활용해야 한다"

**Flexible AI Platform on AWS**는 이러한 프로덕션 환경의 현실적 과제를 정면으로 해결하기 위해 설계된 통합 AI 플랫폼 솔루션입니다.

AWS의 **핵심 인프라 서비스**(Graviton, GPU/Trainium/Inferentia, EKS, S3 Vectors 등)와 **검증된 오픈소스 기술**(LangGraph, Mem0, LiteLLM, Langfuse, vLLM, Qwen 등)을 유기적으로 결합하여, 고객이 원하는 모델과 프레임워크를 자유롭게 선택하고, 데이터 파이프라인부터 모델 학습·서빙, 에이전틱 애플리케이션까지 아우르는 풀스택 AI 플랫폼을 단일 환경에서 일관되게 구축·운영할 수 있도록 사전 검증된 레퍼런스 아키텍처와 도입 가이던스를 제공합니다.

## 핵심 기술 스택

`LangGraph` · `LiteLLM` · `vLLM` · `Langfuse` · `Qwen` · `Mem0` · `EKS` · `Graviton` · `Inferentia/Trainium` · `S3 Vectors`

## Run Any Model, Anywhere

세 축의 결합이 Flex AI의 정체성입니다.

<div class="grid cards" markdown>

-   :material-cloud-outline:{ .lg .middle } **AWS Services**

    ---

    Graviton, GPU, Trainium/Inferentia, EKS, S3 Vectors 등 AWS의 검증된 인프라 서비스 위에서 동작합니다.

-   :material-source-branch:{ .lg .middle } **Open-source Frameworks & Models**

    ---

    LangGraph, LiteLLM, Langfuse, vLLM, Qwen 등 검증된 오픈소스 생태계와 자유롭게 조합합니다.

-   :material-server-network:{ .lg .middle } **Deployment Options**

    ---

    AWS Cloud, 온프레미스, Edge — 동일한 아키텍처 패턴으로 어디든 배포합니다.

</div>

## 어디로 갈까

<div class="grid cards" markdown>

-   :material-help-circle-outline:{ .lg .middle } **Why Flex AI**

    ---

    [:octicons-arrow-right-24: Value Proposition](why.ko.md)

-   :material-sitemap-outline:{ .lg .middle } **Architecture**

    ---

    [:octicons-arrow-right-24: 5가지 차원의 유연성과 빌딩 블록](architecture.ko.md)

-   :material-flask-outline:{ .lg .middle } **Use Cases**

    ---

    [:octicons-arrow-right-24: Key Use Cases & Benefits](use-cases.ko.md)

-   :material-play-circle-outline:{ .lg .middle } **Get Started**

    ---

    [:octicons-arrow-right-24: Offerings & Contact](get-started.ko.md)

</div>
