# Agno Calculator Agent

An AI agent built with the Agno framework that performs arithmetic calculations using MCP tools. The agent features memory management, session persistence, and conversation history tracking, demonstrating advanced agentic capabilities.

## What It Does

The Agno Calculator Agent:

- Accepts natural language calculation requests via HTTP API
- Uses AI models (Claude, GPT, etc.) to understand requests
- Executes calculations using MCP tools from the Calculator MCP Server
- Maintains conversation history across sessions
- Stores user memories using SQLite for context persistence
- Integrates with Langfuse for observability via OpenLIT

## Installation

Install the Agno Calculator Agent:

```bash
./cli agno calculator-agent install
```

This will:

1. Build a Docker image containing the Agno agent code
2. Push the image to Amazon ECR
3. Deploy the agent as a Kubernetes Deployment
4. Create a Service at `http://calculator-agent.agno:8080`
5. Register the agent as a pipe function in Open WebUI (if installed)

## Verification

Check the deployment status:

```bash
# Check pods
kubectl get pods -n agno -l app=calculator-agent

# Check service
kubectl get svc -n agno calculator-agent

# Check logs
kubectl logs -n agno -l app=calculator-agent

# Test agent endpoint
kubectl port-forward -n agno svc/calculator-agent 8080:8080
curl -X POST http://localhost:8080/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 42 plus 58?"}'
```

## Key Files

### agent.py

The main Agno agent implementation with memory and session management:

```python
from agno.agent import Agent
from agno.models.openai.like import OpenAILike
from agno.tools.mcp import MCPTools
from agno.memory import MemoryManager
from agno.db.sqlite import SqliteDb
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

# Configure model (LiteLLM or Bedrock)
if os.environ.get("USE_BEDROCK", "").lower() == "true":
    model = AwsBedrock(id=os.environ.get("BEDROCK_MODEL"))
else:
    model = OpenAILike(
        base_url=os.environ.get("LITELLM_BASE_URL"),
        api_key=os.environ.get("LITELLM_API_KEY"),
        id=os.environ.get("LITELLM_MODEL_NAME"),
    )

# Connect to MCP tools
mcp_tools = MCPTools(
    url="http://calculator.mcp-server:8000/mcp",
    transport="streamable-http"
)

# Configure memory and session persistence
db_file = "tmp/agent.db"
memory_manager = MemoryManager(
    model=model,
    db=SqliteDb(db_file=db_file, memory_table="user_memories"),
)
db = SqliteDb(db_file=db_file, session_table="agent_sessions")

agent = Agent(
    model=model,
    system_message=system_prompt,
    tools=[mcp_tools],
    memory_manager=memory_manager,
    enable_agentic_memory=True,
    db=db,
    add_history_to_context=True,
    num_history_runs=3,
)

@app.post("/")
async def prompt(request: PromptRequest):
    user_id = "ava"
    response = await agent.arun(
        request.prompt, user_id=user_id, markdown=True, stream=False
    )
    return PlainTextResponse(response.content)
```

### openwebui_pipe_function.py

Open WebUI integration for interactive chat:

```python
class Pipe:
    def __init__(self):
        self.type = "manifold"
        self.id = "agno_calculator_agent"
        self.name = "Agno: Calculator Agent"
    
    def pipe(self, body: dict) -> str:
        # Forward request to agent service
        response = requests.post(
            "http://calculator-agent.agno:8080",
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
2. **Session Management**: The agent loads conversation history for the user (user_id: "ava")
3. **Memory Retrieval**: Relevant memories are retrieved from SQLite to provide context
4. **Agent Reasoning**: The Agno Agent uses the model to understand the request and plan tool usage
5. **MCP Tool Execution**: The agent calls calculator tools via MCP protocol
6. **Memory Update**: New learnings are stored in the memory database
7. **Session Persistence**: Conversation history is saved for future requests
8. **Response**: Results are returned as plain text

### Memory Management

The agent features two types of persistence:

**User Memories** (`user_memories` table):
- Stores facts and context learned from conversations
- Retrieved automatically for relevant queries
- Helps the agent remember user preferences and past interactions

**Session History** (`agent_sessions` table):
- Stores recent conversation turns
- Configurable via `num_history_runs` (default: 3)
- Provides context for follow-up questions

Example:
```
User: "What is 100 plus 50?"
Agent: "150"

User: "Now multiply that by 2"
Agent: "300" (remembers previous result from session history)
```

## Configuration

Configure the agent via environment variables in `.env.local` or `config.json`:

```json
{
  "examples": {
    "agno": {
      "calculator-agent": {
        "env": {
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
    If Open WebUI was not running during install, re-run `./cli agno calculator-agent install` to register the pipe function.

### Using the Agent

1. Open Open WebUI in your browser
2. Start a new chat
3. Select **Agno: Calculator Agent** from the model dropdown
4. Have a multi-turn conversation:

```
You: What is 25 times 4?
Agent: 25 multiplied by 4 equals 100.

You: Now add 50 to that
Agent: 100 plus 50 equals 150.

You: Divide the result by 3
Agent: 150 divided by 3 equals 50.
```

## Example Requests

### Direct API

```bash
# Simple calculation
curl -X POST http://calculator-agent.agno:8080/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 42 plus 58?"}'

# Complex expression
curl -X POST http://calculator-agent.agno:8080/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Calculate (75 * 4) - 100"}'

# Follow-up question (uses session history)
curl -X POST http://calculator-agent.agno:8080/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Now divide that by 2"}'
```

## Langfuse Observability

If Langfuse is installed and configured, the agent automatically sends traces via OpenLIT:

1. Open Langfuse UI
2. Navigate to **Traces**
3. Filter by user_id or session
4. View detailed execution traces including:
   - Model calls and responses
   - MCP tool invocations
   - Memory retrievals and updates
   - Token usage
   - Latency metrics
   - Error events

### OpenLIT Integration

The agent uses OpenLIT to bridge OpenTelemetry traces to Langfuse:

```python
import openlit
from langfuse import get_client

langfuse = get_client()
openlit.init(tracer=langfuse._otel_tracer, disable_batch=True)
```

This provides automatic instrumentation for:
- LLM API calls
- Tool executions
- Memory operations
- Session management

## Memory Database

The agent stores data in SQLite at `tmp/agent.db`:

**Schema:**
- `user_memories` - User-specific facts and preferences
- `agent_sessions` - Conversation history by user_id

**Persistence:**
To persist memories across pod restarts, mount a PersistentVolume:

```yaml
volumeMounts:
  - name: agent-data
    mountPath: /app/tmp
volumes:
  - name: agent-data
    persistentVolumeClaim:
      claimName: agno-calculator-agent-pvc
```

## Uninstallation

Remove the Calculator Agent:

```bash
./cli agno calculator-agent uninstall
```

This will delete the Deployment, Service, and Open WebUI pipe function.

!!! warning
    Memory database (`tmp/agent.db`) will be lost unless stored on a PersistentVolume.

## Comparison: Agno vs Strands

| Feature | Agno | Strands |
|---------|------|---------|
| Memory Management | ✅ Built-in with SQLite | ❌ Manual implementation required |
| Session History | ✅ Automatic with configurable depth | ❌ Not included |
| Streaming | ❌ Returns complete response | ✅ Real-time streaming |
| MCP Tools | ✅ Native MCPTools | ✅ MCPClient |
| Observability | ✅ OpenLIT + Langfuse | ✅ Direct OTEL integration |
| Database | ✅ SqliteDb included | ❌ Bring your own |

## References

- [Agno Documentation](https://docs.agno.com)
- [Agno GitHub Repository](https://github.com/agno-agi/agno)
- [FastAPI Documentation](https://fastapi.tiangolo.com)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [OpenLIT Documentation](https://docs.openlit.io)
