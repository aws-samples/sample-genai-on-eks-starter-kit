# https://python.langchain.com/docs/how_to/migrate_agent/
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
import os
from mcp import ClientSession
from langfuse.callback import CallbackHandler
import asyncio
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import AIMessage, HumanMessage
from langfuse.callback import CallbackHandler
import base64

def encode_image(image_path):
    """Encode image to base64 string"""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")
  
doc = encode_image("se.png")


model_key="sk-fce2XjCQCitvSv0DJiru1w"
api_gateway_url="http://llama-cpp-cpu-lb-656392498.ap-southeast-2.elb.amazonaws.com"

langfuse_url="http://langfuse-lb-730705963.ap-southeast-2.elb.amazonaws.com"
local_public_key = "pk-lf-ad058c9d-da05-4814-9011-ab0197b2b41e"
local_secret_key = "sk-lf-f09f4cfa-8ede-4ff3-ab1f-f1ed0d2299a4" 

os.environ["LANGFUSE_SECRET_KEY"] = local_secret_key
os.environ["LANGFUSE_HOST"] = langfuse_url
os.environ["LANGFUSE_PUBLIC_KEY"] = local_public_key

 
# Initialize Langfuse CallbackHandler for Langchain (tracing)
langfuse_handler = CallbackHandler()


# Configure LLM
# llm_model = "qwen3-vllm"
# llm_model = "llama-distributed"
llm_model = "bedrock-llama-32"

model = ChatOpenAI( model=llm_model, temperature=0, 
                   api_key=model_key, base_url=api_gateway_url)




mcp_servers =     {
        "company_information_validation_service": {
            "url": "http://localhost:5100/sse",  # If already running
            "transport": "sse",
        },
        "account_code_assigner_service": {
            "url": "http://localhost:5000/sse",  # If already running
            "transport": "sse",
        }
        
    }

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate






app = FastAPI(title="LangGraph Agentic Demo with MCP")


user_prompt = """You have sales receipt data in a json format. Do the following:
                            \n1. Make sure that the json includes total amount due, company information, bank account number, tax registered number and invoice number. 
                            \n2. Extract all the line items into a line_items json array.
                            \n3. Make sure that the Bank Account Number field is having atleast 16 characters. 
                            \n4. Validate the tax invoice number using appropriate tools and if it is not valid, then create a field in json with name as invalid_data and set it to true and add a message indicating the reason for invalidation.
                            \n5. Get the accounting code for each line items using the  appropriate tools
                            \n6. Add the accounting code you got from tools into the json.
                            \n7. Finish the workflow and return just the json.
                            
                            CRITICAL: If there is an invalid_data field with a value of true, immediately stop the workflow. Do no further processing and return the modified json.
                            
                            the sales receipt data is is here
                            ```json
                            {
                                "total_amount_due": 500,
                                "company_information": {
                                    "name": "ABC Corp",
                                    "address": "123 Main St, Anytown, USA"
                                },
                                "bank_account_number": "1234567890123456",
                                "tax_registered_number": "1234567890",
                                "invoice_number": "INV-001",
                                "invoice_date": "2023-01-01",
                                "line_items": [
                                    {
                                        "description": "Labour",
                                        "amount": 250,
                                    },
                                    {
                                        "description": "Paint and Plywood",
                                        "amount": 250,
                                    }
                                ]
                            }
                            ```

                            """

# another scenario is for underwriting for credit loans < $10000
# Steps: Validate credit score
# Steps: Extract information from the credit application such as job, address, family members
# Steps: Validate income and employment status from a fake employment server
# check is there is valid adress valiator instead of mock.
# building in lang*


user_prompt = """This is a sales receipt image. Do the following:
                            \n1. Convert the image into text and extract the fields from the image including total amount due, company information, bank account number, tax registered number and invoice number in JSON format. 
                            \n2. Extract all the line items into a line_items json array.
                            \n3. Make sure that the json includes total amount due, company information, bank account number, tax registered number and invoice number. 
                            \n4. Extract all the line items into a line_items json array.
                            \n5. Make sure that the Bank Account Number field is having atleast 16 characters. 
                            \n6. Validate the tax invoice number using appropriate tools and if it is not valid, then create a field in json with name as invalid_data and set it to true and add a message indicating the reason for invalidation.
                            \n7. Get the accounting code for each line items using the  appropriate tools
                            \n8. Add the accounting code you got from tools into the json.
                            \n9. Finish the workflow and return just the json. 
                            
                            \nCRITICAL: If there is an invalid_data field with a value of true, immediately stop the workflow. Do no further processing and return the modified json.
                            
                            """

system_prompt = (
    "You are a highly efficient manager managing a collaborative conversation"
    "\nYour role is to:"
    "\n1. Analyze the user's request and the ongoing conversation."
    "\n2. Determine which tool is best suited to handle the next task."
    "\n3. Ensure a logical flow of information and task execution."
    "\nRemember, each tool has unique capabilities, so choose wisely based on the current needs of the task."
)

doc_parser_user_prompt = HumanMessage(content= [
                        {
                            "type": "text",
                            "text": user_prompt,
                                    
                        }
                        ,
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": "data:image/png;base64," + doc
                            }
                        }
                    ])  

@app.post("/api/process_receipts")
async def process_receipts():

    async with MultiServerMCPClient(mcp_servers) as client:
        graph =create_react_agent(model, client.get_tools(), debug=True)
        # graph.get_graph().draw_mermaid_png(output_file_path="fruit-flow.png")
        graph = graph.with_config({
                "run_name": "accounting_agent",
                "callbacks": [langfuse_handler],
                "recursion_limit": 10,
            })        
        
        inputs = {"messages": [doc_parser_user_prompt], #("user", user_prompt)],
                  "system": SystemMessage(content=system_prompt)}
        async for s in graph.astream(inputs, stream_mode="values"):
            message = s["messages"][-1]
            if isinstance(message, tuple):
                print(message)
            else:
                message.pretty_print()
                
            if isinstance(message, AIMessage):
                final_message = message.content
                print("Final message:", final_message)                
        return final_message
        

                




if __name__ == "__main__":
    uvicorn.run("accounting-agent-demo:app", host="0.0.0.0", port=8080, reload=True)
    
    
