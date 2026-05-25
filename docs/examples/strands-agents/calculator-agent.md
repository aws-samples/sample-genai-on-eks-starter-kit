# Strands Agents Calculator Agent

An AI agent built with the Strands framework that performs arithmetic calculations using either MCP tools or native Python tools. The agent demonstrates integration with LiteLLM, Bedrock, and optional observability with Langfuse.

## What It Does

The Calculator Agent:

- Accepts natural language calculation requests via HTTP API
- Uses AI models (Claude, GPT, etc.) to understand requests
- Executes calculations using MCP tools or Python calculator tools
- Streams responses back to clients
- Optionally traces execution to Langfuse for observability

## Installation

Install the Strands Calculator Agent:

```bash
./cli strands-agents calculator-agent install
```

This will:

1. Build a Docker image containing the Strands agent code
2. Push the image to Amazon ECR
3. Deploy the agent as a Kubernetes Deployment
4. Create a Service at `http://calculator-agent.strands-agents:8080`
5. Register the agent as a pipe function in Open WebUI (if installed)

## Verification

Check the deployment status:

```bash
# Check pods
kubectl get pods -n strands-agents -l app=calculator-agent

# Check service
kubectl get svc -n strands-agents calculator-agent

# Check logs
kubectl logs -n strands-agents -l app=calculator-agent

# Test agent endpoint
kubectl port-forward -n strands-agents svc/calculator-agent 8080:8080
curl -X POST http://localhost:8080/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 25 multiplied by 4?"}'
```

## Key Files

### agent.py

The main Strands agent implementation using FastAPI:

```python
from strands import Agent
from strands.models.litellm import LiteLLMModel
from strands_tools import calculator
from strands.tools.mcp.mcp_client import MCPClient
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

# Configure model (LiteLLM or Bedrock)
if os.environ.get("USE_BEDROCK", "").lower() == "true":
    model = BedrockModel(model_id=os.environ.get("BEDROCK_MODEL"))
else:
    model = LiteLLMModel(
        client_args={
            "base_url": f"{os.environ.get("LITELLM_BASE_URL")}/v1",
            "api_key": os.environ.get("LITELLM_API_KEY"),
        },
        model_id="openai/" + os.environ.get("LITELLM_MODEL_NAME"),
    )

# Configure tools (MCP or Python)
if os.environ.get("USE_MCP_TOOLS", "").lower() == "true":
    mcp_client = MCPClient(
        lambda: streamablehttp_client("http://calculator.mcp-server:8000/mcp")
    )
    tools = mcp_client.list_tools_sync()
else:
    tools = [calculator]

agent = Agent(model=model, system_prompt=system_prompt, tools=tools)

@app.post("/")
async def prompt(request: PromptRequest):
    async def process_streaming_response():
        async for event in agent.stream_async(request.prompt):
            if "data" in event:
                yield event["data"]
    return StreamingResponse(process_streaming_response(), media_type="text/plain")
```

### openwebui_pipe_function.py

Open WebUI integration for interactive chat:

```python
class Pipe:
    def __init__(self):
        self.type = "manifold"
        self.id = "strands_calculator_agent"
        self.name = "Strands: Calculator Agent"
    
    def pipe(self, body: dict) -> str:
        # Forward request to agent service
        response = requests.post(
            "http://calculator-agent.strands-agents:8080",
            json={"prompt": user_message}
        )
        return response.text
```

### Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agent.py .
EXPOSE 8080
CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8080"]
```

## How It Works

1. **Request Reception**: The FastAPI server receives POST requests with calculation prompts
2. **Agent Processing**: The Strands Agent uses the configured model to understand the request
3. **Tool Execution**: The agent calls appropriate calculator tools (add, subtract, multiply, divide)
4. **Response Streaming**: Results are streamed back to the client in real-time
5. **Observability**: If Langfuse is configured, execution traces are automatically captured

### MCP vs Python Tools

The agent supports two tool modes:

**MCP Tools** (when `USE_MCP_TOOLS=true`):
- Connects to the Calculator MCP Server
- Uses standardized MCP protocol
- Requires MCP server to be installed

**Python Tools** (default):
- Uses native Python calculator functions
- No external dependencies
- Faster execution (no network calls)

## Configuration

Configure the agent via environment variables in `.env.local` or `config.json`:

```json
{
  "examples": {
    "strands-agents": {
      "calculator-agent": {
        "env": {
          "USE_MCP_TOOLS": "false",
          "USE_MCP_GATEWAY": "false",
          "USE_BEDROCK": "false",
          "LITELLM_MODEL_NAME": "bedrock/claude-4.5-sonnet",
          "LITELLM_BASE_URL": "http://litellm.litellm:4000",
          "LITELLM_API_KEY": "${LITELLM_API_KEY}"
        }
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `USE_MCP_TOOLS` | Use MCP tools instead of Python tools | `false` |
| `USE_MCP_GATEWAY` | Use LiteLLM MCP gateway proxy | `false` |
| `USE_BEDROCK` | Use Bedrock instead of LiteLLM | `false` |
| `LITELLM_BASE_URL` | LiteLLM API endpoint | `http://litellm.litellm:4000` |
| `LITELLM_API_KEY` | LiteLLM API key | From `.env` |
| `LITELLM_MODEL_NAME` | Model to use | `bedrock/claude-4.5-sonnet` |
| `BEDROCK_MODEL` | Bedrock model ID | `us.anthropic.claude-3-7-sonnet-20250219-v1:0` |
| `LANGFUSE_HOST` | Langfuse endpoint (optional) | Auto-detected |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key (optional) | From `.env` |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key (optional) | From `.env` |

## Open WebUI Integration

The agent is automatically registered in Open WebUI during installation. No manual setup is needed.

!!! note
    If Open WebUI was not running during install, re-run `./cli strands-agents calculator-agent install` to register the pipe function.

### Using the Agent

1. Open Open WebUI in your browser
2. Start a new chat
3. Select **Strands: Calculator Agent** from the model dropdown
4. Send calculation requests:

```
What is 125 divided by 5?
Calculate 15% of 200
What is the product of 12 and 8?
```

## Example Requests

### Direct API

```bash
# Simple calculation
curl -X POST http://calculator-agent.strands-agents:8080/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 25 multiplied by 4?"}'

# Multiple operations
curl -X POST http://calculator-agent.strands-agents:8080/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Calculate (100 + 50) divided by 3"}'

# Word problems
curl -X POST http://calculator-agent.strands-agents:8080/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "If I have 120 apples and give away 45, how many do I have left?"}'
```

## Langfuse Observability

If Langfuse is installed and configured, the agent automatically sends traces:

1. Open Langfuse UI
2. Navigate to **Traces**
3. Filter by session or user
4. View detailed execution traces including:
   - Model calls and responses
   - Tool invocations
   - Token usage
   - Latency metrics
   - Error events

## Uninstallation

Remove the Calculator Agent:

```bash
./cli strands-agents calculator-agent uninstall
```

This will delete the Deployment, Service, and Open WebUI pipe function.

## References

- [Strands Agents Documentation](https://strandsagents.com)
- [FastAPI Documentation](https://fastapi.tiangolo.com)
- [LiteLLM Documentation](https://docs.litellm.ai)
- [Model Context Protocol](https://modelcontextprotocol.io)
