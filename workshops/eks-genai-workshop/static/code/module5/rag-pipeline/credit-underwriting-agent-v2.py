# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# Credit Underwriting Agent v2 — RAG-enhanced (Module 5)
#
# Builds on the Module 3 agent (credit-underwriting-agent.py) by adding a
# Retrieval-Augmented Generation (RAG) tool. Before making a decision the agent
# retrieves the relevant loan-policy sections from Milvus (vectors created with
# Bedrock Titan embeddings) so every decision is grounded in — and cites —
# documented policy.
#
# What changed vs Module 3:
#   * New `retrieve_loan_policies` tool (Milvus similarity search).
#   * The tool is merged with the existing MCP tools given to the agent.
#   * System prompt requires policy retrieval + citations before any decision.
#   * Langfuse run_name is `credit_underwriting_agent_v2` so RAG traces are
#     distinguishable from Module 3 traces.
from dotenv import load_dotenv
load_dotenv()

from langchain_mcp_adapters.client import MultiServerMCPClient
# create_react_agent is deprecated in LangGraph v1 (replacement: langchain.agents.create_agent).
# It still works; the workshop keeps it and does not migrate.
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

import uvicorn
from fastapi import FastAPI, UploadFile, File
import os
import logging

# Configure logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

LANGFUSE_AVAILABLE = True
try:
    from langfuse.langchain import CallbackHandler
    LANGFUSE_AVAILABLE = True
    logger.info("Successfully imported Langfuse CallbackHandler from langfuse.langchain")
except ImportError:
    try:
        from langfuse.callback import CallbackHandler
        LANGFUSE_AVAILABLE = True
        logger.info("Successfully imported Langfuse CallbackHandler from langfuse.callback")
    except ImportError:
        logger.info("Warning: Langfuse not available. Tracing will be disabled.")
        LANGFUSE_AVAILABLE = False
        CallbackHandler = None

from utils import store_object, encode_image, generate_256_bit_hex_key

# RAG dependencies. We use Bedrock for embeddings and the native pymilvus
# MilvusClient for retrieval. MilvusClient is the supported pymilvus 2.6 API and
# — unlike langchain-milvus 0.3.x — does not pull in an incompatible
# langchain-core that would break the MCP adapters already in the image.
from langchain_aws import BedrockEmbeddings
from pymilvus import MilvusClient

# Model configuration
model_key = os.environ.get("GATEWAY_MODEL_ACCESS_KEY", "")
api_gateway_url = os.environ.get("GATEWAY_URL", "")

# RAG configuration
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
MILVUS_URI = os.environ.get("MILVUS_URI", "http://milvus.milvus.svc.cluster.local:19530")
COLLECTION = "loan_policies"

# Initialize Langfuse CallbackHandler for Langchain (tracing) - optional
logger.info("Initializing Langfuse CallbackHandler...")
langfuse_handler = None
if LANGFUSE_AVAILABLE:
    langfuse_url = os.environ.get("LANGFUSE_URL", "")
    local_public_key = os.environ.get("LANGFUSE_PUBLIC_KEY", "")
    local_secret_key = os.environ.get("LANGFUSE_SECRET_KEY", "")

    if langfuse_url and local_public_key and local_secret_key:
        os.environ["LANGFUSE_SECRET_KEY"] = local_secret_key
        os.environ["LANGFUSE_HOST"] = langfuse_url
        os.environ["LANGFUSE_PUBLIC_KEY"] = local_public_key

        try:
            langfuse_handler = CallbackHandler()
            logger.info("Langfuse tracing enabled")
        except Exception as e:
            logger.info(f"Warning: Could not initialize Langfuse: {e}")
            langfuse_handler = None
    else:
        logger.info("Langfuse configuration incomplete - tracing disabled")
else:
    logger.info("Langfuse tracing disabled - module not available")

# Configure LLM (routed through LiteLLM gateway, same as Module 3)
# "claude-4.5-sonnet" is a legacy alias label defined by the starter kit config.workshop.json.
# The LiteLLM gateway routes it to Claude Sonnet 5.5 (global.anthropic.claude-sonnet-5-5).
llm_model = os.environ.get("AGENT_MODEL", "bedrock/claude-4.5-sonnet")

model = ChatOpenAI(
    model=llm_model,
    temperature=0,
    api_key=model_key,
    base_url=api_gateway_url,
    max_tokens=5000,
    timeout=300,
)

# Embeddings + Milvus client are created once and reused across requests.
embeddings = BedrockEmbeddings(
    model_id="amazon.titan-embed-text-v2:0",
    region_name=AWS_REGION,
)
milvus_client = MilvusClient(uri=MILVUS_URI)


@tool
def retrieve_loan_policies(query: str) -> str:
    """Retrieve relevant loan policy sections from the vector database.

    Use this BEFORE making any credit decision. Pass a natural-language query
    describing the application (e.g. "home improvement loan $8,500 credit 720").
    Returns the most relevant policy passages, each tagged with its source file.
    """
    try:
        query_vector = embeddings.embed_query(query)
        results = milvus_client.search(
            collection_name=COLLECTION,
            data=[query_vector],
            limit=3,
            output_fields=["text", "source"],
        )
        hits = results[0] if results else []
        if not hits:
            return "No matching loan policies found."

        def _source(hit) -> str:
            # langchain_milvus may store metadata at the top level or nested
            # under "$meta" depending on the installed version, so read both.
            entity = hit.get("entity", {})
            return (
                entity.get("source")
                or entity.get("$meta", {}).get("source")
                or "unknown"
            )

        return "\n\n".join(
            f"[Policy: {_source(hit)}]\n{hit['entity'].get('text', '')}"
            for hit in hits
        )
    except Exception as e:  # pragma: no cover - surfaced to the agent as tool output
        logger.error(f"RAG retrieval failed: {e}")
        return f"Policy retrieval error: {e}"


# MCP Servers configuration (same wiring as Module 3)
mcp_address_validator = os.getenv("MCP_ADDRESS_VALIDATOR", "http://mcp-address-validator:5300")
mcp_employment_validator = os.getenv("MCP_EMPLOYMENT_VALIDATOR", "http://mcp-employment-validator:5200")
mcp_image_processor = os.getenv("MCP_IMAGE_PROCESSOR", "http://mcp-image-processor:8400")

mcp_servers = {
    "image_processor": {"url": mcp_image_processor + "/sse", "transport": "sse"},
    "income_employment_validation_service": {"url": mcp_employment_validator + "/sse", "transport": "sse"},
    "address_validation_service": {"url": mcp_address_validator + "/sse", "transport": "sse"},
}

app = FastAPI(title="Credit Underwriting Agent v2 (RAG-enhanced)")

system_prompt = """You are a credit underwriting AI assistant for loan processing.

IMPORTANT: Today's date is 1st September 2024. Use this as your reference when
evaluating dates on documents.

You will not receive the raw image — you receive an image_id which you pass to the
MCP tools to extract and validate applicant information.

Follow these steps for every application:
1. Extract credit application data from the document using the image processing tools.
2. Validate income, employment, and address using the validation tools.
3. ALWAYS call `retrieve_loan_policies` to fetch the relevant policy sections
   BEFORE making a decision. Query it with the loan type, amount, credit score,
   and DTI so you retrieve the right policy.
4. Make a final credit decision (APPROVED / REJECTED / MANUAL_REVIEW) that is
   grounded in the retrieved policies. Your decision MUST cite the specific
   policy sections (by source file and section) that justify it.

Base every decision solely on documented financial criteria, consistent with the
retrieved policies and fair-lending requirements. Provide a clear, structured
credit assessment with explicit policy references.
"""


@app.post("/api/process_credit_application_with_upload")
async def process_credit_application_with_upload(image_file: UploadFile = File(...)):
    """Process a credit application (RAG-enhanced) from an uploaded image."""
    try:
        logger.info("🔄 Starting RAG-enhanced credit application processing...")

        image_bytes = await image_file.read()
        credit_app_image = encode_image(image_bytes)
        image_id = generate_256_bit_hex_key()

        if not store_object(credit_app_image, image_id):
            return {"status": "ERROR", "message": "Failed to store image in S3"}
        logger.info(f"✅ Image stored in S3 with ID: {image_id}")

        # Load MCP tools, then append the RAG retrieval tool.
        client = MultiServerMCPClient(mcp_servers)
        tools = await client.get_tools()
        tools.append(retrieve_loan_policies)
        logger.info(f"Available tools: {[t.name for t in tools]}")

        # Pass the system prompt at construction. create_react_agent ignores a
        # top-level "system" key in the invoke input, so the prompt must be wired
        # in here or it is silently dropped.
        # create_react_agent is deprecated in LangGraph v1 (replacement:
        # langchain.agents.create_agent). It still works; the workshop keeps it.
        graph = create_react_agent(model, tools, prompt=system_prompt, debug=True)

        callbacks = []
        if langfuse_handler is not None:
            callbacks.append(langfuse_handler)

        graph = graph.with_config({
            "run_name": "credit_underwriting_agent_v2",
            "callbacks": callbacks,
            "tags": ["loan-processing", "agent", "langgraph", "rag"],
            "metadata": {
                "langfuse_session_id": "loan-buddy",
                "langfuse_tags": ["loan-processing", "agent", "langgraph", "rag"],
            },
            "recursion_limit": 25,
        })

        user_prompt_with_id = HumanMessage(content=f"""
        Please process this credit application and provide a comprehensive,
        policy-grounded credit assessment.

        Image_Id: {image_id}

        Steps:
        1. Extract all applicant information from the document using the tools.
        2. Verify employment, income, and address.
        3. Retrieve the relevant loan policies with `retrieve_loan_policies`.
        4. Provide a final credit decision that cites the specific policy sections.
        """)

        # The system prompt is supplied via create_react_agent(prompt=...) above.
        inputs = {
            "messages": [user_prompt_with_id],
        }

        logger.info("🤖 Processing credit application with RAG-enhanced agent...")

        final_message = None
        try:
            async for s in graph.astream(inputs, stream_mode="values"):
                message = s["messages"][-1]
                if not isinstance(message, tuple):
                    message.pretty_print()
                if isinstance(message, AIMessage):
                    final_message = message.content
        except Exception as e:
            if "RateLimitError" in str(e) or "429" in str(e):
                logger.warning(f"Rate limit encountered: {e}")
                return {"status": "RATE_LIMITED", "image_id": image_id}
            raise e

        return {
            "status": "COMPLETED",
            "image_id": image_id,
            "credit_assessment": final_message,
            "processing_note": "RAG-enhanced: decision grounded in retrieved loan policies",
        }

    except Exception as e:
        logger.error(f"Error processing credit application: {e}")
        return {"status": "ERROR", "message": "An error occurred while processing your application"}


@app.get("/api/policies")
async def test_policy_retrieval(query: str = "home improvement loan requirements"):
    """Diagnostic endpoint: run a raw RAG retrieval without the full agent."""
    result = retrieve_loan_policies.invoke({"query": query})
    return {"query": query, "retrieved": result}


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "credit_underwriting_agent_v2"}


if __name__ == "__main__":
    logger.info("Starting Credit Underwriting Agent v2 (RAG-enhanced)...")
    uvicorn.run("credit-underwriting-agent-v2:app", host="0.0.0.0", port=8080, reload=False)
