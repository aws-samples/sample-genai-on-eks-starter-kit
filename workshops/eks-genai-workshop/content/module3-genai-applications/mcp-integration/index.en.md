---
title: "MCP Integration"
weight: 43
duration: "20 minutes"
difficulty: "intermediate"
---

# Model Context Protocol (MCP) Integration

Learn how to integrate the Model Context Protocol (MCP) to enable agents to access external tools and data sources securely and efficiently.

## Overview

MCP is a universal protocol for connecting AI agents with external tools, APIs, and data sources. It provides a standardized way to extend agent capabilities beyond their base knowledge.

## Learning Objectives

By the end of this lab, you will be able to:
- Understand MCP architecture and protocols
- Deploy MCP servers for tool integration
- Connect agents to external tools via MCP
- Implement custom MCP tools for specific use cases
- Monitor and secure MCP communications

## Prerequisites

- Completed [Memory Stores](/module3-genai-applications/memory-stores/)
- Understanding of API protocols and tool integration
- Basic knowledge of agent architectures

## MCP Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Architecture                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Agent A   │  │   Agent B   │  │   Agent C   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│         │                 │                 │              │
│  ┌─────────────────────────────────────────────────────────┤
│  │              MCP Client Library                         │
│  └─────────────────────────────────────────────────────────┤
│         │                 │                 │              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ MCP Server  │  │ MCP Server  │  │ MCP Server  │        │
│  │ (Tools)     │  │ (APIs)      │  │ (Data)      │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Lab: Implementing MCP Integration

### Step 1: Deploy MCP Server

```yaml
# mcp-server-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-server
  namespace: genai-applications
  labels:
    app: mcp-server
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mcp-server
  template:
    metadata:
      labels:
        app: mcp-server
    spec:
      containers:
      - name: mcp-server
        image: python:3.11-slim
        command: ["/bin/bash"]
        args: ["-c", "cd /app && python mcp_server.py"]
        ports:
        - containerPort: 8080
        volumeMounts:
        - name: mcp-code
          mountPath: /app
        resources:
          requests:
            cpu: 200m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        env:
        - name: MCP_SERVER_PORT
          value: "8080"
        - name: MCP_SERVER_HOST
          value: "0.0.0.0"
      volumes:
      - name: mcp-code
        configMap:
          name: mcp-server-code
---
apiVersion: v1
kind: Service
metadata:
  name: mcp-server-service
  namespace: genai-applications
  labels:
    app: mcp-server
spec:
  selector:
    app: mcp-server
  ports:
  - port: 8080
    targetPort: 8080
    protocol: TCP
  type: ClusterIP
```### Step 2: 
Create MCP Server Implementation

```python
# mcp_server.py
import asyncio
import json
import logging
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from datetime import datetime
import aiohttp
from aiohttp import web
import requests

@dataclass
class MCPTool:
    name: str
    description: str
    parameters: Dict[str, Any]
    handler: callable

class MCPServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 8080):
        self.host = host
        self.port = port
        self.tools = {}
        self.app = web.Application()
        self.setup_routes()
        self.register_default_tools()
    
    def setup_routes(self):
        """Setup HTTP routes for MCP server"""
        self.app.router.add_get('/health', self.health_check)
        self.app.router.add_get('/tools', self.list_tools)
        self.app.router.add_post('/tools/{tool_name}', self.execute_tool)
        self.app.router.add_get('/tools/{tool_name}/schema', self.get_tool_schema)
    
    def register_tool(self, tool: MCPTool):
        """Register a new tool with the MCP server"""
        self.tools[tool.name] = tool
        logging.info(f"Registered tool: {tool.name}")
    
    def register_default_tools(self):
        """Register default tools"""
        
        # Web search tool
        web_search_tool = MCPTool(
            name="web_search",
            description="Search the web for information",
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results",
                        "default": 5
                    }
                },
                "required": ["query"]
            },
            handler=self.web_search_handler
        )
        self.register_tool(web_search_tool)
        
        # Calculator tool
        calculator_tool = MCPTool(
            name="calculator",
            description="Perform mathematical calculations",
            parameters={
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Mathematical expression to evaluate"
                    }
                },
                "required": ["expression"]
            },
            handler=self.calculator_handler
        )
        self.register_tool(calculator_tool)
        
        # File operations tool
        file_ops_tool = MCPTool(
            name="file_operations",
            description="Perform file operations",
            parameters={
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": ["read", "write", "list", "delete"],
                        "description": "File operation to perform"
                    },
                    "path": {
                        "type": "string",
                        "description": "File path"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content for write operations"
                    }
                },
                "required": ["operation", "path"]
            },
            handler=self.file_operations_handler
        )
        self.register_tool(file_ops_tool)
    
    async def health_check(self, request):
        """Health check endpoint"""
        return web.json_response({
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "tools_count": len(self.tools)
        })
    
    async def list_tools(self, request):
        """List available tools"""
        tools_info = []
        for name, tool in self.tools.items():
            tools_info.append({
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters
            })
        
        return web.json_response({
            "tools": tools_info,
            "count": len(tools_info)
        })
    
    async def get_tool_schema(self, request):
        """Get schema for a specific tool"""
        tool_name = request.match_info['tool_name']
        
        if tool_name not in self.tools:
            return web.json_response(
                {"error": f"Tool '{tool_name}' not found"}, 
                status=404
            )
        
        tool = self.tools[tool_name]
        return web.json_response({
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters
        })
    
    async def execute_tool(self, request):
        """Execute a tool with given parameters"""
        tool_name = request.match_info['tool_name']
        
        if tool_name not in self.tools:
            return web.json_response(
                {"error": f"Tool '{tool_name}' not found"}, 
                status=404
            )
        
        try:
            data = await request.json()
            tool = self.tools[tool_name]
            
            # Execute tool handler
            result = await tool.handler(data)
            
            return web.json_response({
                "tool": tool_name,
                "result": result,
                "timestamp": datetime.now().isoformat()
            })
            
        except Exception as e:
            logging.error(f"Error executing tool {tool_name}: {e}")
            return web.json_response(
                {"error": str(e)}, 
                status=500
            )
    
    async def web_search_handler(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handler for web search tool"""
        query = params.get("query", "")
        max_results = params.get("max_results", 5)
        
        # Mock web search implementation
        # In real implementation, this would use actual search APIs
        mock_results = [
            {
                "title": f"Search result {i+1} for '{query}'",
                "url": f"https://example.com/result{i+1}",
                "snippet": f"This is a mock search result snippet for query '{query}'"
            }
            for i in range(min(max_results, 3))
        ]
        
        return {
            "query": query,
            "results": mock_results,
            "total_results": len(mock_results)
        }
    
    async def calculator_handler(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handler for calculator tool"""
        expression = params.get("expression", "")
        
        try:
            # Safe evaluation of mathematical expressions
            # In production, use a proper math parser
            allowed_chars = set('0123456789+-*/.() ')
            if not all(c in allowed_chars for c in expression):
                raise ValueError("Invalid characters in expression")
            
            result = eval(expression)
            
            return {
                "expression": expression,
                "result": result,
                "type": type(result).__name__
            }
            
        except Exception as e:
            return {
                "expression": expression,
                "error": str(e)
            }
    
    async def file_operations_handler(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handler for file operations tool"""
        operation = params.get("operation")
        path = params.get("path", "")
        content = params.get("content", "")
        
        try:
            if operation == "read":
                # Mock file read
                return {
                    "operation": "read",
                    "path": path,
                    "content": f"Mock content of file: {path}",
                    "size": 100
                }
            
            elif operation == "write":
                # Mock file write
                return {
                    "operation": "write",
                    "path": path,
                    "bytes_written": len(content),
                    "success": True
                }
            
            elif operation == "list":
                # Mock directory listing
                return {
                    "operation": "list",
                    "path": path,
                    "files": [
                        {"name": "file1.txt", "size": 100, "type": "file"},
                        {"name": "file2.txt", "size": 200, "type": "file"},
                        {"name": "subdir", "type": "directory"}
                    ]
                }
            
            elif operation == "delete":
                # Mock file deletion
                return {
                    "operation": "delete",
                    "path": path,
                    "success": True
                }
            
            else:
                return {"error": f"Unknown operation: {operation}"}
                
        except Exception as e:
            return {"error": str(e)}
    
    async def start_server(self):
        """Start the MCP server"""
        logging.info(f"Starting MCP server on {self.host}:{self.port}")
        runner = web.AppRunner(self.app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.port)
        await site.start()
        logging.info(f"MCP server started successfully")

# MCP Client for agents
class MCPClient:
    def __init__(self, server_url: str = "http://mcp-server-service:8080"):
        self.server_url = server_url
        self.available_tools = {}
    
    async def initialize(self):
        """Initialize client and fetch available tools"""
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self.server_url}/tools") as response:
                if response.status == 200:
                    data = await response.json()
                    self.available_tools = {
                        tool["name"]: tool for tool in data["tools"]
                    }
                    logging.info(f"Initialized MCP client with {len(self.available_tools)} tools")
                else:
                    logging.error(f"Failed to fetch tools: {response.status}")
    
    async def execute_tool(self, tool_name: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a tool via MCP"""
        if tool_name not in self.available_tools:
            return {"error": f"Tool '{tool_name}' not available"}
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.server_url}/tools/{tool_name}",
                json=parameters
            ) as response:
                return await response.json()
    
    def get_available_tools(self) -> List[str]:
        """Get list of available tool names"""
        return list(self.available_tools.keys())
    
    def get_tool_schema(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """Get schema for a specific tool"""
        return self.available_tools.get(tool_name)

# Demo application
async def run_mcp_demo():
    """Run MCP integration demo"""
    
    # Initialize MCP client
    client = MCPClient()
    await client.initialize()
    
    print("=== MCP Integration Demo ===\n")
    
    # List available tools
    print("Available tools:")
    for tool_name in client.get_available_tools():
        tool_schema = client.get_tool_schema(tool_name)
        print(f"- {tool_name}: {tool_schema['description']}")
    
    print("\n" + "="*50 + "\n")
    
    # Test calculator tool
    print("Testing calculator tool:")
    calc_result = await client.execute_tool("calculator", {"expression": "15 * 8 + 7"})
    print(f"Calculator result: {calc_result}")
    
    # Test web search tool
    print("\nTesting web search tool:")
    search_result = await client.execute_tool("web_search", {
        "query": "machine learning algorithms",
        "max_results": 3
    })
    print(f"Search results: {len(search_result.get('result', {}).get('results', []))} found")
    
    # Test file operations tool
    print("\nTesting file operations tool:")
    file_result = await client.execute_tool("file_operations", {
        "operation": "list",
        "path": "/tmp"
    })
    print(f"File operation result: {file_result.get('result', {}).get('operation', 'unknown')}")

if __name__ == "__main__":
    # Setup logging
    logging.basicConfig(level=logging.INFO)
    
    # Start MCP server
    server = MCPServer()
    
    async def main():
        # Start server
        await server.start_server()
        
        # Wait a bit for server to start
        await asyncio.sleep(2)
        
        # Run demo
        await run_mcp_demo()
        
        # Keep server running
        while True:
            await asyncio.sleep(1)
    
    asyncio.run(main())
```

### Step 3: Create Agent with MCP Integration

```python
# mcp_agent.py
from langchain.agents import create_react_agent, AgentExecutor
from langchain.tools import Tool
from langchain.prompts import PromptTemplate
from langchain.llms import OpenAI
import asyncio
import json

class MCPIntegratedAgent:
    def __init__(self, llm_url: str = "http://litellm-service:4000"):
        self.llm = OpenAI(
            base_url=llm_url,
            api_key="sk-1234",
            model_name="gpt-3.5-turbo"
        )
        self.mcp_client = MCPClient()
        self.tools = []
        
    async def initialize(self):
        """Initialize agent with MCP tools"""
        await self.mcp_client.initialize()
        
        # Convert MCP tools to LangChain tools
        for tool_name in self.mcp_client.get_available_tools():
            tool_schema = self.mcp_client.get_tool_schema(tool_name)
            
            langchain_tool = Tool(
                name=tool_name,
                description=tool_schema["description"],
                func=lambda params, tn=tool_name: asyncio.run(
                    self.mcp_client.execute_tool(tn, json.loads(params) if isinstance(params, str) else params)
                )
            )
            
            self.tools.append(langchain_tool)
        
        # Create agent
        prompt = PromptTemplate(
            template="""
            You are a helpful assistant with access to various tools via MCP (Model Context Protocol).
            
            TOOLS:
            ------
            You have access to the following tools:
            {tools}
            
            To use a tool, please use the following format:
            
            ```
            Thought: Do I need to use a tool? Yes
            Action: the action to take, should be one of [{tool_names}]
            Action Input: the input to the action (as JSON if multiple parameters)
            Observation: the result of the action
            ```
            
            When you have a response to say to the Human, or if you do not need to use a tool, you MUST use the format:
            
            ```
            Thought: Do I need to use a tool? No
            Final Answer: [your response here]
            ```
            
            Begin!
            
            Question: {input}
            Thought: {agent_scratchpad}
            """,
            input_variables=["input", "agent_scratchpad", "tools", "tool_names"]
        )
        
        agent = create_react_agent(
            llm=self.llm,
            tools=self.tools,
            prompt=prompt
        )
        
        self.agent_executor = AgentExecutor(
            agent=agent,
            tools=self.tools,
            verbose=True,
            handle_parsing_errors=True,
            max_iterations=5
        )
    
    async def run(self, query: str) -> str:
        """Run agent with MCP tool access"""
        return self.agent_executor.run(query)

# Usage example
async def demo_mcp_agent():
    agent = MCPIntegratedAgent()
    await agent.initialize()
    
    queries = [
        "What is 25% of 480? Use the calculator to verify.",
        "Search for information about 'kubernetes best practices'",
        "List the files in the /tmp directory"
    ]
    
    for query in queries:
        print(f"\nQuery: {query}")
        result = await agent.run(query)
        print(f"Result: {result}")

if __name__ == "__main__":
    asyncio.run(demo_mcp_agent())
```

Continue with [Multi-Agent Systems](/module3-genai-applications/multi-agent/) to learn about agent orchestration and communication patterns.