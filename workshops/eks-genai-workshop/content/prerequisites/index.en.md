---
title: "Prerequisites and Setup"
weight: 10
duration: "30 minutes"
---

# Prerequisites and Setup

Before starting this workshop, you'll need to set up your environment and ensure you have the necessary tools and permissions.

## Required Tools

### 1. AWS CLI
Ensure you have AWS CLI v2 installed and configured:
```bash
aws --version
aws configure list
```

### 2. kubectl
Install kubectl for Kubernetes cluster management:
```bash
kubectl version --client
```

### 3. Docker
Docker is required for container operations:
```bash
docker --version
```

### 4. Helm
Install Helm for Kubernetes package management:
```bash
helm version
```

### 5. Python 3.8+
Python is needed for various scripts and applications:
```bash
python3 --version
pip3 --version
```

## AWS Permissions

Your AWS user/role needs the following permissions:
- EKS cluster creation and management
- EC2 instances and security groups
- VPC and networking resources
- IAM roles and policies
- EBS and EFS storage
- ECR repositories

## Workshop Environment

### Option 1: AWS Workshop Studio
If you're using AWS Workshop Studio, your environment is pre-configured with:
- AWS credentials
- kubectl configured for your EKS cluster
- All required tools installed

### Option 2: Local Environment
For local setup, you'll need to:
1. Configure AWS credentials
2. Install all required tools listed above
3. Set up kubectl context for your EKS cluster

## Environment Validation

Run the following commands to validate your setup:

```bash
# Check AWS connectivity
aws sts get-caller-identity

# Check kubectl connectivity (after cluster creation)
kubectl get nodes

# Check Docker
docker ps

# Check Python packages
pip3 install --upgrade pip
pip3 install langchain langsmith langfuse
```

## What's Next

Once your environment is set up, you'll be ready to start with [Module 1: LLM Optimization and Evaluation](/module1-llm-optimization/). 