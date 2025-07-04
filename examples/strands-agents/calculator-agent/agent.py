import os
import base64
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.models.litellm import LiteLLMModel
from strands_tools import calculator
from strands.tools.mcp.mcp_client import MCPClient
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import asyncio


class PromptRequest(BaseModel):
    prompt: str


if os.environ.get("USE_BEDROCK", "").lower() == "true":
    print("Using Bedrock...")
    model_id = os.environ.get(
        "BEDROCK_MODEL", "us.anthropic.claude-3-7-sonnet-20250219-v1:0"
    )
    model = BedrockModel(model_id=model_id)
else:
    print("Using LiteLLM...")
    model = LiteLLMModel(
        client_args={
            "base_url": os.environ.get("LITELLM_BASE_URL"),
            "api_key": os.environ.get("LITELLM_API_KEY"),
        },
        model_id="openai/" + os.environ.get("LITELLM_MODEL_NAME"),
    )

if "LANGFUSE_HOST" in os.environ:
    LANGFUSE_AUTH = base64.b64encode(
        f"{os.environ.get('LANGFUSE_PUBLIC_KEY')}:{os.environ.get('LANGFUSE_SECRET_KEY')}".encode()
    ).decode()
    os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = (
        os.environ.get("LANGFUSE_HOST") + "/api/public/otel/v1/traces"
    )
    os.environ["OTEL_EXPORTER_OTLP_HEADERS"] = f"Authorization=Basic {LANGFUSE_AUTH}"

system_prompt = """
You are a helpful calculator assistant that can perform basic arithmetic operations.

You have access to the following calculator tools:
- add: Add two numbers together
- subtract: Subtract one number from another
- multiply: Multiply two numbers together
- divide: Divide one number by another

When asked to perform calculations, use the appropriate tool rather than calculating the result yourself.
Explain the calculation and show the result clearly.
"""

app = FastAPI()

mcp_client = None
agent = None


@app.on_event("startup")
async def startup_event():
    global mcp_client, agent
    if os.environ.get("USE_MCP_TOOLS", "").lower() == "true":
        print("Using MCP tools...")
        mcp_client = MCPClient(
            lambda: streamablehttp_client("http://calculator.mcp-server:8000/mcp")
        )
        mcp_client.__enter__()
        tools = mcp_client.list_tools_sync()
        agent = Agent(model=model, system_prompt=system_prompt, tools=tools)
    else:
        print("Using Python tools...")
        tools = [calculator]
        agent = Agent(model=model, system_prompt=system_prompt, tools=tools)


@app.on_event("shutdown")
async def shutdown_event():
    global mcp_client
    if mcp_client:
        await mcp_client.__exit__(None, None, None)


@app.post("/")
async def prompt(request: PromptRequest):
    """
    Process a calculation request and return the result as a streaming response

    Args:
        request: The calculation request containing the prompt

    Returns:
        A streaming response with the calculation result
    """
    global agent

    prompt = request.prompt
    print(f"Prompt: {prompt}\n")

    async def process_streaming_response():
        try:
            async for event in agent.stream_async(request.prompt):
                if "data" in event:
                    yield event["data"]
        except Exception as e:
            print(f"Error: {e}")
            yield "Error processing the request!!!"

    return StreamingResponse(process_streaming_response(), media_type="text/plain")
