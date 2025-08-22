---
title: "Using Your Own Account"
weight: 16
---

# THIS IS NOT VALIDATED - GENAI SLOP | Will rewrite later!

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

## ✅ Step 3: Access Your Development Environment

### 3.1 Open VSC IDE

Once deployment completes, you'll need access to a development environment:

:::code{language=bash showCopyAction=true}
# If using local development
kubectl config current-context

# Verify cluster access
kubectl cluster-info
:::

Alternatively, you can set up a cloud-based IDE by deploying VSC Server:

:::code{language=bash showCopyAction=true}
# Deploy VSC Server (optional)
./scripts/deploy-vsc-server.sh

# Get VSC Server URL
kubectl get ingress -n vsc-server
:::

## 🎉 Setup Complete!

Congratulations! You now have:

✅ **EKS cluster** deployed and accessible

✅ **GenAI infrastructure** deployed

✅ **Development environment** configured

✅ **kubectl** connected to your cluster

## 💰 Cost Management

::alert[**Important**: Your workshop environment costs ~$2-3/hour. Remember to clean up when finished!]{type="warning"}

### Cleanup Instructions

When you're finished with the workshop:

:::code{language=bash showCopyAction=true}
# Run the cleanup script
./scripts/cleanup-infrastructure.sh

# Verify cleanup completed
aws eks list-clusters --region $AWS_REGION
:::

## 🚀 What's Next?

Now that your infrastructure is deployed and you have development environment access, let's explore the GenAI components and verify everything is working correctly.

---

**[Continue to Infrastructure Overview →](/introduction/infra-setup/)**
