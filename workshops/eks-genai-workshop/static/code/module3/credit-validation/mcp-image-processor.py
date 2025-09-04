"""
MCP Server for Image Processing
This server handles image processing tasks including:
1. Loading images from S3 using image_id
2. Encoding images to base64
3. Extracting information from images using LLM
4. Returning structured JSON responses
"""

from fastapi import FastAPI
import base64
import uvicorn
import openai
from pydantic import BaseModel
from PIL import Image
import io
import logging
import os
from langchain_openai import ChatOpenAI
import json
import secrets


from mcp.server.fastmcp import FastMCP
from utils import load_object, load_image_bytes, encode_image_from_bytes

# Initialize MCP server
mcp = FastMCP("Image-Processor", host="0.0.0.0", port=8000)

logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Model configuration
model_key = os.environ.get("GATEWAY_MODEL_ACCESS_KEY", "")
api_gateway_url = os.environ.get("GATEWAY_URL", "")

# Vision model configuration
vision_model = "bedrock/claude-3.7-sonnet"
client = openai.OpenAI(
    api_key=model_key,            
    base_url=api_gateway_url 
)





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
    logger.info("**************** Extract Credit Application Data Tool ****************")
    
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
        
        # Make API call to vision model
        response = client.chat.completions.create(
            model=vision_model,
            messages=[
                {
                    "role": "system",
                    "content": extraction_system_prompt,
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": user_prompt,
                        },                        
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=8000,
            temperature=0.1
        )    

        extracted_content = response.choices[0].message.content
        logger.info(f"Extracted credit application data: {extracted_content}")
        
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
    logger.info("**************** Validate Document Authenticity Tool ****************")
    
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
        
        Return ONLY valid JSON, no other text.
        """
        
        user_prompt = "Validate the authenticity and quality of this credit application document."
        
        # Make API call to vision model
        response = client.chat.completions.create(
            model=vision_model,
            messages=[
                {
                    "role": "system",
                    "content": validation_system_prompt,
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": user_prompt,
                        },                        
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=8000,
            temperature=0.1
        )    

        validation_content = response.choices[0].message.content
        logger.info(f"Document validation results: {validation_content}")
        
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
    print("Starting Image Processor MCP Server on port 8000...")
    mcp.run(transport="sse")
