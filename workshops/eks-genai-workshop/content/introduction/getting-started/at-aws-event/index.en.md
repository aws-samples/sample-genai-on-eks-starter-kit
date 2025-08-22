---
title: "At AWS Event"
weight: 14
---

# At AWS Event

Welcome to the workshop! Your GenAI infrastructure has been pre-deployed by the event organizers. Let's get you connected to your workshop environment and verify everything is ready for an amazing learning experience.

## 🎯 What's Already Done

::alert[**Good news!** The complex infrastructure deployment is already complete. You can focus entirely on learning and building!]{type="success"}

Your workshop environment includes:
- ✅ **EKS cluster** with Auto Mode enabled
- ✅ **GenAI platform** components (vLLM, LiteLLM, Langfuse, Open WebUI)
- ✅ **Pre-loaded models** (Llama 3.1, Qwen3)
- ✅ **Specialized hardware** (Neuron nodes for inference)
- ✅ **Observability stack** configured and running

## 📝 Step 1: Access Workshop Studio

Workshop Studio provides your isolated AWS environment for this event.

### 1.1 Connect to Workshop Studio

Navigate to the event URL provided by your instructor:

```
https://catalog.workshops.aws/join
```

You'll see the Workshop Studio landing page:

![Workshop Studio Event Page](/static/workshop-studio-landing.png)

### 1.2 Sign In with Email OTP

Click **Email One-Time Password (OTP)** to proceed with passwordless authentication:

1. **Enter your email address**
2. Click **Send passcode**
3. Check your email for subject: **"Your one-time passcode"**
4. Enter the 6-digit code
5. Click **Sign in**

::alert[**Tip**: The passcode expires in 10 minutes. If it expires, simply request a new one.]{type="info"}

### 1.3 Join the Event

After signing in, you'll see the event access page:

1. The **Event access code** should be pre-filled
2. Check ✅ **"I agree with the Terms and Conditions"**
3. Click **Join event**

You're now in your workshop environment!

## 🖥️ Step 2: Access Your AWS Account

### 2.1 Open AWS Console

In the Workshop Studio left sidebar, locate and click:

**🔧 Open AWS Console**

This opens the AWS Management Console in a new tab with temporary credentials already configured.

::alert[**Important**: Use this specific console link. Do not use your personal AWS account for this workshop.]{type="warning"}

### 2.2 Verify Your Region

Ensure you're in the correct AWS region:

:::code{language=bash showCopyAction=true}
# The workshop runs in us-west-2 (Oregon)
# Check the region in the top-right corner of the AWS Console
:::

If needed, switch to **US West (Oregon) us-west-2**.

## 💻 Step 3: Access Your Development Environment

### 3.1 Open Cloud9 IDE

From the Workshop Studio dashboard:

1. Look for **Cloud9 IDE URL** in the **Event Outputs** section
2. Click the URL to open Cloud9 in a new tab
3. You now have a full development environment with:
   - Terminal access
   - kubectl pre-configured
   - AWS CLI ready to use
   - Code editor for later exercises

### 3.2 Verify kubectl Access

In the Cloud9 terminal, verify your connection to the EKS cluster:

:::code{language=bash showCopyAction=true}
# Check cluster access
kubectl cluster-info

# Expected output:
# Kubernetes control plane is running at https://...
# CoreDNS is running at https://...
:::

:::code{language=bash showCopyAction=true}
# View cluster nodes
kubectl get nodes

# You should see multiple nodes including inf2 instances
:::

## ✅ Step 4: Verify GenAI Stack

Let's ensure all GenAI components are running properly:

### 4.1 Check Core Components

:::code{language=bash showCopyAction=true}
# Check vLLM model servers
kubectl get pods -n vllm

# Expected: 2-3 pods in Running state
# - llama-3-1-8b-xxx
# - qwen3-8b-xxx
:::

:::code{language=bash showCopyAction=true}
# Check platform components
kubectl get pods -n litellm
kubectl get pods -n langfuse
kubectl get pods -n openwebui

# All pods should be in Running state
:::

### 4.2 Get Service URLs

Retrieve the URLs for accessing the workshop services:

:::code{language=bash showCopyAction=true}
# Get Open WebUI URL
echo "Open WebUI: https://$(kubectl get ingress -n openwebui openwebui -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"

# Get Langfuse URL  
echo "Langfuse: https://$(kubectl get ingress -n langfuse langfuse -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
:::

Save these URLs - you'll use them throughout the workshop!

### 4.3 Test Open WebUI Access

1. Open the Open WebUI URL in your browser
2. You should see a login screen
3. **Create a new account** with:
   - Any email (e.g., workshop@example.com)
   - Any password (remember it for the workshop)

::alert[**Note**: This is a local account within your workshop environment, not connected to any external service.]{type="info"}

## 🔍 Step 5: Quick Health Check

Run our comprehensive health check script:

:::code{language=bash showCopyAction=true}
# Run workshop health check
curl -s https://raw.githubusercontent.com/aws-samples/eks-genai-workshop/main/scripts/health-check.sh | bash

# This checks:
# ✓ Cluster connectivity
# ✓ Required namespaces
# ✓ Pod health
# ✓ Service endpoints
# ✓ Model availability
:::

You should see all green checkmarks ✅. If any component shows ❌, notify your instructor.

## 📊 Step 6: Explore Your Environment

Take a moment to familiarize yourself with the deployed infrastructure:

### View Namespaces

:::code{language=bash showCopyAction=true}
# List all namespaces
kubectl get namespaces

# Key namespaces:
# - vllm: Model serving
# - litellm: API gateway
# - langfuse: Observability
# - openwebui: Chat interface
:::

### Check Resource Allocation

:::code{language=bash showCopyAction=true}
# View node resources
kubectl top nodes

# Check pod resource usage
kubectl top pods -A | grep -E "vllm|litellm"
:::

## 🎉 Success Checklist

Before proceeding to Module 1, confirm:

✅ **AWS Console** access working

✅ **Cloud9 IDE** opened and terminal ready

✅ **kubectl** connected to EKS cluster

✅ **All pods** in Running state

✅ **Open WebUI** accessible and account created

✅ **Health check** passed

## 🆘 Troubleshooting

::::tabs

:::tab{label="Cannot Access Workshop Studio"}
- Verify you're using the correct event URL
- Try a different browser or incognito mode
- Clear browser cache and cookies
- Ask instructor for the event access code
:::

:::tab{label="Pods Not Running"}
```bash
# Check pod events
kubectl describe pod <pod-name> -n <namespace>

# Check logs
kubectl logs <pod-name> -n <namespace>

# Common issues:
# - Image pull errors (temporary, wait 2-3 minutes)
# - Insufficient resources (notify instructor)
```
:::

:::tab{label="Cannot Access Open WebUI"}
```bash
# Check ingress status
kubectl get ingress -n openwebui

# Check ALB status in AWS Console
# EC2 → Load Balancers → Check health

# Try port-forward as backup
kubectl port-forward -n openwebui svc/openwebui 8080:80
# Then access http://localhost:8080
```
:::

::::

## 📚 Additional Resources

While waiting for others to complete setup:

- Review the [Infrastructure Overview](/introduction/infra-setup/)
- Explore the AWS Console to see deployed resources
- Check out the EKS cluster configuration
- Browse the pre-loaded models in `/models` directory

## 🚀 Ready for Module 1!

Congratulations! Your environment is ready. You have:

- ✅ Access to a fully configured EKS cluster
- ✅ GenAI platform components running
- ✅ Development environment set up
- ✅ All tools and access verified

You're now ready to start deploying and interacting with Large Language Models!

---

**[Continue to Infrastructure Overview →](/introduction/infra-setup/)**

**[Or jump directly to Module 1 →](/module1-interacting-with-models/)**
