---
title: "AWS Bedrock - Managed AI Services"
weight: 23
---

AWS Bedrock is a fully managed service that provides access to high-performing foundation models from leading AI companies through a single API. In this section, you'll configure access to Claude 3.7 Sonnet and learn how to use Bedrock models for the GenAI platforms you configure on EKS.

## What is AWS Bedrock?

Amazon Bedrock offers:

- 🚀 **Instant Access**: No infrastructure to manage or models to deploy
- 🎯 **Top-Tier Models**: Claude (Anthropic), Llama (Meta), Mistral, Amazon Titan, and more
- 💰 **Pay-Per-Use**: Only pay for tokens processed, no idle costs
- 🔒 **Enterprise Security**: Data privacy, compliance, and governance built-in
- ⚡ **High Performance**: Optimized infrastructure with consistent low latency
- 🛠️ **Additional Features**: Fine-tuning, RAG, agents, and guardrails

## Why Use Bedrock for This Workshop?

You've just experienced self-hosted models on our workshop infrastructure. Due to our hardware constraints (inf2.xlarge instances), the self-hosted models have limited performance. For the best learning experience in the remaining modules, we suggest using Bedrock:

1. **No Hardware Constraints**: Not limited by workshop instance sizes
2. **Consistent Performance**: Reliable response times for hands-on exercises  
3. **Latest Models**: Access to Claude 3.7 Sonnet with advanced capabilities
4. **Focus on Learning**: Spend time on concepts, not waiting for responses

::alert[**Workshop Suggestion**: For the remaining modules, we recommend using Bedrock (Claude 3.7 Sonnet) to ensure optimal learning experience. Both self-hosted and managed approaches have their place in different scenarios.]{type="info"}

## Enabling Bedrock Model Access

Before using Bedrock models, you need to enable access in your AWS account. Follow these steps:

### Step 1: Access Bedrock Model Access Page

Navigate directly to the [Bedrock Model Access Page](https://us-west-2.console.aws.amazon.com/bedrock/home?region=us-west-2#/modelaccess) in the AWS Console.

![Bedrock Model Access Page](/static/images/module-1/image.png)

**Verify your access**: Ensure you see "WSParticipantRole/Participant" in the top right corner.

### Step 2: Modify Model Access

1. Click the **"Modify model access"** button (orange button in the interface)
2. Scroll down to find the **Anthropic** section
3. Check the box next to **Claude 3.7 Sonnet**

![Select Claude 3.7 Sonnet](/static/images/module-1/image-1.png)

### Step 3: Submit Your Request

1. Scroll down and click **"Next"**

![Click Next](/static/images/module-1/image-2.png)

2. On the **"Review and submit"** page, review your selection and click **"Submit"**

![Review and Submit](/static/images/module-1/image-3.png)

::alert[**Cross-Region Requirement**: Claude 3.7 Sonnet requires cross-region inference. You will need to repeat these steps in the us-east-1 region as well. Use the region selector in the top right corner of the AWS Console.]{type="warning"}

### Step 4: Enable Access in Second Region (Do It Yourself)

Claude 3.7 Sonnet requires cross-region inference, so you need to enable access in both regions:

1. **Switch to us-east-1 region**:
   - Click the region selector in the top right corner of the AWS Console
   - Select **"US East (N. Virginia) us-east-1"**

2. **Repeat the model access process**:
   - Navigate to the [Bedrock Model Access Page in us-east-1](https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess)
   - Click **"Modify model access"**
   - Find the **Anthropic** section and check **Claude 3.7 Sonnet**
   - Click **"Next"** → **"Submit"**

3. **Verify access in both regions**:
   - You should now have Claude 3.7 Sonnet access in both us-west-2 and us-east-1
   - This enables cross-region inference for optimal performance

::alert[**Access Granted**: Model access is typically granted instantly. You should see "Access granted" status within seconds of submitting your request.]{type="success"}

## Using Bedrock Models in Open WebUI

Once model access is enabled, we can interact with our Bedrock models via Open WebUI through LiteLLM:

### Step 1: Access Open WebUI

1. Use the OpenWebUI URL from your previous commands
2. Log in with your credentials

### Step 2: Select Bedrock Model

1. Click the model dropdown at the top of the chat
2. Look for **"claude-3.7-sonnet"** (it should appear automatically)
3. Select it as your active model

### Step 3: Test Claude 3.7 Sonnet

Now let's experience Claude's capabilities with some practical examples.

#### Test 1: Advanced Technical Reasoning

Ask Claude this question to see its technical depth:

:::code{language=markdown showCopyAction=true}
"Explain the concept of Kubernetes operators and provide a simple example of when you would create a custom operator."
:::

**Expected Response**: Claude provides a comprehensive explanation with clear structure:

![Claude's Kubernetes Operators Response](/static/images/module-1/image-4.png)

**What to Notice**:
- **Structured Response**: Clear headings and logical flow
- **Technical Depth**: Explains control loops, CRDs, and practical examples
- **Real-World Context**: Provides concrete use cases

#### Test 2: Code Generation (Optional)

Try this for code generation capabilities:

:::code{language=markdown showCopyAction=true}
"Write a Python class that implements a simple LRU cache with get and put methods. Explain the time complexity of each operation."
:::

#### Test 3: Long-Form Analysis (Optional)

For complex analysis tasks:

:::code{language=markdown showCopyAction=true}
"Analyze the benefits and challenges of running AI workloads on Kubernetes. Consider aspects like scalability, resource management, and operational complexity."
:::

**Key Observation**: Claude provides detailed, well-structured responses that are ideal for the learning exercises in the upcoming modules.

## Model Comparison: Exploring Different Approaches

Open WebUI's powerful feature allows you to compare responses from different models side-by-side. This helps you understand how different models approach the same problem and choose the right model for specific tasks.

### How to Compare Models

1. **Select your first model** (e.g., Claude 3.7 Sonnet)
2. **Click the "+" button** next to the model name to add a second model
3. **Choose a second model** (e.g., vLLM Llama 3.1)
4. **Ask the same question** to both models simultaneously

### Example Comparison

Try this mathematical question with both models:

**Test Question**: "What is squareroot of 144 divided by 29 multiplied by pi"

![Model Comparison: Side-by-Side Results](/static/images/module-1/image-5.png)

### What You'll Observe

**Different Response Styles**: Each model has its own approach to problem-solving:
- Some models provide step-by-step explanations
- Others give direct, concise answers
- Response formatting and detail levels vary

**Learning Opportunity**: This comparison feature helps you:
- Understand model characteristics
- Choose appropriate models for different use cases
- Evaluate response quality and style preferences
- Learn from different problem-solving approaches

## Advanced Features: RAG in Open WebUI

Open WebUI includes basic RAG (Retrieval Augmented Generation) capabilities. Let's demonstrate how RAG can dramatically transform AI responses by providing specific context from your documents.

### Step 1: Create a Test Document

First, create a sample document in your VSC IDE terminal:

:::code{language=bash showCopyAction=true}
# Create the test file in your VSC IDE terminal
cat > super-secret.txt << 'EOF'
Super Secret Document

This document contains classified information about the secret project.
Only authorized personnel are allowed to access this data.

Project Codename: Nightfall
Objective: Develop an untraceable communication device.
Status: In progress

Remember, this information is top secret and must not be shared with anyone.
EOF
:::

### Step 2: Download to Your Local Device

After creating the file in VSC IDE:

1. **Locate the file** in your VSC IDE file explorer
2. **Right-click** on `super-secret.txt`
3. **Select "Download"** to save it to your local machine
4. **Remember the download location** - you'll need to upload it to OpenWebUI

::alert[**Why Download?** OpenWebUI runs in your browser and needs files from your local machine, not from the remote VSC IDE environment.]{type="info"}

### Step 3: Create Knowledge Base in OpenWebUI

Now let's set up the knowledge base in OpenWebUI:

1. **Access Workspace**: Click on **"Workspace"** and then **"Knowledge"**

![Knowledge Tab](/static/images/module-1/image-6.png)

2. **Create New Knowledge Base**: Click the **"+"** button on the right side

3. **Fill out the form**:
   - **Name**: `super-secret-info`
   - **Description**: `Store secret info in knowledge base`
   - **Visibility**: Select **"Private"** 

![Create Knowledge Base Form](/static/images/module-1/image-7.png)

4. **Create and Upload**:
   - Click **"Create Knowledge"**
   - Click **"Upload files"**
   - Select your downloaded `super-secret.txt` file
   - Wait for the upload to complete

### Step 4: Test WITHOUT RAG (Baseline)

Let's first see how Claude responds without access to our document:

**Ask this question**: "What is the object of project nightfall?"

![Claude Without RAG Context](/static/images/module-1/image-8.png)

**Notice**: Claude gives a generic response about a social media platform because it has no knowledge of our secret document content.

### Step 5: Test WITH RAG (The Magic!)

Now let's see the power of RAG in action:

1. **Start a new chat**
2. **Type `#`** in the message box - this activates knowledge base selection

![Knowledge Base Selection](/static/images/module-1/image-9.png)

3. **Select your knowledge base**: Click on **"super-secret.txt"**
4. **Ask the exact same question**: "What is the object of project nightfall?"

![Claude With RAG Context](/static/images/module-1/image-10.png)

**Amazing!** Now Claude correctly references the classified document and provides the exact information: "Develop an untraceable communication device."

### The RAG Transformation

This demonstrates the fundamental power of RAG:

- **Without RAG**: Claude uses only its training data → Generic, incorrect response
- **With RAG**: Claude uses your specific document as context → Accurate, relevant response

**Same model, same question, completely different answers!**

### What You Just Experienced

This is OpenWebUI's built-in simple RAG capability. You've just seen how:

- Documents can be uploaded and indexed
- AI models can retrieve relevant information from your documents
- Responses become contextually accurate and specific to your data

::alert[**Simple RAG**: This is just the beginning! OpenWebUI provides basic RAG functionality. In later modules, we'll explore more sophisticated RAG implementations.]{type="success"}
=====================

## Key Takeaways

✅ **Instant Deployment**: No infrastructure to manage, models ready immediately

✅ **Managed Service Benefits**: Optimized infrastructure without operational overhead

✅ **Advanced Models**: Access to Claude 3.7 with 200K context window

✅ **Pay-Per-Use**: Cost model ideal for variable workloads

✅ **Enterprise Features**: Built-in security, compliance, and governance

## Module Summary

Congratulations! You've now experienced three different approaches to model deployment:

1. **Open WebUI**: Unified chat interface for all models
2. **vLLM**: Self-hosted models with full control but hardware constraints
3. **Bedrock**: Managed service with superior performance and capabilities

### Suggested Approach for Remaining Modules

**Use Bedrock (Claude 3.7 Sonnet)** for optimal workshop experience:
- Consistent performance for hands-on exercises
- Advanced capabilities for complex learning scenarios
- No infrastructure management overhead
- Reliable responses for interactive learning

### What You've Learned

- How to deploy and configure LLM infrastructure on Kubernetes
- The trade-offs between self-hosted and managed models
- How to integrate multiple model providers through a unified API
- The importance of hardware selection for AI workloads
- Cost and performance optimization strategies

---

**[Back to Module Overview](../) | [Continue to Module 2 →](../../module2-genai-platform-components)**
