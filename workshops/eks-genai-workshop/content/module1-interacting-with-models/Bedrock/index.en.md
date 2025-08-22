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

### Step 1: Access AWS Console

:::code{language=bash showCopyAction=true}
# Get your AWS Console URL (provided by Workshop Studio)
echo "AWS Console: https://console.aws.amazon.com"

# Verify your current region
aws configure get region
:::

### Step 2: Navigate to Bedrock

1. In the AWS Console, search for **"Bedrock"** in the top search bar
2. Click on **"Amazon Bedrock"** service
3. You'll land on the Bedrock console homepage

### Step 3: Request Model Access

1. In the left sidebar, click **"Model access"** under "Bedrock configurations"
2. You'll see a list of available model providers
3. Find **"Anthropic"** section
4. Click **"Manage model access"** button (top right)

### Step 4: Enable Claude Models

1. In the model access page, locate **Claude 3.7 Sonnet**
2. Check the box next to:
   - ✅ **Claude 3.7 Sonnet** (us.anthropic.claude-3-7-sonnet-20250219-v1:0)
3. Scroll down and click **"Request model access"**
4. Review and click **"Submit"**

::alert[**Note**: Model access is typically granted instantly. You should see "Access granted" status within seconds.]{type="info"}

### Step 5: Verify Access

:::code{language=bash showCopyAction=true}
# List available Bedrock models
aws bedrock list-foundation-models \
  --query "modelSummaries[?contains(modelId, 'claude')].{ID:modelId, Name:modelName}" \
  --output table

# Test Claude 3.7 Sonnet directly
aws bedrock-runtime invoke-model \
  --model-id us.anthropic.claude-3-7-sonnet-20250219-v1:0 \
  --content-type application/json \
  --accept application/json \
  --body '{
    "anthropic_version": "bedrock-2023-05-31",
    "max_tokens": 100,
    "messages": [
      {
        "role": "user",
        "content": "Hello! Please respond with a brief greeting."
      }
    ]
  }' \
  response.json

# View the response
cat response.json | jq -r '.content[0].text'
:::

## Using Bedrock Models in Open WebUI

Once model access is enabled, Bedrock models automatically appear in Open WebUI through LiteLLM:

### Step 1: Access Open WebUI

1. Use the OpenWebUI URL from your previous commands
2. Log in with your credentials

### Step 2: Select Bedrock Model

1. Click the model dropdown at the top of the chat
2. Look for **"claude-3.7-sonnet"** (it should appear automatically)
3. Select it as your active model

### Step 3: Test Claude 3.7 Sonnet

Let's experience Claude's capabilities with some practical examples:

#### Try Advanced Reasoning

:::code{language=markdown showCopyAction=true}
"Explain the concept of Kubernetes operators and provide a simple example of when you would create a custom operator."
:::

#### Test Code Generation

:::code{language=markdown showCopyAction=true}
"Write a Python class that implements a simple LRU cache with get and put methods. Explain the time complexity of each operation."
:::

#### Test Long-Form Analysis

:::code{language=markdown showCopyAction=true}
"Analyze the benefits and challenges of running AI workloads on Kubernetes. Consider aspects like scalability, resource management, and operational complexity."
:::

Notice how Claude provides detailed, well-structured responses that are ideal for the learning exercises in the upcoming modules.

## Advanced Features: RAG in Open WebUI

Open WebUI includes basic RAG (Retrieval Augmented Generation) capabilities. Let's try it:

### Step 1: Enable RAG

1. In Open WebUI, click the **"+"** button next to the message input
2. Select **"Upload Files"**
3. You can upload PDF, TXT, or MD files

### Step 2: Test Document Q&A

1. Create a test document locally:

:::code{language=bash showCopyAction=true}
cat > kubernetes-basics.txt << 'EOF'
Kubernetes Components:

Master Node Components:
- API Server: Central management point, exposes Kubernetes API
- etcd: Distributed key-value store for cluster data
- Scheduler: Assigns pods to nodes based on resource requirements
- Controller Manager: Runs controller processes

Worker Node Components:
- Kubelet: Ensures containers are running in pods
- Container Runtime: Docker, containerd, or CRI-O
- Kube-proxy: Maintains network rules for pod communication

Key Resources:
- Pod: Smallest deployable unit, contains one or more containers
- Service: Provides stable network endpoint for pods
- Deployment: Manages replica sets and pod updates
- ConfigMap: Stores configuration data
- Secret: Stores sensitive data like passwords
EOF
:::

2. Upload this file to Open WebUI
3. Ask questions about the document:

:::code{language=markdown showCopyAction=true}
"Based on the document, what is the role of the Kubernetes Scheduler?"

"What are the main components that run on a worker node?"

"Explain the difference between a ConfigMap and a Secret."
:::

### Step 3: Experience RAG with Bedrock

Try asking questions about the uploaded document - you'll notice how Claude can effectively analyze and synthesize information from the provided context.

## Cost Considerations for Workshop

### Bedrock Pricing (Claude 3.7 Sonnet)
- **Input**: $0.003 per 1K tokens
- **Output**: $0.015 per 1K tokens
- **Example**: A typical workshop session (~10K tokens) costs ~$0.15

::alert[**Workshop Context**: Both self-hosted and managed approaches have different cost profiles depending on usage patterns, scale, and requirements. For this workshop's learning objectives, Bedrock provides the most consistent experience.]{type="info"}

## Best Practices with Bedrock

### 1. **Model Selection**
- Use Claude 3.7 Sonnet for complex reasoning and code
- Consider Claude 3.5 Haiku for simple, fast responses
- Use Llama models for open-source compatibility

### 2. **Prompt Engineering**
Claude responds well to:
- Clear, structured instructions
- Examples (few-shot prompting)
- XML tags for organization
- Chain-of-thought reasoning

### 3. **Token Optimization**
- Be concise in prompts
- Use system prompts efficiently
- Set appropriate max_tokens limits

## Integration Architecture

Here's how Bedrock integrates with our stack:

```mermaid
graph TB
    subgraph "User Layer"
        UI[Open WebUI]
    end
    
    subgraph "API Gateway"
        LLM[LiteLLM]
    end
    
    subgraph "Model Backends"
        subgraph "Self-Hosted"
            VLLM[vLLM<br/>8B Models]
        end
        subgraph "Managed"
            BEDROCK[AWS Bedrock<br/>Claude, Llama, Mistral]
        end
    end
    
    subgraph "AWS Infrastructure"
        IAM[IAM Roles]
        CW[CloudWatch]
    end
    
    UI --> LLM
    LLM --> VLLM
    LLM --> BEDROCK
    BEDROCK --> IAM
    BEDROCK --> CW
    
    style BEDROCK fill:#e8f5e9
    style UI fill:#e1f5fe
```

## Troubleshooting

::::tabs

:::tab{label="Model Not Appearing"}
```bash
# Check if model access is granted
aws bedrock list-foundation-models \
  --query "modelSummaries[?contains(modelId, 'claude-3-7')]"

# Restart LiteLLM to refresh model list
kubectl rollout restart deployment/litellm -n litellm

# Check LiteLLM logs
kubectl logs -n litellm deployment/litellm --tail=50
```
:::

:::tab{label="Access Denied"}
```bash
# Verify IAM permissions
aws sts get-caller-identity

# Check if Bedrock InvokeModel permission exists
aws iam get-role-policy --role-name <your-role> --policy-name <policy>

# Required permission:
# bedrock:InvokeModel on resource: arn:aws:bedrock:*::foundation-model/*
```
:::

:::tab{label="Slow Responses"}
- Check your AWS region - use the closest region
- Verify network connectivity
- Consider token limits in your requests
- Check CloudWatch for throttling
:::

::::

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
