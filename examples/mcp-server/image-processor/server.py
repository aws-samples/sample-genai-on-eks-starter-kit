"""
MCP Server for Image Processing — Track B (Kong-native, no LiteLLM).

Same two tools as the shared Track A image-processor
(extract_credit_application_data, validate_document_authenticity), but the vision
call is sent to **Amazon Bedrock's Converse API through the Kong AI Gateway** using
Kong's native pass-through (`llm_format: bedrock`) instead of the OpenAI-format
LiteLLM call.

Why: Kong's OpenAI-format path (`ai-proxy` / `ai-proxy-advanced` with the default
`llm_format: openai`) does NOT translate an OpenAI `image_url` block into a Bedrock
`image` block, so multimodal image input fails. Kong's **native** path DOES support
it: we send a native Bedrock Converse payload (with a real `image` block) to the
`/converse` endpoint of a `llm_format: bedrock` route, and Kong signs to Bedrock with
the DataPlane's IAM role (no AWS keys, no LiteLLM key).

Env:
  KONG_VISION_URL   base URL of the Kong native-Bedrock route, e.g.
                    http://<kong-proxy-lb>/vision  (this server appends /converse)
  S3_BUCKET_NAME, AWS_REGION   used by utils.py to fetch the uploaded image
"""

from fastapi import FastAPI
import base64
import uvicorn
from pydantic import BaseModel
from PIL import Image
import io
import logging
import os
import json
import secrets
import urllib.request
import urllib.error

from mcp.server.fastmcp import FastMCP
from utils import load_object, load_image_bytes, encode_image_from_bytes

# Initialize MCP server
mcp = FastMCP("Image-Processor", host="0.0.0.0", port=8000)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Kong AI Gateway native-Bedrock route (see examples/mcp-server/image-processor/README
# or B3 "Deploy the Kong Bedrock vision route"). No key: the Kong DataPlane reaches
# Bedrock via its Pod Identity IAM role.
KONG_VISION_URL = os.environ.get("KONG_VISION_URL", "").rstrip("/")


def _kong_vision(system_prompt: str, user_prompt: str, base64_image: str,
                 max_tokens: int = 8000, temperature: float = 0.1) -> str:
    """Call Bedrock's Converse API THROUGH Kong (native pass-through, llm_format: bedrock).

    The image is sent as a native Bedrock `image` content block (base64 JPEG bytes),
    NOT an OpenAI `image_url` — that is the shape Kong forwards unchanged to Bedrock's
    /converse. Returns the assistant's text.
    """
    if not KONG_VISION_URL:
        raise RuntimeError("KONG_VISION_URL is not set")
    payload = {
        "system": [{"text": system_prompt}],
        "messages": [{
            "role": "user",
            "content": [
                {"text": user_prompt},
                {"image": {"format": "jpeg", "source": {"bytes": base64_image}}},
            ],
        }],
        "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature},
    }
    req = urllib.request.Request(
        f"{KONG_VISION_URL}/converse",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    # Bedrock Converse response: output.message.content[].text
    return data["output"]["message"]["content"][0]["text"]


@mcp.tool(
    name="extract_credit_application_data",
    description="Extract credit application data from an image. Takes an image_id parameter and returns structured JSON with applicant information including name, email, income, employer, address, and loan amount."
)
async def extract_credit_application_data(image_id: str) -> str:
    """
    Extract credit application data from image stored in S3

    Args:
        image_id: Unique identifier for the image in S3

    Returns:
        str: JSON string containing extracted credit application data
    """
    logger.info("**************** Extract Credit Application Data Tool (Kong-native) ****************")

    try:
        # Load image from S3 using the base64 content method (for backward compatibility)
        base64_image = load_object(image_id)

        if not base64_image:
            # Try loading as image bytes if base64 method fails
            image_bytes = load_image_bytes(image_id)
            if image_bytes:
                base64_image = encode_image_from_bytes(image_bytes)
            else:
                return json.dumps({
                    "error": "Image not found",
                    "image_id": image_id,
                    "status": "failed"
                })

        # System prompt for credit application data extraction
        extraction_system_prompt = """You are an expert in extracting credit application data from images.

        IMPORTANT: Today's date is 1st September 2024. Use this as your reference when evaluating dates on documents.

        Extract ONLY the following data from this credit application image and return it in JSON format:
        {
            "name": "full name of applicant",
            "email": "email address",
            "income": annual_income_as_number,
            "employer": "company name",
            "job_title": "job title",
            "employment_years": years_as_number,
            "address": "street address",
            "city": "city name",
            "state": "state abbreviation",
            "zip": "zip code",
            "loan_amount": loan_amount_as_number,
            "loan_purpose": "purpose of loan",
            "ssn_last_4": "last 4 digits of SSN if visible"
        }

        Important instructions:
        - Return ONLY valid JSON, no other text
        - Use null for missing fields
        - Convert numeric values to numbers, not strings
        - Be precise and accurate
        """

        user_prompt = "Extract all credit application data from this image and return as JSON."

        # Vision call via Kong AI Gateway -> Bedrock Converse (native pass-through)
        extracted_content = _kong_vision(extraction_system_prompt, user_prompt, base64_image)
        # Do NOT log the extracted content at INFO — it contains applicant PII
        # (name, email, SSN last-4, income, address). Log only a safe summary; the
        # full content stays at DEBUG for troubleshooting.
        logger.info(f"Extracted credit application data ({len(extracted_content)} chars)")
        logger.debug(f"Extracted credit application data: {extracted_content}")

        # Validate JSON response
        try:
            # Try to parse as JSON to validate
            parsed_data = json.loads(extracted_content)
            return extracted_content
        except json.JSONDecodeError:
            # If not valid JSON, try to extract JSON from the response
            import re
            json_match = re.search(r'\{.*\}', extracted_content, re.DOTALL)
            if json_match:
                json_content = json_match.group()
                # Validate the extracted JSON
                json.loads(json_content)
                return json_content
            else:
                # Return error if no valid JSON found
                return json.dumps({
                    "error": "Could not extract valid JSON from image",
                    "raw_response": extracted_content,
                    "image_id": image_id,
                    "status": "failed"
                })

    except Exception as e:
        logger.error(f"Error extracting credit application data: {e}")
        return json.dumps({
            "error": str(e),
            "image_id": image_id,
            "status": "failed"
        })


@mcp.tool(
    name="validate_document_authenticity",
    description="Validate the authenticity of a credit application document. Takes an image_id parameter and returns validation results including document quality, completeness, and potential fraud indicators."
)
async def validate_document_authenticity(image_id: str) -> str:
    """
    Validate document authenticity and quality

    Args:
        image_id: Unique identifier for the image in S3

    Returns:
        str: JSON string containing document validation results
    """
    logger.info("**************** Validate Document Authenticity Tool (Kong-native) ****************")

    try:
        # Load image from S3
        base64_image = load_object(image_id)

        if not base64_image:
            # Try loading as image bytes if base64 method fails
            image_bytes = load_image_bytes(image_id)
            if image_bytes:
                base64_image = encode_image_from_bytes(image_bytes)
            else:
                return json.dumps({
                    "error": "Image not found",
                    "image_id": image_id,
                    "status": "failed"
                })

        # System prompt for document validation
        validation_system_prompt = """You are an expert in document authenticity validation for credit applications.

        IMPORTANT: Today's date is 1st September 2024. Use this as your reference when evaluating dates on documents. Any dates before today are in the past and should not be flagged as future dates.

        Analyze this credit application document and return validation results in JSON format:
        {
            "document_quality": "excellent|good|fair|poor",
            "completeness_score": score_0_to_100,
            "required_fields_present": ["list", "of", "present", "fields"],
            "missing_fields": ["list", "of", "missing", "fields"],
            "fraud_indicators": ["list", "of", "potential", "fraud", "signs"],
            "authenticity_score": score_0_to_100,
            "recommendation": "ACCEPT|REVIEW|REJECT",
            "notes": "additional observations"
        }

        Look for:
        - Document clarity and quality
        - Presence of required fields (name, income, employer, address, etc.)
        - Signs of tampering or alteration
        - Consistency in fonts and formatting
        - Logical data relationships
        - Do NOT flag dates before September 1, 2024 as future dates

        Return ONLY valid JSON, no other text.
        """

        user_prompt = "Validate the authenticity and quality of this credit application document."

        # Vision call via Kong AI Gateway -> Bedrock Converse (native pass-through)
        validation_content = _kong_vision(validation_system_prompt, user_prompt, base64_image)
        # Summary only at INFO (the content may echo applicant details); full at DEBUG.
        logger.info(f"Document validation complete ({len(validation_content)} chars)")
        logger.debug(f"Document validation results: {validation_content}")

        # Validate JSON response
        try:
            # Try to parse as JSON to validate
            parsed_data = json.loads(validation_content)
            return validation_content
        except json.JSONDecodeError:
            # If not valid JSON, try to extract JSON from the response
            import re
            json_match = re.search(r'\{.*\}', validation_content, re.DOTALL)
            if json_match:
                json_content = json_match.group()
                # Validate the extracted JSON
                json.loads(json_content)
                return json_content
            else:
                # Return error if no valid JSON found
                return json.dumps({
                    "error": "Could not extract valid JSON from validation",
                    "raw_response": validation_content,
                    "image_id": image_id,
                    "status": "failed"
                })

    except Exception as e:
        logger.error(f"Error validating document authenticity: {e}")
        return json.dumps({
            "error": str(e),
            "image_id": image_id,
            "status": "failed"
        })


if __name__ == "__main__":
    print("Starting Image Processor MCP Server (Kong-native vision) on port 8000...")
    mcp.run(transport="sse")
