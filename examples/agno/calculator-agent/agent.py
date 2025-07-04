import os
import asyncio
import base64
from contextlib import asynccontextmanager
from agno.agent import Agent
from agno.models.aws import AwsBedrock
from agno.models.openai.like import OpenAILike
from agno.tools.mcp import MCPTools
from agno.memory.v2.db.sqlite import SqliteMemoryDb
from agno.memory.v2.memory import Memory
from agno.storage.sqlite import SqliteStorage
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from langfuse import get_client
import openlit


class PromptRequest(BaseModel):
    prompt: str


if os.environ.get("USE_BEDROCK", "").lower() == "true":
    print("Using Bedrock...")
    model_id = os.environ.get(
        "BEDROCK_MODEL", "us.anthropic.claude-3-7-sonnet-20250219-v1:0"
    )
    model = AwsBedrock(id=model_id)
else:
    print("Using LiteLLM...")
    model = OpenAILike(
        base_url=os.environ.get("LITELLM_BASE_URL"),
        api_key=os.environ.get("LITELLM_API_KEY"),
        id=os.environ.get("LITELLM_MODEL_NAME"),
    )

if "LANGFUSE_HOST" in os.environ:
    LANGFUSE_AUTH = base64.b64encode(
        f"{os.environ.get('LANGFUSE_PUBLIC_KEY')}:{os.environ.get('LANGFUSE_SECRET_KEY')}".encode()
    ).decode()
    os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = (
        os.environ.get("LANGFUSE_HOST") + "/api/public/otel/v1/traces"
    )
    os.environ["OTEL_EXPORTER_OTLP_HEADERS"] = f"Authorization=Basic {LANGFUSE_AUTH}"
    langfuse = get_client()
    openlit.init(tracer=langfuse._otel_tracer, disable_batch=True)

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


mcp_tools = None
agent = None


@app.on_event("startup")
async def startup_event():
    global mcp_tools, agent
    mcp_tools = MCPTools(
        url="http://calculator.mcp-server:8000/mcp", transport="streamable-http"
    )
    await mcp_tools.__aenter__()
    db_file = "tmp/agent.db"
    memory = Memory(
        model=model,
        db=SqliteMemoryDb(table_name="user_memories", db_file=db_file),
    )
    storage = SqliteStorage(table_name="agent_sessions", db_file=db_file)
    agent = Agent(
        model=model,
        system_message=system_prompt,
        tools=[mcp_tools],
        memory=memory,
        enable_agentic_memory=True,
        enable_user_memories=True,
        storage=storage,
        add_history_to_messages=True,
        num_history_runs=3,
    )


@app.on_event("shutdown")
async def shutdown_event():
    global mcp_tools
    if mcp_tools:
        await mcp_tools.__aexit__(None, None, None)


@app.post("/")
async def prompt(request: PromptRequest):
    """
    Process a calculation request and return the result as a streaming response

    Args:
        request: The calculation request containing the prompt

    Returns:
        A streaming response with the calculation result
    """

    prompt = request.prompt
    print(f"Prompt: {prompt}\n")

    user_id = "ava"
    response = await agent.arun(
        request.prompt, user_id=user_id, markdown=True, stream=False
    )
    return PlainTextResponse(response.content)
