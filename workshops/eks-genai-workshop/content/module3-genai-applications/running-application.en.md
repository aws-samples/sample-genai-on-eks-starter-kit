---
title: "Deploy and Test Your Application"
weight: 30
---

Now it's time to deploy Loan Buddy and see your AI agent in action! In this section, you'll deploy the application on your EKS cluster, test it with a real loan application, and watch the complete workflow execute in Langfuse.

## Prerequisites Check

Before deploying, let's verify your GenAI platform from Modules 1 & 2 is ready:

:::code{language=bash showCopyAction=true}
# Check your platform components are running
kubectl get pods -n litellm
kubectl get pods -n langfuse

# Verify LiteLLM gateway is accessible
echo "LiteLLM URL: http://$(kubectl get ingress -n litellm litellm -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"

# Check Langfuse observability
echo "Langfuse URL: http://$(kubectl get ingress -n langfuse langfuse -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
:::

::alert[**Platform Required**: Ensure all pods are in "Running" status before proceeding. If any components are missing, please complete Modules 1 & 2 first.]{type="warning"}

## 🔧 Preparing the Deployment

### Step 1: Get Your Platform Configuration

First, let's get the configuration details from your existing platform:

:::code{language=bash showCopyAction=true}
# Open the local environment file in VSC
code .env
:::

**Note down these values** from your `.env` file:
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY` 
- The LiteLLM API key you created in Module 2

### Step 2: Configure the Application Deployment

:::code{language=bash showCopyAction=true}
# Open the deployment file in VSC
code /workshop/workshops/eks-genai-workshop/static/code/module3/credit-validation/agentic-application-deployment.yaml
:::

**Update the environment variables** in the deployment file:
- Locate the `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` variables
- Replace their values with the ones from your `.env` file
- Update the `GATEWAY_MODEL_ACCESS_KEY` with your LiteLLM API key from Module 2

::alert[**Important**: Make sure to save the file after making these changes. The application needs these keys to connect to your platform components.]{type="warning"}

## 🚀 Deploy Application Components

### Step 3: Create the Workshop Namespace

:::code{language=bash showCopyAction=true}
# Create namespace for the Loan Buddy application
kubectl create namespace workshop
:::

### Step 4: Deploy All Components

:::code{language=bash showCopyAction=true}
# Deploy the application using your configured file
kubectl apply -f /workshop/workshops/eks-genai-workshop/static/code/module3/credit-validation/agentic-application-deployment.yaml

# Wait for deployments to complete
kubectl rollout status deployment/loan-buddy-agent -n workshop
kubectl rollout status deployment/mcp-address-validator -n workshop
kubectl rollout status deployment/mcp-employment-validator -n workshop
kubectl rollout status deployment/mcp-image-processor -n workshop
:::

### Step 5: Verify Deployment Success

:::code{language=bash showCopyAction=true}
# Check all components are running
kubectl get pods -n workshop
:::

**Expected output - all pods should be "Running":**
```
NAME                                     READY   STATUS    RESTARTS   AGE
loan-buddy-agent-xxx                     1/1     Running   0          2m
mcp-address-validator-xxx                1/1     Running   0          2m
mcp-employment-validator-xxx             1/1     Running   0          2m
mcp-image-processor-xxx                  1/1     Running   0          2m
```

## 🧪 Test Your AI Agent

Now let's test Loan Buddy with a real loan application and watch the complete workflow!

### Step 6: Set Up Real-Time Monitoring

Before testing the application, let's set up monitoring to watch the agent work:

:::code{language=bash showCopyAction=true}
# Watch the agent logs in real-time (open in a second terminal)
kubectl logs -f deployment/loan-buddy-agent -n workshop
:::

**Keep this terminal open** - you'll see the agent's decision-making process in real-time!

### Step 7: Process a Loan Application

The sample [loan application](../../static/code/module3/credit-validation/example1.png) is an example loan application document. Let's use it to test our agentic application:

:::code{language=bash showCopyAction=true}
# Expose the application on local port
kubectl port-forward service/loan-buddy-agent 8080:8080 -n workshop &

# Navigate to the test data directory
cd /workshop/workshops/eks-genai-workshop/static/code/module3/credit-validation/

# Process the sample loan application
curl -X POST -F "image_file=@./example1.png" http://localhost:8080/api/process_credit_application_with_upload
:::

**Study the response** from the curl call and familiarize yourself with the output generated. Track the logs from the application pod and see how the LLM is executing the workflow. Remember that you have not coded any workflow or calls to MCP servers - all is done by the LLM using the prompt you provided.

### Step 8: Explore the Workflow in Langfuse

Now let's see the complete workflow captured in your Langfuse observability platform:

1. **Open Langfuse** using the URL from your prerequisites check
2. **Navigate to Traces** in the left sidebar
3. **Look for traces** with the run name `credit_underwriting_agent_with_image_id`

You can find this identifier by examining the agent code:

:::code{language=bash showCopyAction=true}
# See the Langfuse run_name in the agent code
grep -n "run_name" /workshop/workshops/eks-genai-workshop/static/code/module3/credit-validation/credit-underwriting-agent.py
:::

**In Langfuse, you'll see a complete trace** similar to the image below, showing how the full workflow with multiple calls to tools and LLMs are captured:

![LangFuse Workflow Trace](/static/images/module-3/LoanBuddy-Observability.png)

**Validate the following in your Langfuse trace:**
- **Workflow Execution**: The flow has been executed according to your prompt
- **Tool Interactions**: Input and output of each LLM and MCP call
- **Performance Metrics**: Time to First Token and latency captured by Langfuse
- **Cost Tracking**: Token usage and costs for the complete workflow
- **Decision Audit**: Complete reasoning for the loan approval/rejection
