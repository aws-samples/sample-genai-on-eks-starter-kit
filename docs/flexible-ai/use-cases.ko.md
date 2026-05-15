---
title: Use Cases
---

[한국어](use-cases.ko.md){ .md-button .md-button--primary } [English](use-cases.md){ .md-button }

# Key Use Cases

GPU 기반 모델 서빙, AI Gateway, Observability 등 **공통 컴포넌트** 위에 use case별 컴포넌트를 조합하여 다양한 시나리오를 구현할 수 있습니다.

## 01. Self-hosted Model Serving on AWS

EKS 위에 self-hosted 모델 서빙 환경을 구축합니다.

- **AI Gateway**: LiteLLM · Kong
- **Inference Engines**: Ray · SGLang · vLLM
- **Observability**: Langfuse · MLflow
- **Vector DB**: Qdrant · Chroma · Milvus

HuggingFace 네이티브 연동으로 신규 모델에 빠르게 접근하며, **데이터 주권**과 시스템부터 AI 레벨까지의 **Enhanced Observability**를 확보합니다.

## 02. Hybrid Model Serving

Self-hosted, AWS-managed(Bedrock·Nova·SageMaker), 외부 모델(OpenAI·Gemini·Anthropic)을 단일 플랫폼에서 통합 운영합니다.

- AI Gateway가 **workload-optimized routing**을 수행 — 워크로드별 최적 모델로 코드 변경 없이 라우팅.
- **Centralized policy management**로 거버넌스 유지.

## 03. Agentic AI

AWS Native(Bedrock·Strands·AgentCore)로 시작해 EKS 기반 Self-hosted로 확장합니다.

- **Custom Agent workflow**: LangGraph · MCP / A2A.
- **도메인 특화 SLM**을 자유롭게 결합.
- **Heterogeneous Compute Allocation**: Graviton (planning), GPU (reasoning), Trainium / Inferentia (inference) — 비용 최적화.

레퍼런스 워크로드는 [Loan Buddy 에이전트](../examples/strands-agents/calculator-agent.md), [OpenClaw DevOps Agent](../examples/openclaw/devops-agent.md), [OpenClaw Document Writer](../examples/openclaw/doc-writer.md)에서 확인 가능합니다.

## 04. Hybrid Cluster

AWS Cloud와 On-prem을 **EKS Hybrid Node**로 연결하는 단일 클러스터.

- 규제·민감 워크로드는 온프레미스, 나머지는 AWS에서 처리.
- 장애 시 AWS로 자동 fallback.
- **온프렘 학습 + AWS 글로벌 추론** 시나리오도 재설계 없이 구현.

## 05. Cost Optimization with Trainium / Inferentia

AWS 자체 AI 칩으로 동급 EC2 대비 최대 **40-60% 비용 절감**과 업계 최고 수준의 OTPS 달성.

- PyTorch 네이티브 지원과 **Neuron Kernel Interface**를 통한 fine-grained 튜닝.
- **Neuron Explorer**를 통한 실행 흐름 추적.

# Key Benefits

<div class="grid cards" markdown>

-   :material-rocket-launch:{ .lg .middle } **Run Any Model Anywhere**

    ---

    - 통합 액세스 제어 (Unified access control)
    - 벤더 락인 제거
    - 데이터 레지던시 및 규제 준수
    - Self-hosted 모델, Amazon 관리형 서비스(Bedrock), 외부 LLM 호출까지 유연하게 이용
    - Self-service portal

-   :material-cash-multiple:{ .lg .middle } **Optimize Costs**

    ---

    - 모델 및 GPU 활용 최적화
    - 이기종 컴퓨팅(GPU / Trainium / Graviton)을 워크로드별로 적용·오케스트레이션
    - Amazon Bedrock에서 Self-hosted로의 매끄러운 마이그레이션 지원

-   :material-shield-check-outline:{ .lg .middle } **Protect Existing AI Investment**

    ---

    - 온프레미스 환경에 **Bolt-on** 방식으로 적용 가능
    - 재설계(Re-architecting) 없이 하이브리드 배포
    - 온프레미스·클라우드 GPU 통합 관리

-   :material-robot-outline:{ .lg .middle } **Agentic AI & Compute Modernization**

    ---

    - 자율 에이전트 운영을 위한 통합 환경
    - 인프라·에이전트 행동·아웃풋에 대한 **E2E Observability**
    - 워크플로우 코드 레벨 완전 제어

</div>

[:octicons-arrow-right-24: Get Started](get-started.ko.md){ .md-button .md-button--primary }
[:octicons-arrow-right-24: Architecture](architecture.ko.md){ .md-button }
