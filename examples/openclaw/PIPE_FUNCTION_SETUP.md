# OpenClaw Pipe Function Setup Guide

This guide provides step-by-step instructions for configuring OpenClaw agents as Pipe Functions in Open WebUI.

## Prerequisites

- Open WebUI installed and accessible
- OpenClaw Bridge Server running (`./cli ai-agent openclaw install`)
- At least one agent installed (DevOps Agent or Doc Writer)

## Access Open WebUI

### Option 1: HTTPS via ALB (Recommended)

```bash
# Get the Open WebUI URL
kubectl get ingress -n openwebui

# Access via browser
# URL format: https://openwebui.<DOMAIN>
# Example: https://openwebui.yjeong.people.aws.dev
```

### Option 2: Port Forward (Local Testing)

```bash
# Forward Open WebUI to localhost
kubectl port-forward -n openwebui svc/openwebui 8080:80

# Access via browser: http://localhost:8080
```

## Step 1: Log In as Admin

1. Open Open WebUI in your browser
2. Log in with your admin account
3. If this is your first time, create an admin account

## Step 2: Navigate to Functions

1. Click on your profile icon (top right)
2. Select **Admin Panel**
3. In the left sidebar, click **Functions**

## Step 3: Add DevOps Agent Function

### 3.1 Create New Function

1. Click the **New Function** button (far right side of the page)
2. You'll see a form with input fields

### 3.2 Fill in Function Details

Enter the following in the form fields:

| Field | Value |
|-------|-------|
| **Function Name** | `OpenClaw DevOps Agent` |
| **Description** | `Interactive Kubernetes cluster management and troubleshooting assistant with read-only access` |

### 3.3 Copy Function Code

Copy the entire contents of the DevOps Agent Pipe Function:

```bash
# View the function code
cat examples/openclaw/devops-agent/openwebui_pipe_function.py
```

Or open the file in your editor:
- Path: `examples/openclaw/devops-agent/openwebui_pipe_function.py`

### 3.3 Paste and Save

1. Paste the code into the function editor
2. Click **Save** (bottom right)
3. You should see a success message

## Step 4: Configure DevOps Agent Settings

After saving, you need to configure the function's "Valves" (settings):

### 4.1 Open Function Settings

1. In the Functions list, find **OpenClaw - DevOps Agent**
2. Click on the function name to open its settings

### 4.2 Configure Valves

You'll see a form with the following fields:

| Setting | Value | Description |
|---------|-------|-------------|
| **AGENT_ENDPOINT** | `http://devops-agent.openclaw:8080/message` | Internal K8s service endpoint |
| **AGENT_AUTH_TOKEN** | (leave empty) | Optional authentication token |
| **REQUEST_TIMEOUT** | `300` | Timeout in seconds (5 minutes) |

### 4.3 Save Settings

1. Click **Save** to apply the configuration
2. The function is now configured

## Step 5: Enable the Function

### 5.1 Toggle Function On

1. Go back to **Admin Panel** → **Functions**
2. Find **OpenClaw - DevOps Agent** in the list
3. Toggle the switch to **Enabled** (it should turn green/blue)

### 5.2 Verify Status

- Enabled functions show a colored toggle
- Disabled functions show a gray toggle

## Step 6: Test DevOps Agent

### 6.1 Start New Chat

1. Click **+ New Chat** (top left)
2. You'll see the chat interface

### 6.2 Select Agent Model

1. Click the model selector dropdown at the top of the chat
2. Look for **OpenClaw - DevOps Agent** in the list
3. Click to select it

### 6.3 Send Test Message

Try this simple query:

```
List all pods in the openclaw namespace
```

### 6.4 Expected Response

You should see:
1. A "thinking" indicator while the agent processes
2. A response showing the pod list with status information
3. The agent may include additional insights or recommendations

### 6.5 Troubleshooting Test Failures

If you see an error:

**"Could not connect to agent endpoint"**
- Check the agent is running: `kubectl get pods -n openclaw`
- Verify the endpoint URL in Valves settings
- Check agent logs: `kubectl logs -n openclaw deployment/devops-agent`

**"Request timeout"**
- Increase REQUEST_TIMEOUT in Valves settings
- Check if the agent pod is healthy
- Verify LiteLLM is running: `kubectl get pods -n litellm`

**"Internal server error"**
- Check agent logs for errors
- Verify LiteLLM configuration
- Check Langfuse connection (if enabled)

## Step 7: Add Doc Writer Agent (Optional)

Follow the same process for the Doc Writer agent:

### 7.1 Add Function

1. Go to **Admin Panel** → **Functions**
2. Click **New Function** (far right side)
3. Fill in the form:
   - **Function Name**: `OpenClaw Doc Writer`
   - **Description**: `Automated documentation generation from Git repositories`
4. Copy contents from: `examples/openclaw/doc-writer/openwebui_pipe_function.py`
5. Paste into the code editor
6. Click **Save**

### 7.2 Configure Valves

| Setting | Value |
|---------|-------|
| **AGENT_ENDPOINT** | `http://doc-writer.openclaw:8080/message` |
| **AGENT_AUTH_TOKEN** | (leave empty) |
| **REQUEST_TIMEOUT** | `600` (10 minutes for longer doc generation) |

### 7.3 Enable Function

1. Toggle **OpenClaw - Doc Writer** to **Enabled**

### 7.4 Test Doc Writer

Select the Doc Writer model and try:

```
Clone https://github.com/aws-samples/genai-on-eks-starter-kit and generate a README summary
```

## Example Queries for DevOps Agent

Once configured, try these queries:

### Cluster Health

```
Check the overall health of my Kubernetes cluster. Include node status, pod failures, and recent events.
```

### Resource Inspection

```
Show me all deployments in the litellm namespace with their replica counts and resource requests
```

### Log Analysis

```
Analyze the logs from the openclaw deployment for any errors or warnings in the last 50 lines
```

### Helm Releases

```
List all Helm releases in the cluster and their status
```

### AWS Resources

```
List all EKS clusters in the ap-northeast-2 region
```

### Troubleshooting

```
Why is the vllm pod in pending state? Check events and node resources.
```

## Advanced Configuration

### Adding Authentication

To secure agent endpoints with token authentication:

1. **Generate a token**:
   ```bash
   openssl rand -hex 32
   ```

2. **Update agent deployment** with the token as an environment variable

3. **Update Pipe Function Valves**:
   - Set AGENT_AUTH_TOKEN to the generated token

4. **Redeploy agent**:
   ```bash
   ./cli openclaw devops-agent uninstall
   ./cli openclaw devops-agent install
   ```

### Adjusting Timeouts

For long-running operations:

1. Open Function settings
2. Increase REQUEST_TIMEOUT (in seconds)
3. Save settings

Recommended timeouts:
- DevOps Agent: 300 seconds (5 minutes)
- Doc Writer: 600 seconds (10 minutes)

### Multiple Agent Instances

You can add the same agent multiple times with different configurations:

1. Create a new function with a different name
2. Point to the same agent endpoint
3. Configure different timeout or auth settings

## Verification Checklist

Use this checklist to verify your setup:

- [ ] Open WebUI is accessible
- [ ] OpenClaw Bridge Server is running
- [ ] DevOps Agent pod is running and healthy
- [ ] Doc Writer pod is running and healthy (if installed)
- [ ] DevOps Agent function is added and enabled
- [ ] Doc Writer function is added and enabled (if installed)
- [ ] Agent endpoint URLs are correct in Valves
- [ ] Test query returns a response
- [ ] Agent can execute kubectl commands
- [ ] Responses are formatted and helpful

## Monitoring Agent Activity

### View Agent Logs

```bash
# DevOps Agent logs
kubectl logs -n openclaw deployment/devops-agent -f

# Doc Writer logs
kubectl logs -n openclaw deployment/doc-writer -f

# Bridge Server logs
kubectl logs -n openclaw deployment/openclaw -f
```

### View Langfuse Traces

If Langfuse is installed:

1. Access Langfuse UI:
   ```bash
   kubectl get ingress -n langfuse
   ```

2. Navigate to **Traces**

3. Filter by agent name:
   - `devops-agent`
   - `doc-writer`

4. View detailed traces including:
   - User queries
   - Commands executed
   - LLM API calls
   - Token usage
   - Response latency

## Common Issues

### Function Not Appearing in Model List

**Cause**: Function is not enabled

**Solution**:
1. Go to Admin Panel → Functions
2. Find the function
3. Toggle to Enabled

### Agent Returns Empty Response

**Cause**: LiteLLM connection issue

**Solution**:
1. Check LiteLLM is running: `kubectl get pods -n litellm`
2. Verify LITELLM_BASE_URL in agent config
3. Check agent logs for connection errors

### Permission Denied Errors

**Cause**: RBAC permissions not configured

**Solution**:
1. Verify ClusterRole exists: `kubectl get clusterrole devops-agent-reader`
2. Verify ClusterRoleBinding: `kubectl get clusterrolebinding devops-agent-reader-binding`
3. Reinstall agent if needed

## Next Steps

- Explore the [DEMO_GUIDE.md](DEMO_GUIDE.md) for more usage examples
- Read the [DevOps Agent README](devops-agent/README.md) for advanced features
- Read the [Doc Writer README](doc-writer/README.md) for documentation automation
- Check [Langfuse documentation](https://langfuse.com/docs) for observability features

## Support

For issues or questions:
- Check agent logs: `kubectl logs -n openclaw deployment/<agent-name>`
- Review the troubleshooting section above
- Consult the OpenClaw documentation
- Open an issue in the repository
