# Examples

This section contains ready-to-deploy examples demonstrating various AI frameworks and tools on Amazon EKS. Each example provides practical implementations that you can use as a starting point for your own applications.

## MCP Server

Model Context Protocol (MCP) servers provide standardized interfaces for AI models to interact with external tools and data sources.

- **[Calculator MCP Server](mcp-server/calculator.md)** - Basic arithmetic operations exposed via FastMCP protocol

## AI Agent Frameworks

Examples showcasing different AI agent frameworks for building conversational AI applications with tool usage capabilities.

### Strands Agents

- **[Calculator Agent](strands-agents/calculator-agent.md)** - Agent using Strands framework with MCP or Python tools for arithmetic operations

### Agno

- **[Calculator Agent](agno/calculator-agent.md)** - Agent using Agno framework with memory management and MCP tool integration

### OpenClaw

- **[Document Writer Agent](openclaw/doc-writer.md)** - Autonomous documentation agent that clones repos, analyzes code, and commits documentation
- **[DevOps Agent](openclaw/devops-agent.md)** - Interactive cluster management assistant with kubectl, helm, and AWS CLI access

## Quick Start

All examples can be installed using the CLI:

```bash
./cli <category> <example> install

# Examples:
./cli mcp-server calculator install
./cli strands-agents calculator-agent install
./cli agno calculator-agent install
./cli openclaw doc-writer install
./cli openclaw devops-agent install
```

## Prerequisites

Most examples require:

- EKS cluster with configured kubectl access
- LiteLLM AI gateway (`./cli ai-gateway litellm install`)
- Open WebUI (`./cli gui-app openwebui install`) for interactive testing

Check each example's documentation for specific requirements and configuration options.
