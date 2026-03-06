# OpenClaw Demo Guide

End-to-end walkthrough for deploying OpenClaw AI agents on EKS and using them through Open WebUI.

## Prerequisites

Ensure these components are already installed:

- LiteLLM: `./cli ai-gateway litellm install`
- Open WebUI: `./cli gui-app openwebui install`
- Langfuse (optional): `./cli o11y langfuse install`

> **Quick Start**: If you ran `./cli demo-setup`, OpenWebui, LiteLLM and Langfuse are already installed. You just need to install OpenClaw separately.

## Step 1: Install OpenClaw Bridge Server

```bash
./cli ai-agent openclaw install
```

Verify:

```bash
kubectl get pods -n openclaw
kubectl logs -n openclaw deployment/openclaw --tail=20
```

You should see the gateway connected and bridge server listening on port 8080.

## Step 2: Install DevOps Agent

```bash
./cli openclaw devops-agent install
```

Verify:

```bash
kubectl get pods -n openclaw -l app=devops-agent
```

## Step 3: Install Doc Writer Agent

```bash
./cli openclaw doc-writer install
```

Verify:

```bash
kubectl get pods -n openclaw -l app=doc-writer
```

## Step 4: Open WebUI Pipe Functions (Automated)

Pipe functions are **automatically registered** in Open WebUI when agents are installed in Steps 2 and 3. No manual setup is needed.

To verify, access Open WebUI and check that the agent functions appear in the model dropdown:

```bash
# Get the Open WebUI URL from the Ingress
kubectl get ingress -n openwebui

# URL format: https://openwebui.<DOMAIN> (with domain) or http://<ALB-DNS> (without domain)
```

> **Note:** If Open WebUI was not running when the agents were installed, you can re-run the install command to register the functions (e.g., `./cli openclaw devops-agent install`).

## Step 5: Use the Agents

1. Click **+ New Chat** in Open WebUI
2. Select **OpenClaw - DevOps Agent** (or **Document Writer**) from the model dropdown
3. Try a query:

| Agent | Example Prompt |
|-------|---------------|
| DevOps | Check the overall health of my Kubernetes cluster |
| DevOps | List all pods in the openclaw namespace and show their status |
| DevOps | Show all Helm releases in the cluster |
| Doc Writer | Write a README for `https://github.com/user/repo` |

See [DevOps Agent README](devops-agent/README.md) and [Doc Writer README](doc-writer/README.md) for more examples.

## Cleanup

```bash
./cli openclaw devops-agent uninstall
./cli openclaw doc-writer uninstall
./cli ai-agent openclaw uninstall
```
