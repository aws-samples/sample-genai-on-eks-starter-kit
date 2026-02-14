# Fork Repository Workflow Guide

이 문서는 포크된 리포지토리에서 작업하고 오리진 리포지토리에 PR을 제출하는 워크플로우를 설명합니다.

## Repository Structure

- **Origin (Upstream)**: `aws-samples/sample-genai-on-eks-starter-kit` - 원본 리포지토리
- **Fork**: `devfloor9/sample-genai-on-eks-starter-kit` - 포크된 작업 리포지토리

## Initial Setup

리포지토리를 처음 클론할 때:

```bash
# 포크된 리포지토리 클론
git clone git@github.com:devfloor9/sample-genai-on-eks-starter-kit.git
cd sample-genai-on-eks-starter-kit

# 오리진 리포지토리를 upstream으로 추가
git remote add upstream git@github.com:aws-samples/sample-genai-on-eks-starter-kit.git

# 리모트 확인
git remote -v
```

## Development Workflow

### 1. 새로운 기능 개발 시작

```bash
# upstream의 최신 변경사항 가져오기
git fetch upstream
git checkout main
git merge upstream/main

# 새로운 feature 브랜치 생성
git checkout -b feature/your-feature-name

# origin(포크)에 브랜치 푸시
git push -u origin feature/your-feature-name
```

### 2. 개발 및 커밋

```bash
# 변경사항 작업
# ... 코드 수정 ...

# 변경사항 스테이징 및 커밋
git add .
git commit -m "feat: add new feature description"

# 포크 리포지토리에 푸시
git push origin feature/your-feature-name
```

### 3. 테스트

포크 리포지토리에서 충분히 테스트를 진행합니다:

```bash
# 컴포넌트 설치 테스트
./cli <category> <component> install

# 기능 검증
# ... 테스트 수행 ...

# 컴포넌트 제거 테스트
./cli <category> <component> uninstall
```

### 4. Pull Request 생성

테스트가 완료되고 변경사항이 정상적으로 작동하면:

1. GitHub에서 포크 리포지토리 (`devfloor9/sample-genai-on-eks-starter-kit`)로 이동
2. "Compare & pull request" 버튼 클릭
3. Base repository를 `aws-samples/sample-genai-on-eks-starter-kit`의 `main` 브랜치로 설정
4. Head repository를 `devfloor9/sample-genai-on-eks-starter-kit`의 feature 브랜치로 설정
5. PR 제목과 설명 작성 (PR_DESCRIPTION.md 템플릿 참고)
6. "Create pull request" 클릭

## Keeping Fork Updated

정기적으로 upstream의 변경사항을 포크에 동기화:

```bash
# upstream의 최신 변경사항 가져오기
git fetch upstream

# main 브랜치로 전환
git checkout main

# upstream/main의 변경사항 병합
git merge upstream/main

# 포크 리포지토리에 푸시
git push origin main
```

## Feature Branch 업데이트

작업 중인 feature 브랜치에 upstream의 최신 변경사항 반영:

```bash
# feature 브랜치로 전환
git checkout feature/your-feature-name

# upstream/main의 변경사항 rebase
git fetch upstream
git rebase upstream/main

# 충돌 해결 (필요한 경우)
# ... 충돌 해결 ...
git add .
git rebase --continue

# 포크 리포지토리에 force push (rebase 후)
git push origin feature/your-feature-name --force-with-lease
```

## Commit Message Convention

명확하고 일관된 커밋 메시지 작성:

```
<type>: <subject>

<body>

<footer>
```

### Types:
- `feat`: 새로운 기능 추가
- `fix`: 버그 수정
- `docs`: 문서 변경
- `style`: 코드 포맷팅, 세미콜론 누락 등
- `refactor`: 코드 리팩토링
- `test`: 테스트 코드 추가/수정
- `chore`: 빌드 프로세스, 도구 설정 등

### Examples:

```bash
git commit -m "feat: add OpenClaw component for AI agent deployment"

git commit -m "fix: resolve ingress configuration issue in Qdrant component"

git commit -m "docs: update OPENCLAW_DEPLOYMENT.md with troubleshooting section"
```

## Branch Naming Convention

- `feature/`: 새로운 기능 개발
- `fix/`: 버그 수정
- `docs/`: 문서 업데이트
- `refactor/`: 코드 리팩토링
- `test/`: 테스트 추가/수정

Examples:
- `feature/openclaw-component-and-examples`
- `fix/litellm-ingress-auth`
- `docs/update-deployment-guide`

## PR Review Process

1. PR 생성 후 자동 CI/CD 체크 확인
2. 리뷰어의 피드백 대응
3. 필요한 경우 추가 커밋으로 수정사항 반영
4. 승인 후 upstream maintainer가 merge

## Troubleshooting

### 포크가 upstream보다 뒤처진 경우

```bash
git fetch upstream
git checkout main
git reset --hard upstream/main
git push origin main --force
```

### Feature 브랜치가 main과 충돌하는 경우

```bash
git checkout feature/your-feature-name
git fetch upstream
git rebase upstream/main
# 충돌 해결
git push origin feature/your-feature-name --force-with-lease
```

## Best Practices

1. **작은 단위로 커밋**: 각 커밋은 하나의 논리적 변경사항만 포함
2. **자주 푸시**: 작업 내용을 정기적으로 포크 리포지토리에 푸시
3. **테스트 필수**: PR 생성 전 충분한 테스트 수행
4. **문서 업데이트**: 코드 변경 시 관련 문서도 함께 업데이트
5. **upstream 동기화**: 정기적으로 upstream의 변경사항을 포크에 반영

## References

- [GitHub Fork Documentation](https://docs.github.com/en/get-started/quickstart/fork-a-repo)
- [GitHub Pull Request Documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request-from-a-fork)
- [Git Rebase Documentation](https://git-scm.com/docs/git-rebase)
