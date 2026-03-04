# OpenClaw Document Writer Agent

An AI-powered documentation agent that automatically generates and updates documentation in Git repositories. The agent clones repos, analyzes code, writes comprehensive documentation, and commits changes back to the repository.

## Use Case

The Document Writer Agent is designed for:
- Generating README files for new projects
- Updating API documentation
- Creating user guides and tutorials
- Maintaining changelog files
- Writing code comments and docstrings

## Architecture

```
User (Open WebUI)
  │
  ├─> POST /message {"message": "Write README for https://github.com/user/repo"}
  │
  ▼
Doc Writer Agent (K8s Job)
  │
  ├─> git clone https://github.com/user/repo
  ├─> Analyze code structure
  ├─> Call LiteLLM API (Claude/GPT/etc.)
  ├─> Generate documentation
  ├─> git add, commit, push
  └─> Stream response back to user
```

## Prerequisites

- OpenClaw bridge server installed (`./cli ai-agent openclaw install`)
- LiteLLM component installed (`./cli ai-gateway litellm install`)
- Open WebUI component installed (`./cli gui-app openwebui install`)
- kubectl configured to access the cluster
- (Optional) Git credentials for push access — see [Git Credentials](#git-credentials-optional) below

## Installation

### 1. Configure Environment Variables

Add to `.env`:

```bash
# Required
LITELLM_API_KEY=sk-1234567890abcdef

# Optional: Git credentials for doc-writer (see "Git Credentials" section below)
OPENCLAW_DOC_WRITER_GIT_USERNAME=your-github-username
OPENCLAW_DOC_WRITER_GIT_TOKEN=ghp_your_github_token

# Optional (for observability)
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
```

### 2. Install Document Writer Agent

```bash
./cli openclaw doc-writer install
```

This will:
1. Deploy agent as Kubernetes Deployment using a pre-built image
2. Create Service at `http://doc-writer.openclaw:8080`

### 3. Verify Installation

```bash
# Check pods
kubectl get pods -n openclaw -l app=doc-writer

# Check service
kubectl get svc -n openclaw doc-writer

# Check logs
kubectl logs -n openclaw -l app=doc-writer

# Test health endpoint
kubectl port-forward -n openclaw svc/doc-writer 8080:8080
curl http://localhost:8080/health
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Authentication token | `openclaw-gateway-token` |
| `LITELLM_BASE_URL` | LiteLLM API endpoint | `http://litellm.litellm:4000` |
| `LITELLM_API_KEY` | LiteLLM API key | From `.env` |
| `LITELLM_MODEL_NAME` | Model to use | `bedrock/claude-4.5-sonnet` |
| `GIT_USERNAME` | Git username | From `.env` |
| `GIT_TOKEN` | Git personal access token | From `.env` |
| `LANGFUSE_HOST` | Langfuse endpoint (optional) | Auto-detected |

### config.json

```json
{
  "examples": {
    "openclaw": {
      "doc-writer": {
        "env": {
          "LITELLM_MODEL_NAME": "bedrock/claude-4.5-sonnet",
          "OPENCLAW_GATEWAY_TOKEN": "openclaw-gateway-token"
        }
      }
    }
  }
}
```

## Open WebUI Integration

### 1. Install Pipe Function

1. Open Open WebUI in your browser
2. Navigate to **Admin Panel** → **Functions**
3. Click **+ Add Function**
4. Copy the contents of `openwebui_pipe_function.py`
5. Paste into the function editor
6. Click **Save**

### 2. Configure Pipe Function

In the function settings (Valves):

| Setting | Value |
|---|---|
| `AGENT_ENDPOINT` | `http://doc-writer.openclaw:8080/message` |
| `AGENT_AUTH_TOKEN` | Leave empty (or set if using auth) |
| `REQUEST_TIMEOUT` | `300` (5 minutes) |

### 3. Use the Agent

1. Start a new chat in Open WebUI
2. Select **OpenClaw - Document Writer** from the model dropdown
3. Send a message like:

```
Write a comprehensive README for https://github.com/myorg/myproject

Include:
- Project overview
- Installation instructions
- Usage examples
- API documentation
- Contributing guidelines
```

The agent will:
1. Clone the repository
2. Analyze the code structure
3. Generate documentation
4. Commit and push changes
5. Stream the response back to you

## Example Tasks

| Task | Example Prompt |
|------|---------------|
| Generate README | Write a README for `https://github.com/user/repo` — include project description, installation steps, quick start guide, configuration options |
| Update API Docs | Update the API documentation in `https://github.com/user/api-server` — REST endpoints, request/response formats, authentication, error codes |
| Create Changelog | Generate a CHANGELOG.md for `https://github.com/user/project` — new features, bug fixes, breaking changes based on recent commits |
| Contributing Guide | Create a CONTRIBUTING.md for `https://github.com/user/opensource-project` — code of conduct, development setup, PR process, coding standards |

## Git Workflow

The agent follows this Git workflow:

1. **Clone**: `git clone https://${GIT_USERNAME}:${GIT_TOKEN}@github.com/user/repo`
2. **Analyze**: Read code files, understand structure
3. **Generate**: Use LLM to create documentation
4. **Commit**: `git add . && git commit -m "docs: Update documentation"`
5. **Push**: `git push origin main`

### Git Configuration

The agent is pre-configured with:

```bash
git config --system user.name "OpenClaw Doc Writer"
git config --system user.email "openclaw-doc-writer@noreply"
```

## Langfuse Observability

If Langfuse is installed, view agent traces:

1. Open Langfuse UI
2. Navigate to **Traces**
3. Filter by `doc-writer` tag
4. View:
   - Task submission time
   - LLM API calls
   - Token usage
   - Response latency
   - Error events

## Git Credentials (Optional)

The doc-writer agent can optionally push changes back to Git repositories. To enable this, add your credentials to `.env.local` (via `./cli configure`):

```bash
OPENCLAW_DOC_WRITER_GIT_USERNAME=your-github-username
OPENCLAW_DOC_WRITER_GIT_TOKEN=ghp_your_github_token
```

Without credentials, the agent can still clone public repos and generate documentation — it just won't be able to commit and push.

> ⚠️ **Security Warning**: Git credentials are injected as **plain-text environment variables** into the agent container. The LLM-driven agent has access to these credentials at runtime. A prompt injection attack could potentially cause the agent to leak or misuse the token. **Do not use tokens with broad access.**

### Creating a Scoped GitHub Token

Use a [fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token) with minimal permissions:

1. Go to **GitHub Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
2. Click **Generate new token**
3. Configure:
   - **Token name**: `openclaw-doc-writer`
   - **Expiration**: 30 days (or shorter)
   - **Repository access**: Select **Only select repositories** — pick only the repos the agent should write to
   - **Permissions**: Set **Contents** to **Read and write** — leave everything else at **No access**
4. Click **Generate token** and copy it to `OPENCLAW_DOC_WRITER_GIT_TOKEN`

### Recommendations

- **Never use classic tokens** — they grant access to all repos
- **Set short expiration** — rotate tokens frequently
- **Limit to specific repos** — never grant org-wide access
- **Review agent output** — check commits before merging to main branches
- For production use, consider storing credentials in AWS KMS

## Cost Optimization

- **Spot instances**: Karpenter provisions Spot ARM64 nodes (up to 90% savings)
- **Job-based execution**: Consider using Jobs instead of Deployment for one-off tasks
- **Model selection**: Smaller models reduce LLM API costs

## Uninstallation

```bash
./cli openclaw doc-writer uninstall
```

This will delete Kubernetes resources (Deployment, Service, ServiceAccount).

## References

- [OpenClaw Repository](https://github.com/openclaw/openclaw)
- [Open WebUI Pipe Functions](https://docs.openwebui.com/features/pipe-functions)
- [GitHub Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
