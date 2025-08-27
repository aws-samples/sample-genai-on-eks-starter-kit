---
title: "Understanding the agentic use-case"
date: 2025-08-13T11:05:19-07:00
weight: 150
draft: true
---

Let's start with a use-case.

### Use Case for GenAI App

When you are building a GenAI app, the first question should be what value it will deliver to your customers and the business.
Our prototype application aims to reduce the time it takes for banks to process credit loan applications. We call it Loan Buddy :)

The app will do the following:

- Read and extract information from a loan application form. The form is presented as an image.
- Apply basic checks on the the extracted data such as amount of loan requested cannot be greater than 10,000.
- Use external services to validate the application address and employment history
- Mark load as approved or move to manual processing queue.

The business will benefit with faster loan processing resulting in improved customer satisfaction and less chances of error due to manual validation.

### Components of GenAI application

Any GenAI app you will build, may have the following components.

- Orchestration: How GenAI help us simplify code and write our instructions in plain english
- Knowledge: How MCP servers improve the context for LLM for better business outcomes
- Memory: LLMs are stateless. We will see how the orchestration layer provides memory to maintain state across sessions and effectively perform complicated tasks.

Let's see how our application fits the for this mould.

#### Orchestration

We are using LangGraph to build the workflow. As you will see in the code file [`accounting-agent-demo.py`](../../static/code/accounting-agent-demo.py) that the workflow instructions are passed in plain English Language. One of te top benefits of agentic applications that it is becoming easier to instruct resulting in better adoption of business requirements.

Examine the prompt and see how does it fits to our requirements mentioned above.

The LLM we use not only drive the workflow but decide when to call the external tools to apply business rules.

#### Contextual Knowledge

The foundation model will not have the relevant data to validate addresses or perform employment validation as per our business requirements.

However, the prompt in the agents is instructing the model to call the relevant tools for such tasks. These tools have been developed using MCP protocol.
You mention all the tools available to the agent in the [`accounting-agent-demo.py`](../../static/code/accounting-agent-demo.py). From there, based on your prompts, the agent will decide when to call the right tool. How does the agent decides what tool to call?

You can find the tool that validate the address at [`mcp-address-validator`](../../static/code/mcp-company-validatior.py). Notice that using the `mcp` annotation bring on the functionality to support MCP protocol. You also mention what the tool does and this information will be used by the agent to select the right tool specific steps in your workflow. Here you are describing functionality using plain english. Talk about easy to code.

#### Memory

LLMs are stateless. Your workflow needs to make multiple calls to run the workflow, such as deciding the workflow steps by LLM, calling MCP tools and then sending all this data back to LLM to perform validations. LangGraph provides way to save data from all of these calls and keep on adding in to the context. Think of it as a session, where all the interactions are being kept in a state memory. Using LangGraph you can seamlessly uses the application memory to hold the state. It allows you to use external systems such as PostgreSQL to maintain state, but for this use case, we are going to use the memory state.

### Observability

Last but not the least, think about how are you going to collect the data across multiple calls for debugging and/or security and compliance reasons. LangFuse provides a way to capture the trace of your workflow with tight integration with the agent. You will find that in the [`accounting-agent-demo.py`](../../static/code/accounting-agent-demo.py) file.
