---
title: "Deploy and Test Your Application"
weight: 30
---

# 🚀 The Moment of Truth: Deploy Loan Buddy!

It's time to bring Loan Buddy to life and watch it process John Michael Doe's loan application in real-time! Get ready to see hours of manual work completed in minutes.

![John's Application Ready for Processing](/static/images/module-3/example1.png) 

*John's application is waiting - let's process it with AI!*

## ✅ Prerequisites Check

Before we deploy, let's make sure your GenAI platform from Modules 1 & 2 is ready:

:::code{language=bash showCopyAction=true}
# Check your platform components are running
kubectl get pods -n litellm
kubectl get pods -n langfuse

# Verify LiteLLM gateway is accessible
echo "LiteLLM URL: http://$(kubectl get ingress -n litellm litellm -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"

# Check Langfuse observability
echo "Langfuse URL: http://$(kubectl get ingress -n langfuse langfuse -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
:::

::alert[**Platform Required**: All pods should show "Running" status. If any components are missing, please complete Modules 1 & 2 first.]{type="warning"}

## 🔧 Step 1: Configure Your Deployment

### Get Your Platform Credentials

First, let's retrieve the configuration from your existing platform:

:::code{language=bash showCopyAction=true}
# Open your environment file to get the keys
code .env
:::

**Note these values from your `.env` file:**
- `LANGFUSE_PUBLIC_KEY` - Your Langfuse public key
- `LANGFUSE_SECRET_KEY` - Your Langfuse secret key
- Your LiteLLM API key from Module 2

### Update the Deployment Configuration

Now let's configure Loan Buddy to connect to your platform:

:::code{language=bash showCopyAction=true}
# Open the deployment file
code /workshop/workshops/eks-genai-workshop/static/code/module3/credit-validation/agentic-application-deployment.yaml
:::

**Update these environment variables in the deployment file:**

1. Find the `loan-buddy-agent` deployment section
2. Update these values:
   ```yaml
   - name: LANGFUSE_PUBLIC_KEY
     value: "YOUR_ACTUAL_PUBLIC_KEY"  # Replace with your key
   - name: LANGFUSE_SECRET_KEY  
     value: "YOUR_ACTUAL_SECRET_KEY"  # Replace with your key
   - name: GATEWAY_MODEL_ACCESS_KEY
     value: "YOUR_LITELLM_API_KEY"    # Replace with your key
   ```

3. Also update in the `mcp-image-processor` deployment:
   ```yaml
   - name: GATEWAY_MODEL_ACCESS_KEY
     value: "YOUR_LITELLM_API_KEY"    # Same key as above
   ```

::alert[**Important**: Save the file (Ctrl+S) after making these changes!]{type="warning"}

## 🎯 Step 2: Deploy the AI Workforce

### Create the Workshop Namespace

:::code{language=bash showCopyAction=true}
# Create a dedicated namespace for Loan Buddy
kubectl create namespace workshop
:::

### Deploy All Components

Now let's deploy our AI assembly line:

:::code{language=bash showCopyAction=true}
# Deploy Loan Buddy and all MCP servers
kubectl apply -f /workshop/workshops/eks-genai-workshop/static/code/module3/credit-validation/agentic-application-deployment.yaml

# Watch the magic happen!
echo "🚀 Deploying your AI workforce..."
echo "📸 Image Processor MCP - Ready to read documents"
echo "🏠 Address Validator MCP - Ready to verify addresses"
echo "💼 Employment Validator MCP - Ready to check backgrounds"
echo "🤖 Loan Processing Agent - Ready to orchestrate!"
:::

### Wait for Deployment to Complete

:::code{language=bash showCopyAction=true}
# Check deployment status
kubectl rollout status deployment/loan-buddy-agent -n workshop
kubectl rollout status deployment/mcp-address-validator -n workshop
kubectl rollout status deployment/mcp-employment-validator -n workshop
kubectl rollout status deployment/mcp-image-processor -n workshop

# Verify all pods are running
kubectl get pods -n workshop
:::

**Expected output - all pods should be "Running":**
```
NAME                                     READY   STATUS    RESTARTS   AGE
loan-buddy-agent-xxx                     1/1     Running   0          1m
mcp-address-validator-xxx                1/1     Running   0          1m
mcp-employment-validator-xxx             1/1     Running   0          1m
mcp-image-processor-xxx                  1/1     Running   0          1m
```

## 🎬 Step 3: Watch the AI in Action

### Set Up Real-Time Monitoring

Open a second terminal to watch the agent's thought process:

:::code{language=bash showCopyAction=true}
# In a NEW terminal, watch the agent logs
kubectl logs -f deployment/loan-buddy-agent -n workshop
:::

**Keep this terminal visible** - you'll see the AI making decisions in real-time!

### Expose the Application

Back in your main terminal:

:::code{language=bash showCopyAction=true}
# Make Loan Buddy accessible
kubectl port-forward service/loan-buddy-agent 8080:8080 -n workshop &

# Navigate to the test data directory
cd /workshop/workshops/eks-genai-workshop/static/code/module3/credit-validation/
:::

## 🎉 Step 4: Process John's Loan Application!

### The Big Moment - Submit John's Application

:::code{language=bash showCopyAction=true}
# Process John Michael Doe's loan application
curl -X POST -F "image_file=@./example1.png" \
  http://localhost:8080/api/process_credit_application_with_upload
:::

### Watch the Magic Happen! ✨

**In your log terminal, you'll see:**

```
🔄 Starting credit application processing...
📄 Processing uploaded loan application image...
✅ Image stored in S3 with ID: a7b9c2d4e5f6...
🔧 Loading MCP tools...
🤖 Processing with agent...

[Agent]: I'll help you process this credit application. Let me start by extracting the information from the document.

[Image Processor MCP]: Extracting data from loan application...
Found: John Michael Doe, DOB: 03/15/1985, SSN: ***-**-7890
Income: $75,000, Employer: Tech Solutions Inc
Address: 123 Main Street, Anytown, CA 90210

[Agent]: Now validating the address information...

[Address Validator MCP]: Checking 123 Main Street, Anytown, CA 90210
✅ Valid residential address - Single family home
✅ Owner occupied - 4 years at address
✅ Risk score: 15 (Low risk)

[Agent]: Verifying employment and income...

[Employment Validator MCP]: Verifying Tech Solutions Inc
✅ Employment confirmed - Software Engineer
✅ Income verified - $75,000 annual
✅ Employment duration - 3.5 years
✅ Stability score: 85 (High stability)

[Agent]: Calculating loan metrics...
- Loan amount: $8,500
- Monthly payment: $275
- Monthly income: $6,250
- Debt-to-income ratio: 4.4% (Excellent)

FINAL DECISION: ✅ APPROVED
- Low risk profile
- Stable employment
- Excellent debt-to-income ratio
- Home ownership indicates stability
```

### Review the Response

The curl command returns a JSON response with the complete assessment:

```json
{
  "status": "COMPLETED",
  "image_id": "a7b9c2d4e5f6...",
  "credit_assessment": "APPROVED - John Michael Doe's application for $8,500 home improvement loan is approved. Verified employment at Tech Solutions Inc ($75,000/year), confirmed residential address ownership, excellent debt-to-income ratio of 4.4%.",
  "processing_note": "Complete audit trail available in Langfuse"
}
```

## 📊 Step 5: Explore the Complete Workflow in Langfuse

### Open Langfuse Dashboard

1. **Get your Langfuse URL** (from the prerequisites check)
2. **Open it in your browser**
3. **Navigate to "Traces"** in the left sidebar

### Find John's Application Trace

Look for traces with:
- **Name**: `credit_underwriting_agent_with_image_id`
- **Recent timestamp** (just processed)

### What You'll See in the Trace

![Langfuse Trace Example](/static/images/module-3/LoanBuddy-Observability.png)
*Complete visibility into the AI's decision-making process*

**The trace shows:**
- 📊 **Complete workflow** - Every step from upload to decision
- 🔧 **All tool calls** - Image extraction, address validation, employment verification
- 💭 **AI reasoning** - Why the loan was approved
- ⏱️ **Performance metrics** - Processing time, latency for each step
- 💰 **Cost tracking** - Tokens used, estimated cost
- 📝 **Full audit trail** - Complete record for compliance

### Analyze the Metrics

In Langfuse, click on the trace to see:
- **Total tokens**: ~2,500 tokens used
- **Processing time**: 45-60 seconds total
- **Tool calls**: 3 MCP servers invoked
- **Decision path**: Complete reasoning chain

## 🎯 Step 6: Try Different Scenarios (Optional)

### Test with the Second Application

If you have another test application:

:::code{language=bash showCopyAction=true}
# Process another application
curl -X POST -F "image_file=@./example2.png" \
  http://localhost:8080/api/process_credit_application_with_upload
:::

### Experiment with Edge Cases

Try modifying the MCP server mock data to see different outcomes:
- What if employment verification fails?
- What if the address is invalid?
- What if the income doesn't match?

## 🎊 WOOHOO! You Did It!

### What Just Happened?

You've successfully:
- ✅ **Deployed** a complete AI loan processing system on Kubernetes
- ✅ **Processed** John's loan application in under a minute
- ✅ **Automated** 2-3 hours of manual work
- ✅ **Created** a complete audit trail in Langfuse
- ✅ **Integrated** with your GenAI platform from Modules 1 & 2

### The Business Impact

Remember Sarah from the beginning?

**Before Loan Buddy:**
- 📝 30 minutes manually entering John's data
- ☎️ 45 minutes calling Tech Solutions Inc
- 🔍 20 minutes verifying the address
- 📊 30 minutes calculating ratios and documenting
- **Total**: 2+ hours
- **Sarah's Friday**: Working late 😞

**After Loan Buddy:**
- ⚡ Complete processing: 47 seconds
- 🤖 All verifications: Automated
- 📊 Full documentation: Instant
- 🔍 Audit trail: Complete
- **Sarah's Friday**: Movie night! 🍿

## 🎯 Key Takeaways

You've learned how to:
1. **Build AI applications** that solve real business problems
2. **Use LangGraph** to orchestrate complex workflows
3. **Implement MCP servers** for specialized capabilities
4. **Integrate with your platform** (LiteLLM + Langfuse)
5. **Deploy on Kubernetes** with proper configuration
6. **Monitor AI decisions** with complete observability

## Congratulations! 🎉

You've successfully built and deployed an AI-powered loan processing system that:
- Saves hours of manual work
- Provides consistent decisions
- Maintains complete audit trails
- Integrates with your GenAI platform

**John got his loan approved, Sarah got her Friday night back, and you've mastered building AI applications on EKS!**

---
