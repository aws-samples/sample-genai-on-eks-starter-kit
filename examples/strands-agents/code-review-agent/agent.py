import os
import base64
from strands import Agent, tool
from strands.models import BedrockModel
from strands.models.litellm import LiteLLMModel
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import rag


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
            "base_url": f"{os.environ.get('LITELLM_BASE_URL')}/v1",
            "api_key": os.environ.get("LITELLM_API_KEY"),
        },
        model_id="openai/" + os.environ.get("LITELLM_MODEL_NAME"),
    )

if "LANGFUSE_HOST" in os.environ:
    langfuse_public = os.environ.get("LANGFUSE_PUBLIC_KEY")
    langfuse_secret = os.environ.get("LANGFUSE_SECRET_KEY")
    if langfuse_public and langfuse_secret:
        LANGFUSE_AUTH = base64.b64encode(
            f"{langfuse_public}:{langfuse_secret}".encode()
        ).decode()
        os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = (
            os.environ.get("LANGFUSE_HOST") + "/api/public/otel/v1/traces"
        )
        os.environ["OTEL_EXPORTER_OTLP_HEADERS"] = f"Authorization=Basic {LANGFUSE_AUTH}"
    else:
        print("Warning: LANGFUSE_HOST is set but LANGFUSE_PUBLIC_KEY/SECRET_KEY missing, skipping tracing")


@tool
def search_code(query: str) -> str:
    """Search the indexed codebase for relevant code snippets.

    Use this tool to find code related to a user's question. It performs
    semantic search over the indexed Python source files and returns
    the most relevant code snippets with file paths and line numbers.

    Args:
        query: A natural language description of what code to search for.

    Returns:
        Formatted search results with file paths, line numbers, and code content.
    """
    results = rag.search(query, top_k=5)
    if not results:
        return "No relevant code found."

    formatted = []
    for r in results:
        formatted.append(
            f"--- {r['file_path']} (lines {r['line_start']}-{r['line_end']}, "
            f"type: {r['chunk_type']}, relevance: {r['score']:.3f}) ---\n"
            f"{r['content']}"
        )
    return "\n\n".join(formatted)


@tool
def get_file(file_path: str) -> str:
    """Retrieve the full content of an indexed source file.

    Use this tool when you need to see the complete file, not just a snippet.
    For example, after finding a relevant snippet with search_code, use this
    to see the full file context.

    Args:
        file_path: The file name to retrieve (e.g., "service.py", "models.py").

    Returns:
        The full content of the file, or an error message if not found.
    """
    content = rag.get_file_content(file_path)
    if content is None:
        return f"File '{file_path}' not found in the index."
    return f"--- {file_path} ---\n{content}"


system_prompt = """
You are an expert code review assistant. You have access to an indexed Python codebase
(an e-commerce order service) and can search through it to answer questions, review code,
and suggest improvements.

Your capabilities:
- **Code Search**: Use the search_code tool to find relevant code snippets by semantic similarity.
- **File Retrieval**: Use the get_file tool to retrieve the full content of a specific file.
- **Code Review**: Analyze code for bugs, security issues, code smells, and best practices.
- **Explanations**: Explain how code works, its design patterns, and architecture.
- **Suggestions**: Propose concrete improvements with code examples.

When reviewing code, look for:
1. Bugs and logical errors
2. Security vulnerabilities (e.g., weak hashing, SQL injection, missing auth)
3. Code smells (e.g., functions doing too many things, magic numbers, poor naming)
4. Missing error handling
5. Performance issues
6. Violations of SOLID principles

Always search the codebase first before answering questions about the code.
Provide specific line references and concrete improvement suggestions.
"""

app = FastAPI()
agent = None


@app.on_event("startup")
async def startup_event():
    global agent
    rag.initialize()
    agent = Agent(model=model, system_prompt=system_prompt, tools=[search_code, get_file])
    print("Code Review Agent ready")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/")
async def prompt(request: PromptRequest):
    global agent
    prompt = request.prompt
    print(f"Prompt: {prompt}\n")

    if agent is None:
        return StreamingResponse(
            iter(["Agent is still initializing, please try again shortly."]),
            status_code=503,
            media_type="text/plain",
        )

    async def process_streaming_response():
        try:
            async for event in agent.stream_async(request.prompt):
                if "data" in event:
                    yield event["data"]
        except Exception as e:
            print(f"Error: {e}")
            yield "Error processing the request!!!"

    return StreamingResponse(process_streaming_response(), media_type="text/plain")
