---
title: "Understanding the Use Case"
weight: 10
---

Now that you have a complete GenAI platform running on EKS, let's put it to work! In this section, you'll explore "Loan Buddy" - an intelligent loan processing application that demonstrates how AI agents can automate complex business workflows using your platform.

## 🏦 The Business Problem

Banks and financial institutions face significant challenges in loan processing:

- **Slow Processing Times**: Manual review of loan applications takes hours or days
- **Human Errors**: Data extraction and validation mistakes are common
- **Inconsistent Decisions**: Different reviewers may reach different conclusions
- **High Operational Costs**: Manual processes require significant human resources
- **Poor Customer Experience**: Long wait times frustrate applicants

## 🤖 The AI Solution: Loan Buddy

**Loan Buddy** uses your GenAI platform to automate the entire loan review process:

### **What Loan Buddy Does:**
1. **Extracts Information** from loan application images using vision models
2. **Validates Data** using external services (address verification, employment checks)
3. **Applies Business Rules** automatically (loan limits, income ratios, risk assessment)
4. **Makes Decisions** or routes to human review with complete audit trails
5. **Tracks Everything** in Langfuse for compliance and optimization

### **Business Benefits:**
- ⚡ **Faster Processing**: Minutes instead of hours
- 🎯 **Consistent Decisions**: Same criteria applied every time
- 💰 **Cost Reduction**: Fewer manual review hours needed
- 📊 **Complete Audit Trail**: Every decision tracked and explainable
- 😊 **Better Customer Experience**: Quick responses and status updates

## 🛠️ Hands-On: Explore the Application Code

Let's examine the actual code that powers Loan Buddy. This will help you understand how AI agents work and how they integrate with your platform.

### Step 1: Open the Main Agent File

In your VSC IDE, open the main agent application:

:::code{language=bash showCopyAction=true}
# Open the Loan Buddy agent in VSC
code /workshop/workshops/eks-genai-workshop/static/code/module3/credit-validation/credit-underwriting-agent.py
:::

**What to look for in the code:**
- **Line ~50**: The `system_prompt` that instructs the AI agent
- **Line ~70**: The `user_prompt` that defines the workflow
- **Line ~30**: LiteLLM gateway configuration (connects to your platform!)
- **Line ~40**: Langfuse integration (uses your observability!)

### Step 2: Examine the System Prompt

The system prompt is the key to understanding how the agent works. Look for this section in the code:

```python
system_prompt = """You are a helpful AI assistant for credit underwriting and loan processing.

Your task is to process credit applications by analyzing uploaded documents and validating applicant information using the tools provided...
```

**Key Insights:**
- The agent receives **plain English instructions** - no complex programming needed
- It knows about the **MCP tools** available for validation
- It connects to your **LiteLLM gateway** from Module 2
- Everything is **tracked in Langfuse** from Module 2

### Step 3: See the Platform Integration

Notice how the agent connects to your platform:

```python
# Uses your LiteLLM gateway
api_gateway_url = os.environ.get("GATEWAY_URL", "")
model_key = os.environ.get("GATEWAY_MODEL_ACCESS_KEY", "")

# Uses your Langfuse observability
langfuse_handler = CallbackHandler()
```

**Platform Connection:**
- **LiteLLM Gateway**: Routes all AI requests through your unified API
- **Langfuse Observability**: Tracks every agent decision and interaction
- **Claude 3.7 Sonnet**: Uses the model you configured in Module 1
- **EKS Deployment**: Runs as pods on your Kubernetes cluster

## 🔧 Understanding AI Agent Components

Modern AI applications like Loan Buddy have four key components:

### **1. Orchestration (LangGraph)**
**How it works**: The agent receives instructions in plain English and decides what to do next.

**In Loan Buddy**: The system prompt tells the agent to:
- Extract data from images
- Validate information using tools
- Apply business rules
- Make final decisions

### **2. Knowledge (MCP Servers)**
**How it works**: AI models don't know about your specific business data, so we give them tools.

**In Loan Buddy**: Three MCP servers provide specialized capabilities:
- **Address Validator**: Verifies addresses and checks for fraud
- **Employment Checker**: Validates income and employment status
- **Image Processor**: Extracts data from loan application images

### **3. Memory (LangGraph State)**
**How it works**: LLMs are stateless, but workflows need to remember previous steps.

**In Loan Buddy**: LangGraph maintains state across multiple AI calls:
- Remembers extracted data from the image
- Keeps validation results from each MCP server
- Builds context for the final decision

### **4. Observability (Langfuse Integration)**
**How it works**: Every agent decision is tracked for debugging and compliance.

**In Loan Buddy**: Langfuse captures:
- Complete workflow traces
- Individual tool calls and responses
- Token usage and costs
- Performance metrics

## 🎯 Preview: What You'll Experience

When you deploy and test Loan Buddy, you'll see:

1. **Upload a loan application image** → Agent extracts applicant data
2. **Watch real-time logs** → See the agent make decisions step by step
3. **Explore Langfuse traces** → View the complete workflow with all tool calls
4. **See the final decision** → Approved/rejected with full reasoning

## Key Takeaways

✅ **AI Agents Use Your Platform**: Loan Buddy leverages your LiteLLM gateway and Langfuse observability

✅ **Plain English Instructions**: Complex workflows defined through prompts, not code

✅ **Tool Integration**: MCP servers extend AI capabilities with external data and services

✅ **Complete Observability**: Every decision tracked and auditable in Langfuse

✅ **Business Value**: Real automation that solves actual business problems

## What's Next?

Now that you understand the business case and how AI agents work, let's dive deeper into the technical components. You'll explore the MCP servers and see how they integrate with your GenAI platform.

---

**[Next: Application Components →](../application-components/)**
