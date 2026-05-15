---
title: Get Started
---

[한국어](get-started.ko.md){ .md-button .md-button--primary } [English](get-started.md){ .md-button }

# Offerings

아키텍처를 처음부터 구축하는 환경부터, 이미 갖추고 있지만 고도화를 원하는 환경까지 — 모든 단계에 맞춘 아키텍처와 지원 체계, 스타터 킷을 제공합니다.

<div class="grid cards" markdown>

-   :material-pillar:{ .lg .middle } **Baseline for Building Full-stack AI Platform**

    ---

    - GPU + 오픈소스 프레임워크 + AWS 서비스 조합 사전 검증된 **레퍼런스 아키텍처**
    - 다양한 use case와 배포 옵션을 위한 유연·확장 가능 디자인 패턴
    - 모델·에이전트에 대한 **통합 액세스 셀프 서비스 포털**

-   :material-handshake-outline:{ .lg .middle } **White-glove Support**

    ---

    - **AWS Specialist 기술 가이던스**: Compute, Kubernetes, Storage 등 전 영역
    - 프로덕션 환경에서 GPU 가치 극대화 위한 베스트 프랙티스
    - AWS, 온프레미스, 엣지 전반의 배포 지원

-   :material-shopping-outline:{ .lg .middle } **Open-source via AWS Marketplace**

    ---

    - OSS 전문가가 사전 구성·최적화한 스택
    - **1-Click Launch**로 AMI 즉시 배포 (이종 소스 통합 코드 작성 스킵)
    - 보안·거버넌스 강화 Enterprise Edition 또는 BYOL 옵션

-   :material-toolbox-outline:{ .lg .middle } **Production-ready Starter Kit**

    ---

    - 엔터프라이즈 AI 배포를 가속하는 **GenAI 인프라 툴킷**
    - AI Gateway, LLM Serving, Vector DB, Embedding Models, E2E Observability 포함
    - **박스 오픈 즉시** 프로덕션 환경에 적용 가능

</div>

# 즉시 시작하기

스타터 킷은 이 리포지토리에서 바로 사용할 수 있습니다. 세 가지 진입점을 제공합니다.

## Path 1 — 문서 읽기

먼저 톤과 범위를 확인하고 싶다면:

1. [Why Flexible AI](why.ko.md) — 가치 제안과 5가지 유연성.
2. [Architecture](architecture.ko.md) — 빌딩 블록과 계층 구조.
3. [Components Overview](../components/index.md) — 25+ 컴포넌트 카탈로그.
4. [Use Cases](use-cases.ko.md) — 5가지 시나리오와 베네핏.

클러스터 없이 가능합니다.

## Path 2 — 데모 실행

AWS 계정과 [Prerequisites](../getting-started/prerequisites.md)에 명시된 도구가 준비되어 있으면 바로 시작할 수 있습니다.

```bash
# 1. 의존성 설치
npm install

# 2. 환경 구성 (.env.local 생성)
./cli configure

# 3. 인프라 + 큐레이션 스택 병렬 배포
./cli demo-setup
```

옵션 플래그:

```bash
./cli --parallelism 6 demo-setup   # 병렬 설치 동시성 상향
./cli --sequential   demo-setup    # 레거시 순차 동작
```

정리는 `./cli cleanup-everything`.

## Path 3 — 워크샵

`workshops/eks-genai-workshop/` 의 **Workshop Studio 워크샵**은 세 모듈로 구성됩니다.

1. **Module 1** — 모델과 상호작용 (게이트웨이 + Open WebUI).
2. **Module 2** — GenAI 컴포넌트 추가 (Vector DB, Observability, Guardrails).
3. **Module 3** — 에이전틱 애플리케이션 구축 (Loan Buddy).

자세한 진행 가이드는 [`workshops/eks-genai-workshop/README.md`](https://github.com/aws-samples/sample-genai-on-eks-starter-kit/blob/main/workshops/eks-genai-workshop/README.md).

# Customer Stories

!!! info "곧 공개 예정"
    Flexible AI 접근법을 통해 AI 인프라 전략을 재정의하고 있는 고객들의 이야기를 곧 만나보실 수 있습니다.

# 문의하기

솔루션 도입에 관심이 있으신 분들은 아래 채널로 연락 부탁드립니다.

- **GitHub Issues / Discussions** — [aws-samples/sample-genai-on-eks-starter-kit](https://github.com/aws-samples/sample-genai-on-eks-starter-kit/issues)
- **AWS Korea Specialist 팀**과의 직접 미팅이 필요하다면, 담당 AWS 어카운트 매니저(SA / TAM)를 통해 문의해 주세요.

기여나 PR도 환영합니다 — [Contributing Guide](https://github.com/aws-samples/sample-genai-on-eks-starter-kit/blob/main/CONTRIBUTING.md).
