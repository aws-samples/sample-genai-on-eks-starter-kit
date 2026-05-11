# Calculator MCP Server

A Model Context Protocol (MCP) server that exposes basic arithmetic operations as tools. Built with FastMCP 2.0, this server provides a standardized interface for AI models to perform calculations.

## What It Does

The Calculator MCP Server provides four arithmetic operations:

- **add** - Add two numbers together
- **subtract** - Subtract one number from another
- **multiply** - Multiply two numbers together
- **divide** - Divide one number by another (with zero-check)

These tools can be consumed by any MCP-compatible AI agent or application.

## Installation

Install the Calculator MCP Server:

```bash
./cli mcp-server calculator install
```

This will:

1. Build a Docker image from the Python source code
2. Push the image to Amazon ECR
3. Deploy the server as a Kubernetes Deployment
4. Create a Service at `http://calculator.mcp-server:8000`

## Verification

Check the deployment status:

```bash
# Check pods
kubectl get pods -n mcp-server -l app=calculator

# Check service
kubectl get svc -n mcp-server calculator

# Check logs
kubectl logs -n mcp-server -l app=calculator

# Test MCP endpoint
kubectl port-forward -n mcp-server svc/calculator 8000:8000
curl http://localhost:8000/mcp
```

Expected response: MCP protocol metadata including available tools.

## Key Files

### server.py

The main FastMCP server implementation:

```python
from fastmcp import FastMCP

mcp = FastMCP("Calculator")

@mcp.tool(description="Add two numbers together")
def add(x: int, y: int) -> int:
    """Add two numbers and return the result."""
    return x + y

@mcp.tool(description="Subtract one number from another")
def subtract(x: int, y: int) -> int:
    """Subtract y from x and return the result."""
    return x - y

@mcp.tool(description="Multiply two numbers together")
def multiply(x: int, y: int) -> int:
    """Multiply two numbers and return the result."""
    return x * y

@mcp.tool(description="Divide one number by another")
def divide(x: float, y: float) -> float:
    """Divide x by y and return the result."""
    if y == 0:
        raise ValueError("Cannot divide by zero")
    return x / y

if __name__ == "__main__":
    mcp.run()
```

### Dockerfile

Multi-stage build using Python 3.12:

```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY __init__.py .
COPY server.py .
EXPOSE 8000
CMD ["fastmcp", "run", "server.py", "--transport", "http", "--host", "0.0.0.0", "--port", "8000"]
```

### requirements.txt

```
fastmcp==3.2.0
```

## How It Works

1. **FastMCP Framework**: The server uses the FastMCP framework, which provides decorators to expose Python functions as MCP tools
2. **HTTP Transport**: The server runs with HTTP transport on port 8000, exposing the `/mcp` endpoint
3. **Tool Registration**: Each `@mcp.tool()` decorated function is automatically registered as an MCP tool with its signature and documentation
4. **Kubernetes Service**: The server is accessible cluster-wide via the Service DNS name `calculator.mcp-server`

## Usage with AI Agents

The Calculator MCP Server can be consumed by various AI agent frameworks:

### Strands Agents

```python
from agno.tools.mcp import MCPTools

mcp_tools = MCPTools(
    url="http://calculator.mcp-server:8000/mcp",
    transport="streamable-http"
)
agent = Agent(model=model, tools=[mcp_tools])
```

### Agno

```python
from agno.tools.mcp import MCPTools

mcp_tools = MCPTools(
    url="http://calculator.mcp-server:8000/mcp",
    transport="streamable-http"
)
agent = Agent(model=model, tools=[mcp_tools])
```

### LiteLLM MCP Gateway

```python
# Configure LiteLLM to proxy MCP servers
headers = {
    "Authorization": f"Bearer {LITELLM_API_KEY}",
    "x-litellm-api-key": f"Bearer {LITELLM_API_KEY}"
}
mcp_client = MCPClient(
    lambda: streamablehttp_client(
        f"{LITELLM_BASE_URL}/mcp", headers=headers
    )
)
```

## Configuration

The server can be customized via environment variables in `config.json`:

```json
{
  "examples": {
    "mcp-server": {
      "calculator": {
        "replicas": 1,
        "resources": {
          "requests": {
            "cpu": "100m",
            "memory": "128Mi"
          },
          "limits": {
            "cpu": "500m",
            "memory": "256Mi"
          }
        }
      }
    }
  }
}
```

## Uninstallation

Remove the Calculator MCP Server:

```bash
./cli mcp-server calculator uninstall
```

This will delete the Deployment and Service from the `mcp-server` namespace.

## Extending the Server

To add more tools, edit `examples/mcp-server/calculator/server.py`:

```python
@mcp.tool(description="Calculate power of a number")
def power(base: float, exponent: float) -> float:
    """Calculate base raised to the power of exponent."""
    return base ** exponent

@mcp.tool(description="Calculate square root")
def sqrt(x: float) -> float:
    """Calculate square root of a number."""
    import math
    if x < 0:
        raise ValueError("Cannot calculate square root of negative number")
    return math.sqrt(x)
```

Then rebuild and redeploy:

```bash
./cli mcp-server calculator install
```

## References

- [FastMCP Documentation](https://gofastmcp.com)
- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [FastMCP GitHub Repository](https://github.com/jlowin/fastmcp)
