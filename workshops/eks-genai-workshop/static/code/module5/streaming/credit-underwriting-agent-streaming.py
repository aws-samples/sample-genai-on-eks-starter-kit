# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# Credit Underwriting Agent — Streaming + Structured Validation (Module 5)
#
# Builds on the RAG-enhanced v2 agent and adds:
#   * SSE streaming (/api/process_credit_application_stream) so the loan officer
#     sees tool calls and tokens in real time via graph.astream_events.
#   * Pydantic-validated structured output (CreditDecision) for auditability on
#     the non-streaming endpoint: the agent is asked for JSON matching the
#     schema, and validate_and_format_decision() parses it, falling back to a
#     MANUAL_REVIEW record if the output does not validate. The streaming
#     endpoint streams raw tokens and is not validated.
#
# Reuses the Module 3 image's environment; RAG deps are pip-installed at start
# by the deploy script. The non-streaming endpoint from v2 is retained.
from dotenv import load_dotenv
load_dotenv()

import os
import json
import logging

import uvicorn
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse

from langchain_mcp_adapters.client import MultiServerMCPClient
# create_react_agent is deprecated in LangGraph v1 (replacement: langchain.agents.create_agent).
# It still works; the workshop keeps it and does not migrate.
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langchain_aws import BedrockEmbeddings
from pymilvus import MilvusClient

from utils import store_object, encode_image, generate_256_bit_hex_key
from credit_decision_schema import CreditDecision, validate_and_format_decision

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

try:
    from langfuse.langchain import CallbackHandler
    LANGFUSE_AVAILABLE = True
except ImportError:
    LANGFUSE_AVAILABLE = False
    CallbackHandler = None

# Configuration
model_key = os.environ.get("GATEWAY_MODEL_ACCESS_KEY", "")
api_gateway_url = os.environ.get("GATEWAY_URL", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
MILVUS_URI = os.environ.get("MILVUS_URI", "http://milvus.milvus.svc.cluster.local:19530")
COLLECTION = "loan_policies"

# Langfuse handler
langfuse_handler = None
if LANGFUSE_AVAILABLE and os.environ.get("LANGFUSE_URL"):
    try:
        os.environ["LANGFUSE_HOST"] = os.environ.get("LANGFUSE_URL", "")
        langfuse_handler = CallbackHandler()
        logger.info("Langfuse tracing enabled")
    except Exception as e:
        logger.info(f"Langfuse init failed: {e}")

# "claude-4.5-sonnet" is a legacy alias label defined by the starter kit config.workshop.json.
# The LiteLLM gateway routes it to Claude Sonnet 5.5 (global.anthropic.claude-sonnet-5-5).
model = ChatOpenAI(
    model=os.environ.get("AGENT_MODEL", "bedrock/claude-4.5-sonnet"),
    temperature=0, api_key=model_key, base_url=api_gateway_url,
    max_tokens=5000, timeout=300,
)

embeddings = BedrockEmbeddings(model_id="amazon.titan-embed-text-v2:0", region_name=AWS_REGION)
milvus_client = MilvusClient(uri=MILVUS_URI)


@tool
def retrieve_loan_policies(query: str) -> str:
    """Retrieve relevant loan policy sections from the vector database before deciding."""
    try:
        query_vector = embeddings.embed_query(query)
        results = milvus_client.search(
            collection_name=COLLECTION, data=[query_vector], limit=3,
            output_fields=["text", "source"],
        )
        hits = results[0] if results else []
        if not hits:
            return "No matching loan policies found."
        return "\n\n".join(
            f"[Policy: {h['entity'].get('source', 'unknown')}]\n{h['entity'].get('text', '')}"
            for h in hits
        )
    except Exception as e:
        logger.error(f"RAG retrieval failed: {e}")
        return f"Policy retrieval error: {e}"


mcp_servers = {
    "image_processor": {"url": os.getenv("MCP_IMAGE_PROCESSOR", "http://mcp-image-processor:8000") + "/sse", "transport": "sse"},
    "income_employment_validation_service": {"url": os.getenv("MCP_EMPLOYMENT_VALIDATOR", "http://mcp-employment-validator:8000") + "/sse", "transport": "sse"},
    "address_validation_service": {"url": os.getenv("MCP_ADDRESS_VALIDATOR", "http://mcp-address-validator:8000") + "/sse", "transport": "sse"},
}

app = FastAPI(title="Credit Underwriting Agent — Streaming")

system_prompt = """You are a credit underwriting AI assistant.
Today's date is 1st September 2024.
Always: (1) extract data via tools, (2) validate income/employment/address,
(3) call retrieve_loan_policies BEFORE deciding, (4) make a policy-grounded
decision that cites specific policy sections. Base decisions only on documented
financial criteria and fair-lending rules."""


async def _build_graph():
    client = MultiServerMCPClient(mcp_servers)
    tools = await client.get_tools()
    tools.append(retrieve_loan_policies)
    graph = create_react_agent(model, tools)
    callbacks = [langfuse_handler] if langfuse_handler else []
    return graph.with_config({
        "run_name": "credit_underwriting_agent_streaming",
        "callbacks": callbacks,
        "tags": ["loan-processing", "agent", "langgraph", "rag", "streaming"],
        "metadata": {"langfuse_session_id": "loan-buddy",
                     "langfuse_tags": ["loan-processing", "agent", "langgraph", "rag", "streaming"]},
        "recursion_limit": 25,
    })


@app.post("/api/process_credit_application_stream")
async def process_application_stream(image_file: UploadFile = File(...)):
    """Process a loan application with Server-Sent Events streaming."""
    image_bytes = await image_file.read()
    image_id = generate_256_bit_hex_key()
    store_object(encode_image(image_bytes), image_id)
    graph = await _build_graph()

    prompt = HumanMessage(content=f"""Process this credit application (Image_Id: {image_id}).
    Extract data, validate, retrieve policies, then give a policy-grounded decision
    with citations.""")
    inputs = {"messages": [prompt], "system": SystemMessage(content=system_prompt)}

    async def event_generator():
        try:
            async for event in graph.astream_events(inputs, version="v2"):
                kind = event["event"]
                if kind == "on_tool_start":
                    yield f"data: {json.dumps({'type': 'tool_start', 'tool': event['name']})}\n\n"
                elif kind == "on_tool_end":
                    yield f"data: {json.dumps({'type': 'tool_result', 'tool': event['name'], 'status': 'complete'})}\n\n"
                elif kind == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        yield f"data: {json.dumps({'type': 'token', 'content': content})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'image_id': image_id})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)[:200]})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


def _extract_json(content) -> str:
    """Return the JSON object text from the model's final message.

    The content may be a list of content blocks and may wrap the JSON in a
    Markdown fence, so take the text from the first '{' to the last '}'.
    """
    if isinstance(content, list):
        content = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
    text = content or ""
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if start != -1 and end > start else text


@app.post("/api/process_credit_application_with_upload")
async def process_application(image_file: UploadFile = File(...)):
    """Non-streaming endpoint (parity with v2).

    Asks the agent for a JSON decision matching CreditDecision and validates it
    with validate_and_format_decision(); invalid output becomes MANUAL_REVIEW.
    """
    image_bytes = await image_file.read()
    image_id = generate_256_bit_hex_key()
    store_object(encode_image(image_bytes), image_id)
    graph = await _build_graph()
    prompt = HumanMessage(content=f"Process credit application Image_Id: {image_id}. "
                                  "Retrieve policies and decide with citations. "
                                  "Reply with only a JSON object that conforms to this "
                                  f"JSON Schema:\n{json.dumps(CreditDecision.model_json_schema())}")
    inputs = {"messages": [prompt], "system": SystemMessage(content=system_prompt)}

    final_message = None
    async for s in graph.astream(inputs, stream_mode="values"):
        msg = s["messages"][-1]
        if isinstance(msg, AIMessage):
            final_message = msg.content

    decision = validate_and_format_decision(_extract_json(final_message))
    return {"status": "COMPLETED", "image_id": image_id,
            "credit_assessment": decision.model_dump(mode="json")}


@app.get("/api/health")
async def health():
    return {"status": "healthy", "service": "credit_underwriting_agent_streaming"}


if __name__ == "__main__":
    logger.info("Starting Credit Underwriting Agent (Streaming + Validation)...")
    uvicorn.run("credit-underwriting-agent-streaming:app", host="0.0.0.0", port=8080, reload=False)
