# Credit Underwriting Agent for Credit Score Validation - Updated with Image ID Support
# https://python.langchain.com/docs/how_to/migrate_agent/
from dotenv import load_dotenv
load_dotenv()

from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain_openai import ChatOpenAI
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query, UploadFile, File
import os
from mcp import ClientSession
import asyncio
from langchain_core.prompts import ChatPromptTemplate
import base64
import time
import secrets
import json
from PIL import Image
import io
from utils import generate_256_bit_hex_key
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
        # Try the old import path as fallback
        from langfuse.callback import CallbackHandler
        LANGFUSE_AVAILABLE = True
        logger.info("Successfully imported Langfuse CallbackHandler from langfuse.callback")
    except ImportError:
        logger.info("Warning: Langfuse not available. Tracing will be disabled.")
        LANGFUSE_AVAILABLE = False
        CallbackHandler = None
from utils import store_object, encode_image




# Model configuration
model_key = os.environ.get("GATEWAY_MODEL_ACCESS_KEY", "")
api_gateway_url = os.environ.get("GATEWAY_URL", "")

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

# Configure LLM with token limits to avoid rate limiting
llm_model = "bedrock/claude-3.7-sonnet"

model = ChatOpenAI(
    model=llm_model, 
    temperature=0, 
    api_key=model_key, 
    base_url=api_gateway_url,
    max_tokens=5000,  # Limit response tokens
    timeout=300       # Add timeout
)

# MCP Servers configuration for credit underwriting with image processing
mcp_address_validator = os.getenv("MCP_ADDRESS_VALIDATOR", "http://mcp-address-validator:5300")
mcp_employment_validator = os.getenv("MCP_EMPLOYMENT_VALIDATOR", "http://mcp-employment-validator:5200")
mcp_image_processor = os.getenv("MCP_IMAGE_PROCESSOR", "http://mcp-image-processor:8400")

mcp_servers = {
    "image_processor": {
        "url": mcp_address_validator + "/sse",  # Image processing server
        "transport": "sse",
    },
    "income_employment_validation_service": {
        "url": mcp_employment_validator + "/sse",  # Income and employment validation server
        "transport": "sse",
    },
    "address_validation_service": {
        "url": mcp_image_processor + "/sse",  # Address validation server
        "transport": "sse",
    }
}

app = FastAPI(title="Credit Underwriting Agent with Image ID Support")

# You are given a set of MCP tools to perform these tasks:
# - Use 'extract_credit_application_data' to extract applicant information from documents
# - Use 'validate_document_authenticity' to check document quality and authenticity
# - Use 'validate_income_employment' to verify employment and income information
# - Use 'validate_address' to verify address information

# System prompt for the agent - updated for image ID workflow
system_prompt = """You are a helpful AI assistant for credit underwriting and loan processing.

Your task is to process credit applications by analyzing uploaded documents and validating applicant information using the tools provided. You will not have the image, instead an image_id which you will then pass to the tools to extract information.


Follow these instructions:
1. First, extract credit application data from the uploaded document using the image processing tools
2. Then validate the extracted information using income, employment and address validation tools
3. Make a final credit decision based on all validation results
4. Present a comprehensive credit assessment to the user

It is critical that you use the tools to process the document and validate the information.
You just need to pass the field 'image_id' to the tools, they will handle fetching the image from S3.

Always provide a clear, structured response with your final recommendation.
"""

# Credit application processing prompt - SIMPLIFIED to reduce tokens
user_prompt = """Process this credit application using the provided image ID. Extract key info: Name, Email, Income, Employer, Address, Loan Amount. 
Validate income, employment and address using tools. Return JSON with APPROVED/REJECTED decision."""


@app.post("/api/process_credit_application_with_upload")
async def process_credit_application_with_upload(image_file: UploadFile = File(...)):
    """
    Process credit application with uploaded image file
    This endpoint uploads the image to S3 and processes it using image ID
    """
    
    try:
        logger.info("🔄 Starting credit application processing with uploaded image...")
        
        # Step 1: Read and process the uploaded image
        logger.info("📄 Processing uploaded credit application image...")
        image_bytes = await image_file.read()
        
        # Encode image to base64 for storage
        credit_app_image = encode_image(image_bytes)
        
        # Generate unique image ID
        image_id = generate_256_bit_hex_key()
        
        # Store image in S3
        if not store_object(credit_app_image, image_id):
            return {
                "status": "ERROR",
                "message": "Failed to store image in S3",
                "recommendation": "Please try again"
            }
        
        logger.info(f"✅ Image stored in S3 with ID: {image_id}")
        
        # Step 2: Use MCP client to get tools and process the application
        logger.info("🔧 Loading MCP tools...")
        client = MultiServerMCPClient(mcp_servers)
        tools = await client.get_tools()
        
        logger.info(f"Available tools: {[tool.name for tool in tools]}")
        
        # Create the agent with tools
        graph = create_react_agent(model, tools, debug=True)
        
        # Configure callbacks - only include langfuse if available
        callbacks = []
        if langfuse_handler is not None:
            callbacks.append(langfuse_handler)
        
        graph = graph.with_config({
            "run_name": "credit_underwriting_agent_with_image_id",
            "callbacks": callbacks,
            "recursion_limit": 20,
        })
        
        # Create user prompt with image ID
        user_prompt_with_id = HumanMessage(content=f"""
        Please process this credit application and provide a comprehensive credit assessment.
        
        Image_Id: {image_id}
        
        Please:
        1. Extract all applicant information from the document using the tools
        2. Verify employment and income information
        3. Verify address information
        4. Provide a final credit decision with reasoning
        
        Return a structured assessment with your recommendation.
        """)
        
        inputs = {
            "messages": [user_prompt_with_id],
            "system": SystemMessage(content=system_prompt)
        }
        
        logger.info("🤖 Processing credit application with agent...")
        
        final_message = None
        try:
            async for s in graph.astream(inputs, stream_mode="values"):
                message = s["messages"][-1]
                if isinstance(message, tuple):
                    logger.info(message)
                else:
                    message.pretty_print()
                    
                if isinstance(message, AIMessage):
                    final_message = message.content
                    logger.info(f"Final credit assessment: {final_message}")
                    
        except Exception as e:
            if "RateLimitError" in str(e) or "429" in str(e):
                logger.warning(f"Rate limit encountered: {e}")
                return {
                    "status": "RATE_LIMITED",
                    "message": "Rate limit encountered. Please try again later.",
                    "image_id": image_id,
                    "recommendation": "Wait a few minutes before retrying"
                }
            else:
                raise e
        
        return {
            "status": "COMPLETED",
            "image_id": image_id,
            "credit_assessment": final_message,
            "processing_note": "Image uploaded to S3 and processed using image ID with MCP tools"
        }
        
    except Exception as e:
        logger.error(f"Error processing credit application: {e}")
        return {
            "status": "ERROR",
            "message": f"Error processing application: {str(e)}",
            "recommendation": "Please check the image format and try again"
        }

@app.get("/api/tools")
async def list_available_tools():
    """List all available MCP tools"""
    try:
        client = MultiServerMCPClient(mcp_servers)
        tools = await client.get_tools()
        
        tool_info = []
        for tool in tools:
            tool_info.append({
                "name": tool.name,
                "description": tool.description,
                "server": "determined_by_port"  # Could be enhanced to show which server
            })
        
        return {
            "status": "success",
            "available_tools": tool_info,
            "total_tools": len(tool_info)
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Error listing tools: {str(e)}"
        }

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "credit_underwriting_agent_with_image_id"}

if __name__ == "__main__":
    logger.info("Starting Credit Underwriting Agent with Image ID Support...")
    logger.info("Available endpoints:")
    logger.info("- POST /api/process_credit_application_with_upload - Upload and process new image")
    logger.info("- POST /api/process_credit_application_by_id - Process existing image by ID")
    logger.info("- POST /api/extract_data_only - Extract data without full processing")
    logger.info("- POST /api/process_credit_application - Process sample image (legacy)")
    logger.info("- GET /api/tools - List available MCP tools")
    logger.info("- GET /api/health - Health check")

    uvicorn.run("credit-underwriting-agent:app", host="0.0.0.0", port=8080, reload=True)
