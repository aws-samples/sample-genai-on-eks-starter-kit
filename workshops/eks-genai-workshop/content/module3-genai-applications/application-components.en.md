---
title: "Application Components"
date: 2025-08-13T11:05:19-07:00
weight: 250
draft: true
---

Now you understand the use-case, let's understand a little bit how the application components are connected.

### The Big Picture

In the previous module, you have been working with AI Gateway (LiteLLM) and Observability (LangFuse). And you know from the previous section that application consists of Agentic module and a couple of MCP Servers. You have hosted both AI Gateway and Observability components onto EKS to get the benefits of just in time scaling (via Karpenter) and reliability through Kubernetes Scheduler.

You will also deploy the application components onto Amazon EKS using pods for each application component. One for the agentic module, and one each for the MCP server. The following diagram shows how they are all deployed and connected with each other. Two important things to notice here is that first, all the calls from agentic application to LLM and the MCP Servers are routed through the AI Gateway, providing consistent security and routing control. Secondly, all the eco-system components such as Agentic Application and AI Gateway are sending observability data to the LangFuse, resulting in nt only capturing metrics for individual calls but capturing end to end interaction for each workflow also.

Here is the component diagram where black arrows shows the call flow while the red dotted arrows showcase the observability hooks.

<!-- ![The Big Picture](../../static/images/module-3/gen-ai-on-eks.png)
*Loan Buddy Application Components* -->

```mermaid
---
title: Loan Buddy Application Components hosted on Amazon EKS
---
graph TD
    User("fa:fa-user User") --> AgenticApp

    subgraph "EKS"
        direction LR
        AgenticApp["Agentic Application"]
        AIGateway["AI Gateway"]
        Observability["Observability"]
        MCP_Address["MCP Server for Address Validation"]
        MCP_Employment["MCP Server for Employment Validation"]

        AgenticApp --> AIGateway
        AIGateway --> MCP_Address
        AIGateway --> MCP_Employment
        
        style AgenticApp fill:#fff,stroke:#f60,stroke-width:2px
        style AIGateway fill:#fff,stroke:#f60,stroke-width:2px
        style Observability fill:#fff,stroke:#f60,stroke-width:2px
        style MCP_Address fill:#fff,stroke:#f60,stroke-width:2px
        style MCP_Employment fill:#fff,stroke:#f60,stroke-width:2px
    end
    
    LLM["Amazon BedRock"]
    style LLM fill:#fff,stroke:#0c9,stroke-width:2px

    AIGateway --> LLM
    
    linkStyle 0 stroke-width:1px,fill:none,stroke:black;
    linkStyle 1 stroke-width:1px,fill:none,stroke:black;
    linkStyle 2 stroke-width:1px,fill:none,stroke:black;
    linkStyle 3 stroke-width:1px,fill:none,stroke:black;

    AgenticApp -.-> Observability
    AIGateway -.-> Observability
    
    
    linkStyle 4 stroke-width:1px,fill:none,stroke:black;
    linkStyle 5 stroke-width:1px,fill:none,stroke:red,stroke-dasharray: 5 5;
    linkStyle 6 stroke-width:1px,fill:none,stroke:red,stroke-dasharray: 5 5;
```

## Application Components

- The file [`accounting-agent-demo.py`](../../static/code/accounting-agent-demo.py) consists of the agentic workflow prompt, the list of tools to call and the observability integration. Make sure you can identify each part of the agentic application.
- The files [`mcp-address-validator`](../../static/code/mcp-company-validatior.py) and [`mcp-address-validator`](../../static/code/mcp-company-validatior.py) are the MCP servers. See how they are exposing what they can do via the description of the mcp annotation.
- The deployment files where they are deployed to Amazon EKS as pods.

### Challenge

How do you change your application to validate that the 25% of the total income should be greater than the 4% of the loan amount?
