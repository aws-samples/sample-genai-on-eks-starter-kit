---
title: "Using Your Own Account"
weight: 16
---

# Using Your Own Account

Running this workshop in your own AWS account gives you complete control over the environment and the ability to experiment beyond the workshop timeline. Let's deploy the GenAI infrastructure stack and get you ready for an incredible learning journey!

## 📋 Prerequisites

Before starting, ensure you have:

### AWS Account Requirements
- ✅ AWS account with administrative access
- ✅ Service quotas for:
  - EKS clusters (1)
  - inf2.xlarge instances (minimum 2)
  - g5.xlarge instances (optional, for GPU modules)
  - VPC Elastic IPs (5)
- ✅ Estimated cost: ~$10-15/hour during workshop

::alert[**Cost Warning**: This workshop uses specialized ML instances. Remember to run the cleanup script when finished!]{type="warning"}

### Local Environment Requirements
- ✅ AWS CLI v2 installed and configured
- ✅ kubectl v1.28+ installed
- ✅ eksctl v0.150+ installed
- ✅ Git installed
- ✅ Terminal with bash/zsh

## 🚀 Step 1: Clone Workshop Repository

First, get the workshop materials and infrastructure code:

:::code{language=bash showCopyAction=true}
# Clone the workshop repository
git clone https://github.com/aws-samples/eks-genai-workshop.git
cd eks-genai-workshop

# Set workshop home directory
export WORKSHOP_HOME=$(pwd)
echo "Workshop directory: $WORKSHOP_HOME"
:::

## 🏗️ Step 2: Deploy Infrastructure Stack

We'll use an automated deployment script that creates all required resources:

### 2.1 Set Deployment Parameters

:::code{language=bash showCopyAction=true}
# Set your desired AWS region (us-west-2 recommended for Neuron availability)
export AWS_REGION=us-west-2
export CLUSTER_NAME=genai-workshop-cluster

# Verify your AWS credentials
aws sts get-caller-identity
:::

### 2.2 Run Infrastructure Deployment

:::code{language=bash showCopyAction=true}
# Deploy the complete GenAI infrastructure
./scripts/deploy-infrastructure.sh

# This script will:
# 1. Create EKS cluster with Auto Mode
# 2. Deploy specialized node pools (Neuron, GPU)
# 3. Install GenAI platform components
# 4. Configure networking and security
# 5. Pre-load models and configure storage
:::

The deployment takes approximately 15-20 minutes. You'll see progress updates as each component is deployed.

### 2.3 Monitor Deployment Progress

:::code{language=bash showCopyAction=true}
# Watch cluster creation
eksctl get cluster --region $AWS_REGION

# Monitor node provisioning
kubectl get nodes --watch

# Check GenAI stack deployment
kubectl get pods -A | grep -E "vllm|litellm|langfuse|openwebui"
:::

## ✅ Step 3: Verify Deployment

Once deployment completes, verify all components are working:

### 3.1 Check Cluster Status

:::code{language=bash showCopyAction=true}
# Verify cluster access
kubectl cluster-info

# Check all nodes are ready
kubectl get nodes

# Verify specialized hardware nodes
kubectl get nodes -l node.kubernetes.io/instance-type=inf2.xlarge
:::

### 3.2 Verify GenAI Components

:::code{language=bash showCopyAction=true}
# Check vLLM model servers
kubectl get pods -n vllm

# Check platform components
kubectl get pods -n litellm
kubectl get pods -n langfuse
kubectl get pods -n openwebui

# All pods should be in Running state
:::

### 3.3 Get Service Access URLs

:::code{language=bash showCopyAction=true}
# Get Open WebUI URL
export OPENWEBUI_URL=$(kubectl get ingress -n openwebui openwebui -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "Open WebUI: https://$OPENWEBUI_URL"

# Get Langfuse URL
export LANGFUSE_URL=$(kubectl get ingress -n langfuse langfuse -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "Langfuse: https://$LANGFUSE_URL"

# Save URLs for later use
echo "export OPENWEBUI_URL=$OPENWEBUI_URL" >> ~/.bashrc
echo "export LANGFUSE_URL=$LANGFUSE_URL" >> ~/.bashrc
:::

## 🔧 Step 4: Configure Access

### 4.1 Set Up Open WebUI

1. Navigate to your Open WebUI URL
2. Create an admin account:
   - Email: admin@workshop.local
   - Password: Choose a secure password
3. Verify you can access the chat interface

### 4.2 Configure Langfuse

1. Navigate to your Langfuse URL
2. Create an account for observability access
3. Create a new project called "GenAI Workshop"
4. Generate API keys for integration

### 4.3 Test Model Access

:::code{language=bash showCopyAction=true}
# Test vLLM model endpoint
curl -X POST "http://$(kubectl get svc -n vllm llama-3-1-8b -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3-1-8b",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }'
:::

## 🔍 Step 5: Run Health Check

Execute our comprehensive health check:

:::code{language=bash showCopyAction=true}
# Run workshop health check
./scripts/health-check.sh

# This verifies:
# ✓ Cluster connectivity
# ✓ All pods running
# ✓ Service endpoints accessible
# ✓ Models responding
# ✓ Observability configured
:::

## 💰 Step 6: Cost Management Setup

### 6.1 Enable Cost Monitoring

:::code{language=bash showCopyAction=true}
# Tag resources for cost tracking
aws eks tag-resource \
  --resource-arn $(aws eks describe-cluster --name $CLUSTER_NAME --query 'cluster.arn' --output text) \
  --tags workshop=genai-eks,environment=learning

# Set up cost alerts (optional)
./scripts/setup-cost-alerts.sh
:::

### 6.2 Understand Costs

Your workshop environment costs approximately:
- **inf2.xlarge nodes**: ~$0.76/hour each (2 nodes = ~$1.52/hour)
- **EKS cluster**: $0.10/hour
- **Load balancers**: ~$0.025/hour each
- **Storage**: ~$0.10/hour
- **Total**: ~$2-3/hour when running

## 🎉 Success Checklist

Before proceeding to Module 1, confirm:

✅ **EKS cluster** created and accessible

✅ **All GenAI pods** in Running state

✅ **Open WebUI** accessible with account created

✅ **Langfuse** accessible with project configured

✅ **Model endpoints** responding to test requests

✅ **Health check** passed completely

## 🆘 Troubleshooting

::::tabs

:::tab{label="Deployment Failures"}
```bash
# Check deployment logs
./scripts/check-deployment-status.sh

# Common issues:
# - Insufficient quotas (request increases)
# - Region doesn't support inf2 (try us-west-2)
# - IAM permissions (ensure admin access)

# Retry deployment
./scripts/deploy-infrastructure.sh --retry
```
:::

:::tab{label="Pods Not Starting"}
```bash
# Check pod events
kubectl describe pod <pod-name> -n <namespace>

# Check node resources
kubectl describe nodes

# Scale down if resource constrained
kubectl scale deployment <deployment> --replicas=1 -n <namespace>
```
:::

:::tab{label="Service Access Issues"}
```bash
# Check ingress status
kubectl get ingress -A

# Verify load balancer provisioning
aws elbv2 describe-load-balancers

# Use port-forward as backup
kubectl port-forward -n openwebui svc/openwebui 8080:80
```
:::

::::

## 🧹 Cleanup Instructions

::alert[**Important**: Remember to clean up resources after the workshop to avoid ongoing charges!]{type="warning"}

When you're finished with the workshop:

:::code{language=bash showCopyAction=true}
# Run the cleanup script
./scripts/cleanup-infrastructure.sh

# This will:
# - Delete the EKS cluster
# - Remove all associated resources
# - Clean up storage volumes
# - Delete load balancers and networking

# Verify cleanup completed
aws eks list-clusters --region $AWS_REGION
:::

## 📚 Additional Configuration

### Optional: Enable Advanced Features

:::code{language=bash showCopyAction=true}
# Enable GPU support (if you have g5 instances)
./scripts/enable-gpu-support.sh

# Configure additional models
./scripts/deploy-additional-models.sh

# Set up custom monitoring
./scripts/setup-advanced-monitoring.sh
:::

## 🚀 Ready for Module 1!

Congratulations! Your personal GenAI environment is ready. You have:

- ✅ Complete control over the infrastructure
- ✅ All GenAI components deployed and verified
- ✅ Cost monitoring and cleanup procedures
- ✅ Ability to experiment beyond the workshop

You're now ready to start deploying and interacting with Large Language Models!

---

**[Continue to Infrastructure Overview →](/introduction/infra-setup/)**

**[Or jump directly to Module 1 →](/module1-interacting-with-models/)**
