# EKS GenAI Workshop: From LLMs to Scalable Agent Systems

An 8-hour intermediate-level AWS Workshop Studio project that teaches engineers how to build production-ready Generative AI platforms on Amazon EKS.

## Overview

This workshop provides comprehensive guidance on deploying and scaling Generative AI applications using Kubernetes on Amazon EKS. Through hands-on labs and progressive modules, participants learn to optimize LLMs, build scalable platform components, and create intelligent agentic applications.

## Workshop Structure

### Module 1: LLM Optimization
- Optimize open-source LLMs using LeaderWorkerSet (LWS) pattern
- Implement tensor parallelism, quantization, and KV-cache optimization
- Build evaluation frameworks for model performance

### Module 2: GenAI Platform Components
- Design scalable platform architecture on Amazon EKS
- Implement AI gateways with LiteLLM for unified API access
- Set up observability with LangFuse and LangSmith
- Configure network observability and monitoring

### Module 3: Agentic Applications
- Build intelligent applications using LangChain/LangGraph
- Integrate vector databases for persistent memory
- Implement Model Context Protocol (MCP) for tool integration
- Create multi-agent systems and agentic RAG applications

### Module 4: Scaling & Security
- Implement distributed inference patterns
- Configure production-ready security with Pod Identity and ACK controllers
- Optimize costs and resource utilization
- Deploy at scale with proper monitoring

## Prerequisites

- Basic Kubernetes knowledge
- AWS CLI configured
- Docker experience
- Python programming experience

## Key Technologies

- **Container Orchestration**: Amazon EKS
- **Security**: Pod Identity, ACK Controllers
- **Model Serving**: LeaderWorkerSet (LWS), vLLM
- **Application Frameworks**: LangChain, LangGraph
- **Observability**: LangFuse, LangSmith
- **API Gateway**: LiteLLM
- **Memory**: Vector Databases
- **Tool Integration**: Model Context Protocol (MCP)

## Workshop Details

- **Duration**: 8 hours
- **Difficulty**: Intermediate
- **Target Audience**: Engineers
- **Format**: AWS Workshop Studio

## Getting Started

1. Access the workshop through AWS Workshop Studio
2. Complete the prerequisites section to set up your environment
3. Follow the modules in sequence for optimal learning
4. Each module builds upon previous concepts

## Repository Structure

```
content/
├── index.en.md                    # Main landing page
├── prerequisites/                 # Environment setup
├── module1-llm-optimization/      # LLM optimization techniques
├── module2-genai-components/      # Platform architecture
├── module3-genai-applications/    # Building agentic applications
└── module4-scaling-security/      # Production deployment
```

## Development

This is a documentation-only project following AWS Workshop Studio standards. Content is written in Markdown with YAML front matter for navigation and organization.

## License

This workshop content is provided as educational material for AWS Workshop Studio.