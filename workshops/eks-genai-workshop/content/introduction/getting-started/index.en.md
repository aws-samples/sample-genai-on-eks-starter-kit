---
title: "Getting Started"
chapter: true
weight: 12
---

Before we dive into deploying Large Language Models and building intelligent agents, let's ensure you have access to the workshop environment. This workshop can be completed in two ways, depending on how you're participating.

## 🎯 Choose Your Path

::::tabs

:::tab{label="AWS Event"}
### 🎪 Participating in an AWS Event

**Your infrastructure is pre-deployed and ready!** 

The event organizers have already set up:
- ✅ EKS cluster with all required components
- ✅ GenAI platform stack (vLLM, LiteLLM, Langfuse)
- ✅ Model storage and caching
- ✅ Networking and security configurations

[**Continue with AWS Event Setup →**](/introduction/getting-started/at-aws-event/)
:::

:::tab{label="Own Account"}
### 💻 Using Your Own AWS Account

Running this workshop independently in your personal or company AWS account gives you:
- Full control over the environment
- Ability to keep resources after the workshop
- Opportunity to customize configurations
- Deeper understanding of the infrastructure

**You'll need to**:
- ✅ Have an AWS account with appropriate permissions
- ✅ Deploy the workshop infrastructure
- ✅ Configure access to the EKS cluster
- ✅ Verify all components are running

::alert[**Cost Warning**: This workshop uses GPU and Neuron instances which incur charges. Remember to clean up resources after completion!]{type="warning"}

[**Continue with Own Account Setup →**](/introduction/getting-started/self-account/)
:::

---

**Ready? Select your path above to continue!**
