---
title: "The application usecase"
date: 2025-08-13T11:05:19-07:00
weight: 250
draft: true
---

Let's start with a use-case.

### Use Case for GenAI App

When you are building a GenAI app, the first question should be what value it will deliver to your customers and the business. Our imaginary application aims to reduce the time it takes for small business to process and upload payments onto the accounting system. Let's call it XXXX

The app will do the following assist users to upload a single or multiple PDF files. The application  will use the LLM to extract information from the uploaded receipts and apply business rules.
the application will mock use third party services to validate company information and correctly code the expense type for accounting purposes.

### Components of GenAI application

Any GenAI app you will build, may have the following components.

- Orchestration: How GenAI help us simplify code and write our instructions in plain english
- Knowledge: How MCP servers improve the context for LLM for better business outcomes
- Memory: LLMs are stateless. We will see how the orchestration layer provides memory to maintain state across sessions and effectively perform complicated tasks.
- Validation and Measurement. We will touch base on how LangFuse help us to capture and measure the performance of our application.

Let's see how our application fits the mould

#### Orchestration
