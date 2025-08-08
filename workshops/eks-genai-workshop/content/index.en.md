---
title: "EKS GenAI Workshop: From LLMs to Scalable Agent Systems"
weight: 0
---

# EKS GenAI Workshop: From LLMs to Scalable Agent Systems

Welcome to the EKS GenAI Workshop! This comprehensive, hands-on learning experience is designed for engineers interested in deploying and scaling generative AI applications on Amazon EKS.

## Workshop Overview

This workshop will guide you through a progressive learning path from basic LLM optimization to building complete agentic platforms. You'll work with cutting-edge GenAI technologies and learn to deploy production-ready solutions.

### What You'll Learn

- **Module 1: Optimizing and Evaluating OSS LLMs on EKS** - Master LLM inferencing techniques (tensor parallelism, quantization, KV Cache) and evaluation using LLM-as-a-judge
- **Module 2: GenAI Application Components** - Build a secure GenAI platform for agentic applications with comprehensive observability using LangFuse and LangSmith, network monitoring with Hubble, and AI Gateway using LiteLLM
- **Module 3: Building GenAI Applications** - Create practical agentic applications with Lang* frameworks, memory stores, MCP, and explore use cases like IDP and agentic RAG
- **Module 4: Scaling and Securing Agents** - Implement distributed inferencing, modern security practices, and cost calculation for agentic transactions

### Technologies Covered

- **Amazon EKS** - Kubernetes platform for container orchestration
- **Pod Identity** - Modern authentication for AWS services
- **ACK Controllers** - Native AWS resource management
- **LeaderWorkerSet (LWS)** - Distributed model serving pattern
- **vLLM** - High-performance inference server
- **LangChain/LangGraph** - Application development frameworks
- **LangFuse** - Open-source observability and tracing for GenAI
- **LangSmith** - Advanced debugging and prompt optimization
- **Hubble** - Network-level observability and security analysis
- **LiteLLM** - Unified API gateway for multiple LLM providers
- **Vector Databases** - Persistent memory for agentic applications
- **Model Context Protocol (MCP)** - Tool integration standard

### Workshop Structure

This workshop is organized into four progressive modules:

1. **Prerequisites** - Environment setup and foundational knowledge
2. **Module 1: Optimizing and Evaluating OSS LLMs on EKS** (2 hours)
   - Inferencing techniques (LWS, tensor parallelism, quantization, KV Cache)
   - LLM Evaluation using LLM-as-a-judge technique
3. **Module 2: GenAI Application Components** (2.5 hours)
   - Building the GenAI platform for Agentic applications
   - Observability using LangFuse and LangSmith
   - Network monitoring with Hubble
   - AI Gateway using LiteLLM
4. **Module 3: Building GenAI Applications** (2.5 hours)
   - Lang* frameworks
   - Memory Stores
   - Model Context Protocol (MCP)
   - From one agent to many
   - Use cases (IDP, Construction defects management)
   - Agentic RAG
5. **Module 4: Scaling and Securing Agents** (1.5 hours)
   - Distributed Inferencing via LWS and vLLM
   - Modern Security with Pod Identity and ACK controllers
   - Calculating cost for agentic transactions

### Target Audience

This workshop is designed for:
- Software engineers building GenAI applications
- DevOps engineers deploying AI workloads
- Solution architects designing GenAI platforms
- ML engineers working with LLMs in production

### Prerequisites

Before starting this workshop, you should have:
- Basic Kubernetes knowledge and kubectl experience
- AWS CLI configured with appropriate permissions
- Docker experience for container management
- Python programming experience
- Familiarity with REST APIs and microservices

### Learning Objectives

By the end of this workshop, you will be able to:
- Deploy and optimize open-source LLMs on Amazon EKS
- Build scalable GenAI platform components with proper observability
- Create agentic applications using modern frameworks
- Implement production-ready scaling and security measures
- Calculate and monitor costs for GenAI workloads

Ready to begin? Let's start with the [Prerequisites](/prerequisites/) section to set up your environment.