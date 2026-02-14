# OpenClaw PR Workflow Guide

## Git Repository Structure

```
origin (devfloor9/sample-genai-on-eks-starter-kit)
  ↓ Fork
upstream (aws-samples/sample-genai-on-eks-starter-kit)
```

## Current Status

✅ Feature branch pushed to fork: `feature/openclaw-component-and-examples`

## Workflow Steps

### 1. Test in Fork Repository

현재 브랜치가 포크된 리포지토리(devfloor9)에 푸시되었습니다. 이제 다음 단계를 진행하세요:

```bash
# 현재 상태 확인
git status
git remote -v

# 브랜치 확인
git branch -vv
```

### 2. Deploy and Test

EKS 클러스터에서 실제 배포 테스트를 수행하세요:

```bash
# Prerequisites 설치
./cli ai-gateway litellm install
./cli gui-app openwebui install
./cli observability langfuse install  # Optional

# OpenClaw 컴포넌트 설치
./cli ai-agent openclaw install

# 예제 에이전트 설치
./cli examples openclaw doc-writer install
./cli examples openclaw devops-agent install

# 상태 확인
kubectl get pods -n openclaw
kubectl get svc -n openclaw
kubectl logs -n openclaw -l app=openclaw

# Open WebUI에서 테스트
# 1. Open WebUI에 접속
# 2. Pipe functions 메뉴에서 doc-writer, devops-agent 확인
# 3. 채팅으로 테스트 수행
```

### 3. Fix Issues (if any)

테스트 중 문제가 발견되면 수정하세요:

```bash
# 파일 수정 후
git add .
git commit -m "fix: [issue description]"
git push origin feature/openclaw-component-and-examples
```

### 4. Create PR to Upstream

테스트가 완료되고 모든 것이 정상 작동하면, upstream(aws-samples)으로 PR을 생성하세요:

#### Option A: GitHub Web UI (권장)

1. https://github.com/devfloor9/sample-genai-on-eks-starter-kit 방문
2. "Compare & pull request" 버튼 클릭
3. Base repository를 `aws-samples/sample-genai-on-eks-starter-kit` (main)으로 설정
4. Head repository를 `devfloor9/sample-genai-on-eks-starter-kit` (feature/openclaw-component-and-examples)로 설정
5. `PR_DESCRIPTION.md` 내용을 복사하여 PR 설명에 붙여넣기
6. 테스트 결과 추가:
   - 스크린샷
   - 로그 출력
   - 성공/실패 여부
7. "Create pull request" 클릭

#### Option B: GitHub CLI

```bash
# GitHub CLI 설치 확인
gh --version

# PR 생성 (upstream으로)
gh pr create \
  --repo aws-samples/sample-genai-on-eks-starter-kit \
  --base main \
  --head devfloor9:feature/openclaw-component-and-examples \
  --title "feat: Add OpenClaw AI Agent Orchestrator component and examples" \
  --body-file PR_DESCRIPTION.md
```

### 5. Update PR with Test Results

PR 생성 후, 테스트 결과를 업데이트하세요:

```markdown
## Testing Results

### Environment
- EKS Cluster: [cluster-name]
- Region: ap-northeast-2
- Kubernetes Version: [version]

### Component Installation
- [x] OpenClaw component installed successfully
- [x] Doc-writer example deployed
- [x] DevOps agent deployed

### Functionality Tests
- [x] Open WebUI integration working
- [x] Doc-writer can clone/commit/push to Git
- [x] DevOps agent can query cluster resources
- [x] Langfuse traces visible
- [x] KEDA autoscaling working

### Screenshots
[Add screenshots here]

### Logs
```
[Add relevant logs]
```
```

## Useful Commands

### Sync Fork with Upstream

```bash
# Fetch upstream changes
git fetch upstream

# Merge upstream/main into your main
git checkout main
git merge upstream/main

# Push to your fork
git push origin main
```

### Update Feature Branch with Latest Main

```bash
# On feature branch
git fetch upstream
git rebase upstream/main

# Force push (if needed)
git push origin feature/openclaw-component-and-examples --force-with-lease
```

### Clean Up After PR Merge

```bash
# Delete local branch
git checkout main
git branch -D feature/openclaw-component-and-examples

# Delete remote branch
git push origin --delete feature/openclaw-component-and-examples
```

## PR Review Process

1. **Automated Checks**: GitHub Actions will run (if configured)
2. **Code Review**: Maintainers will review the code
3. **Testing**: Maintainers may test in their environment
4. **Feedback**: Address any requested changes
5. **Approval**: Once approved, maintainers will merge

## Addressing Review Comments

```bash
# Make requested changes
# ... edit files ...

# Commit changes
git add .
git commit -m "fix: address review comments - [description]"

# Push to update PR
git push origin feature/openclaw-component-and-examples
```

## Important Notes

- ✅ All commits are in `devfloor9/sample-genai-on-eks-starter-kit`
- ✅ PR will be from fork to `aws-samples/sample-genai-on-eks-starter-kit`
- ✅ Test thoroughly before creating PR to upstream
- ✅ Include test results and screenshots in PR
- ✅ Reference Issue #84 in PR description

## Next Steps

1. ✅ Code committed to fork
2. ⏳ Deploy and test in EKS cluster
3. ⏳ Document test results
4. ⏳ Create PR to upstream
5. ⏳ Address review comments
6. ⏳ Wait for merge

## Contact

If you need help:
- Check `docs/OPENCLAW_DEPLOYMENT.md` for deployment guide
- Review component READMEs for troubleshooting
- Check GitHub Issues for similar problems
