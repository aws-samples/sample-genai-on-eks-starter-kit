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
from fastapi import FastAPI, UploadFile, File, Form, Request
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


def _split_parallel_tool_calls(messages):
    """Split any PARALLEL tool-call turn into sequential single-tool turns.

    Kong's ai-proxy (Operator 2.x / kong-gateway 3.x) does not correctly translate an
    assistant turn that carries MULTIPLE ``tool_calls`` (it fails to group the parallel
    tool-results into a single Bedrock Converse ``user`` turn) → Bedrock rejects the
    request with "request body doesn't contain valid inputs". Claude Sonnet 4.5 emits
    parallel tool calls and ignores ``parallel_tool_calls: false`` through the gateway,
    so we normalize the request instead::

        assistant[text, tcA, tcB] + tool(A) + tool(B)
          ->  assistant[text, tcA] + tool(A) + assistant[tcB] + tool(B)

    Every assistant turn then has exactly one ``toolUse`` immediately followed by its
    ``toolResult`` — an alternating sequence Kong translates cleanly. Single-tool turns
    (and turns with no tool calls) pass through untouched.
    """
    result_by_id = {m.get("tool_call_id"): m for m in messages
                    if m.get("role") == "tool" and m.get("tool_call_id")}
    consumed, out = set(), []
    for m in messages:
        if m.get("role") == "tool":
            if id(m) not in consumed:
                out.append(m)
            continue
        tcs = m.get("tool_calls") or []
        if m.get("role") == "assistant" and len(tcs) > 1:
            for i, tc in enumerate(tcs):
                turn = {"role": "assistant", "tool_calls": [tc]}
                if i == 0 and m.get("content"):
                    turn["content"] = m["content"]
                out.append(turn)
                res = result_by_id.get(tc.get("id"))
                if res is not None:
                    out.append(res)
                    consumed.add(id(res))
        else:
            out.append(m)
    return out


class KongLiteLLMModel(LiteLLMModel):
    """LiteLLMModel that post-processes the request so Kong's ai-proxy accepts it.

    See ``_sanitize_for_kong`` (system-message / empty-text fixes) and
    ``_split_parallel_tool_calls`` (parallel tool-call fix) for the Strands-vs-Kong
    incompatibilities this handles.

    Validation: the ``_sanitize_for_kong`` (header/JPEG/system-message) path was
    confirmed live earlier. The ``_split_parallel_tool_calls`` path was
    additionally exercised end-to-end against the live Kong -> Bedrock gateway on a
    fresh event (2026-08-24): loan applications processed to completion through
    multi-tool cycles that include parallel tool calls in a single assistant turn.
    """

    def format_request(self, *args, **kwargs):
        request = super().format_request(*args, **kwargs)
        request["messages"] = _split_parallel_tool_calls(_sanitize_for_kong(request["messages"]))
        return request


def _build_model(api_key: str = KONG_API_KEY) -> KongLiteLLMModel:
    """Build a KongLiteLLMModel with the given API key for per-request consumer identity."""
    return KongLiteLLMModel(
        client_args={
            "base_url": f"{KONG_BASE_URL}/v1",
            "api_key": "unused",
        },
        model_id=KONG_MODEL_ID,
        params={
            "max_tokens": 5000,
            "temperature": 0,
            # Force ONE tool call per turn. Kong's ai-proxy (Operator 2.x / kong-gateway
            # 3.x) does not correctly group the tool-results of a PARALLEL tool-call turn
            # into a single Bedrock Converse user turn, so a multi-tool assistant turn ->
            # "request body doesn't contain valid inputs". Sequential calls (1 toolUse ->
            # 1 toolResult per turn) translate cleanly.
            "parallel_tool_calls": False,
            "extra_headers": {"apikey": api_key},
        },
    )


# Default model (backward compatible — uses KONG_API_KEY env var)
model = _build_model()

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
async def process_credit_application_with_upload(
    request: Request,
    image_file: UploadFile = File(...),
    consumer_id: str = Form(default=None),
    consumer_apikey: str = Form(default=None),
):
    """Upload a loan-application image to S3, then process it with the Strands agent.

    Multi-tenant identity (sent as HTTP headers OR form fields):
      X-Consumer-ID / consumer_id: Identity for Arize user.id (e.g., "fraud-detection-team")
      X-Consumer-ApiKey / consumer_apikey: Kong API key (e.g., "fraud-team-key-456")
    If not provided, falls back to deployment-level env vars (KONG_API_KEY, SERVICE_CONSUMER_ID).
    """
    try:
        resolved_consumer = (
            request.headers.get("x-consumer-id")
            or consumer_id
            or os.environ.get("SERVICE_CONSUMER_ID", "loan-strands-agent")
        )
        resolved_apikey = (
            request.headers.get("x-consumer-apikey")
            or consumer_apikey
            or KONG_API_KEY
        )
        logger.info("🔄 Starting credit application processing (consumer=%s)...", resolved_consumer)

        image_bytes = await image_file.read()
        # Normalize the upload to JPEG so it matches the image-processor MCP's
        # `data:image/jpeg` content type. Bedrock's vision API rejects an image whose
        # declared media type does not match the actual bytes (e.g. a PNG labeled as
        # JPEG) with "request body doesn't contain valid inputs".
        try:
            from io import BytesIO
            from PIL import Image
            _buf = BytesIO()
            Image.open(BytesIO(image_bytes)).convert("RGB").save(_buf, format="JPEG", quality=90)
            image_bytes = _buf.getvalue()
        except Exception as _e:  # pragma: no cover - fall back to original bytes
            logger.warning("Could not normalize image to JPEG (%s); storing original bytes", _e)
        credit_app_image = encode_image(image_bytes)
        image_id = generate_256_bit_hex_key()

        if not store_object(credit_app_image, image_id):
            return {"status": "ERROR", "message": "Failed to store image in S3"}
        logger.info("✅ Image stored in S3 with ID: %s", image_id)

        logger.info("🔧 Loading MCP tools...")
        clients, tools = _open_mcp_clients()
        logger.info("Available tools: %s", [getattr(t, "tool_name", getattr(t, "name", "?")) for t in tools])

        request_model = _build_model(resolved_apikey) if resolved_apikey != KONG_API_KEY else model

        agent = Agent(
            model=request_model,
            system_prompt=SYSTEM_PROMPT,
            tools=tools,
            trace_attributes={
                "session.id": f"loan-application-{image_id}",
                "user.id": resolved_consumer,
                "tag.tags": ["loan-processing", "credit-underwriting", "strands", "production"],
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
            "consumer": resolved_consumer,
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
