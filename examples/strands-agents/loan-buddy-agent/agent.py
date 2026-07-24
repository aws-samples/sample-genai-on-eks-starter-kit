#!/usr/bin/env python3
"""Loan Buddy — Strands SDK port (Alternative Stack: Kong + Arize + Strands).

This is the alternative-stack version of the Module 3 credit-underwriting agent.
Instead of LangChain/LangGraph + LiteLLM + Langfuse, it uses:

  - Strands Agents SDK          (agent orchestration; was LangGraph create_react_agent)
  - Kong AI Gateway  /loan-strands  ->  Amazon Bedrock   (was LiteLLM)
  - Arize AX (SaaS) OpenInference tracing                (was Langfuse)
  - The SAME 3 MCP tool servers (image / address / employment) over SSE.

Request path:
  client ── POST /api/process_credit_application_with_upload (image) ──▶ this agent
     agent ──▶ Kong /loan-strands (key-auth) ──(ai-proxy)──▶ Bedrock Claude 4.5 Sonnet
     agent ──▶ MCP tools (SSE)  extract / validate address / validate employment
     agent ──▶ OpenTelemetry (global provider = Arize AX)  project 'loan-strands'

Env:
  # LLM via Kong (required)
  KONG_BASE_URL       e.g. http://<kong-proxy-lb>/loan-strands   (no trailing /v1)
  KONG_API_KEY        the Kong consumer key sent as the 'apikey' header (default loan-strands-key-123)
  KONG_MODEL_ID       OpenAI-compat model id string (default: openai/bedrock-claude)
  # Arize AX (optional; tracing disabled if unset)
  ARIZE_API_KEY, ARIZE_SPACE_ID   (Service key + Space ID)
  ARIZE_PROJECT_NAME  (default: loan-strands)
  # MCP tool servers (SSE)
  MCP_IMAGE_PROCESSOR, MCP_ADDRESS_VALIDATOR, MCP_EMPLOYMENT_VALIDATOR
  # S3 (image storage; reused from the default agent's utils.py)
  S3_BUCKET_NAME, AWS_REGION
"""
import os
import logging

logger = logging.getLogger("loan-buddy-strands")
logging.basicConfig(level=logging.INFO)

# --- 1. Arize AX tracing (must be set up BEFORE importing strands) ----------
# Strands >=1.x emits its OWN native OpenTelemetry `gen_ai.*` spans (not the
# OpenInference schema). If we exported those raw, Arize would show the spans but
# with NO span kind (LLM/TOOL/AGENT) and an EMPTY Input/Output tab — the content
# lives in span events / attributes Arize can't map. The fix (Arize's official
# Strands recipe) is a span PROCESSOR that rewrites Strands' native spans into the
# OpenInference layout in-flight:
#
#   StrandsAgentsToOpenInferenceProcessor  (openinference-instrumentation-strands-agents)
#
# We build a TracerProvider, attach that processor + the Arize OTLP exporter, set it
# global, then point StrandsTelemetry at it. Result: proper AGENT/CHAIN/LLM/TOOL span
# kinds AND populated Input/Output in the Arize UI.
_TRACER_PROVIDER = None
_ARIZE_ENABLED = bool(os.environ.get("ARIZE_API_KEY") and os.environ.get("ARIZE_SPACE_ID"))
if _ARIZE_ENABLED:
    try:
        from opentelemetry import trace as _trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from openinference.instrumentation.strands_agents import StrandsAgentsToOpenInferenceProcessor

        _project = os.environ.get("ARIZE_PROJECT_NAME", "loan-strands")
        _resource = Resource.create(
            {"openinference.project.name": _project, "service.name": "loan-buddy-strands"}
        )
        _TRACER_PROVIDER = TracerProvider(resource=_resource)
        # (a) convert Strands' native gen_ai spans -> OpenInference (mutates in-place;
        #     must run BEFORE the exporter processor so the exporter sees the rewritten span)
        _TRACER_PROVIDER.add_span_processor(StrandsAgentsToOpenInferenceProcessor())
        # (b) export the (now OpenInference) spans to Arize over OTLP/gRPC
        _TRACER_PROVIDER.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(
                    endpoint="otlp.arize.com:443",
                    headers={
                        "api_key": os.environ["ARIZE_API_KEY"],
                        "arize-space-id": os.environ["ARIZE_SPACE_ID"],
                        "arize-interface": "python",
                    },
                )
            )
        )
        # StrandsTelemetry stores but does NOT globally register the provider, so set it
        # ourselves; Strands then emits into it automatically.
        _trace.set_tracer_provider(_TRACER_PROVIDER)
        from strands.telemetry import StrandsTelemetry

        StrandsTelemetry(tracer_provider=_TRACER_PROVIDER)
        logger.info("Arize AX tracing enabled (project=%s, OpenInference processor)", _project)
    except Exception as e:  # noqa: BLE001
        logger.warning("Arize AX tracing setup failed (%s); continuing without tracing", e)
        _ARIZE_ENABLED = False
        _TRACER_PROVIDER = None
else:
    logger.info("Arize AX env not set; tracing disabled")

# --- 2. Strands + FastAPI ----------------------------------------------------
from strands import Agent
from strands.models.litellm import LiteLLMModel
from strands.tools.mcp.mcp_client import MCPClient
from mcp.client.sse import sse_client

import uvicorn
from fastapi import FastAPI, UploadFile, File
from utils import store_object, encode_image, generate_256_bit_hex_key

# --- 3. Model: Bedrock via Kong /loan-strands --------------------------------
# LiteLLMModel treats the Kong route as an OpenAI-compatible endpoint. Kong's
# ai-proxy translates to Bedrock and (allow_override=false) injects the model,
# so KONG_MODEL_ID is just the OpenAI-compat routing string.
KONG_BASE_URL = os.environ.get("KONG_BASE_URL", "http://kong-proxy/loan-strands")
KONG_API_KEY = os.environ.get("KONG_API_KEY", "loan-strands-key-123")
# Must be the EXACT model the Kong ai-proxy route pins (allow_override=false),
# openai/-prefixed so litellm treats Kong as an OpenAI-compatible endpoint.
KONG_MODEL_ID = os.environ.get(
    "KONG_MODEL_ID", "openai/global.anthropic.claude-sonnet-4-5-20250929-v1:0"
)


def _sanitize_for_kong(messages):
    """Make Strands' OpenAI-format messages digestible by Kong's ai-proxy -> Bedrock.

    Two message shapes that Strands emits are rejected by Kong's OpenAI->Bedrock
    translation (both reproduced live against the /loan-strands route):

    1. ARRAY-FORM SYSTEM MESSAGE. ``LiteLLMModel`` wraps the system prompt in a content
       array (``{"role":"system","content":[{"type":"text",...}]}``) for Anthropic
       cache-points. Bedrock's ``system`` field wants a string; the array -> opaque
       ``400 {}``. (This is why a bare "say hi" worked but a system-prompted agent didn't.)

    2. EMPTY TEXT CONTENT BLOCKS. On an assistant turn that carries a tool call, Strands
       leaves an empty text block (``content:[{"type":"text","text":""}]``) after the
       toolUse is split out. Bedrock rejects it: "text content blocks must be non-empty".

    Fix both in one pass on the final request: drop empty text blocks, and collapse any
    all-text content array back to a plain string. Non-text blocks (images/documents) are
    preserved as arrays. A message left with neither content nor tool_calls is dropped.
    """
    out = []
    for m in messages:
        c = m.get("content")
        if isinstance(c, list):
            kept = [b for b in c if not (isinstance(b, dict) and b.get("type") == "text" and not b.get("text"))]
            if kept and all(isinstance(b, dict) and b.get("type") == "text" for b in kept):
                m = {**m, "content": "\n".join(b["text"] for b in kept)}
            elif kept:
                m = {**m, "content": kept}
            else:
                m = {k: v for k, v in m.items() if k != "content"}
        if "content" in m or "tool_calls" in m:
            out.append(m)
    return out


class KongLiteLLMModel(LiteLLMModel):
    """LiteLLMModel that post-processes the request so Kong's ai-proxy accepts it.

    See ``_sanitize_for_kong`` for the two Strands-vs-Kong incompatibilities this fixes.
    Verified end-to-end (streaming + multi-tool round-trips) against the live gateway.
    """

    def format_request(self, *args, **kwargs):
        request = super().format_request(*args, **kwargs)
        request["messages"] = _sanitize_for_kong(request["messages"])
        return request


model = KongLiteLLMModel(
    client_args={
        "base_url": f"{KONG_BASE_URL}/v1",
        "api_key": "unused",   # Kong injects Bedrock auth via IAM; a value is required by the client
    },
    # IMPORTANT (two Kong-specific requirements, both verified against the live gateway):
    # 1. AUTH HEADER: Kong's key-auth needs the 'apikey' header. On the openai/ provider,
    #    litellm forwards headers passed as the *completion param* `extra_headers` (NOT the
    #    client-init `default_headers`, which does not reach the upstream). So put it in params.
    # 2. MODEL NAME: the route's ai-proxy has allow_override=false and PINS the model, so the
    #    client must send the EXACT pinned Bedrock model id — sending 'bedrock-claude' (or any
    #    other) returns: "cannot use own model - must be: global.anthropic...". KONG_MODEL_ID
    #    must therefore be the openai/-prefixed exact id.
    model_id=KONG_MODEL_ID,
    params={
        "max_tokens": 5000,
        "temperature": 0,
        "extra_headers": {"apikey": KONG_API_KEY},
    },
)

# --- 4. MCP tool servers (same 3 services as the default agent, over SSE) -----
# MCP servers are deployed by the default Loan Buddy (Module 3) in the `workshop`
# namespace, listening on port 8000. Reference them cross-namespace via FQDN.
mcp_image_processor = os.getenv("MCP_IMAGE_PROCESSOR", "http://mcp-image-processor.workshop:8000")
mcp_address_validator = os.getenv("MCP_ADDRESS_VALIDATOR", "http://mcp-address-validator.workshop:8000")
mcp_employment_validator = os.getenv("MCP_EMPLOYMENT_VALIDATOR", "http://mcp-employment-validator.workshop:8000")

# NOTE: the default LangChain agent maps these URLs in a rotated order (a known
# quirk of that code). We map each MCP client to its correct service here.
MCP_ENDPOINTS = [
    f"{mcp_image_processor}/sse",
    f"{mcp_address_validator}/sse",
    f"{mcp_employment_validator}/sse",
]

SYSTEM_PROMPT = """You are a helpful AI assistant for credit underwriting and loan processing.

IMPORTANT: Today's date is 1st September 2024. Use this as your reference when evaluating dates on documents.

Your task is to process credit applications by analyzing uploaded documents and validating applicant
information using the tools provided. You will NOT have the image itself, instead an image_id which you
pass to the tools to extract information.

Follow these steps:
1. First, extract credit application data from the uploaded document using the image processing tools.
2. Then validate the extracted information using the income, employment, and address validation tools.
3. Make a final credit decision based on all validation results.
4. Present a comprehensive, structured credit assessment with your final recommendation (APPROVED / REJECTED / CONDITIONAL).

It is critical that you USE the tools. Pass the field 'image_id' to the tools; they fetch the image from S3.
"""

app = FastAPI(title="Loan Buddy (Strands) - Alternative Stack")

_mcp_clients = []


def _open_mcp_clients():
    """Open all MCP SSE clients and collect their tools."""
    clients, tools = [], []
    for url in MCP_ENDPOINTS:
        try:
            c = MCPClient(lambda u=url: sse_client(u))
            c.__enter__()
            clients.append(c)
            tools.extend(c.list_tools_sync())
        except Exception as e:  # noqa: BLE001
            logger.warning("MCP server %s unavailable: %s", url, e)
    return clients, tools


@app.post("/api/process_credit_application_with_upload")
async def process_credit_application_with_upload(image_file: UploadFile = File(...)):
    """Upload a loan-application image to S3, then process it with the Strands agent."""
    try:
        logger.info("🔄 Starting credit application processing (Strands)...")
        image_bytes = await image_file.read()
        credit_app_image = encode_image(image_bytes)
        image_id = generate_256_bit_hex_key()

        if not store_object(credit_app_image, image_id):
            return {"status": "ERROR", "message": "Failed to store image in S3"}
        logger.info("✅ Image stored in S3 with ID: %s", image_id)

        logger.info("🔧 Loading MCP tools...")
        clients, tools = _open_mcp_clients()
        logger.info("Available tools: %s", [getattr(t, "tool_name", getattr(t, "name", "?")) for t in tools])

        agent = Agent(
            model=model,
            system_prompt=SYSTEM_PROMPT,
            tools=tools,
            # trace_attributes surface in Arize for filtering/sessions
            trace_attributes={
                "session.id": "loan-buddy",
                "tag.tags": ["loan-processing", "agent", "strands"],
            },
        )

        user_prompt = f"""Please process this credit application and provide a comprehensive credit assessment.

Image_Id: {image_id}

Please:
1. Extract all applicant information from the document using the tools.
2. Verify employment and income information.
3. Verify address information.
4. Provide a final credit decision with reasoning.

Return a structured assessment with your recommendation."""

        logger.info("🤖 Processing with Strands agent...")
        result = agent(user_prompt)
        assessment = str(result)
        logger.info("Final credit assessment:\n%s", assessment)

        # Surface run signal (Strands best practice: monitor stop reason, token usage,
        # tool call counts). AgentResult carries metrics regardless of OTEL config.
        try:
            logger.info("stop_reason=%s", getattr(result, "stop_reason", "?"))
            if getattr(result, "metrics", None) is not None:
                logger.info("metrics summary: %s", result.metrics.get_summary())
        except Exception:  # noqa: BLE001
            pass

        # flush spans so short-lived requests don't lose the trace (BatchSpanProcessor
        # buffers; without a flush a fast request can return before the batch is sent)
        if _ARIZE_ENABLED and _TRACER_PROVIDER is not None:
            try:
                _TRACER_PROVIDER.force_flush()
            except Exception:  # noqa: BLE001
                pass

        for c in clients:
            try:
                c.__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass

        return {
            "status": "COMPLETED",
            "image_id": image_id,
            "credit_assessment": assessment,
            "processing_note": "Strands agent via Kong->Bedrock; traced in Arize AX",
        }
    except Exception as e:  # noqa: BLE001
        logger.error("Error processing credit application: %s", e)
        return {"status": "ERROR", "message": str(e)}


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "loan-buddy-strands", "arize": _ARIZE_ENABLED}


if __name__ == "__main__":
    logger.info("Starting Loan Buddy (Strands) - Alternative Stack on :8080")
    uvicorn.run("agent:app", host="0.0.0.0", port=8080, reload=False)
