# Building GenAI Applications

So you have seen the platform components in the previous chapter. In this chapter you will build a complete GenAI applications using the platform component that you have just deployed.

The aim for this chapter is to help you building GenAI applications, fast, with the help of platform components and get ready for production.

Let's start with a use-case.

## Use Case for GenAI App
When you are builiding a GenAI app, the first question should be what value it will deliever to your customers and the business. Our imaginary application aims to reduce the time it takes for small business to process and upload payments onto the accountint system. Let's call it XXXX

The app will do the following assisst users to upload a single or multiple PDF files. The applicatin will use the LLM to extract information from the uploaded receipts and apply business riles.
the application will mock use third party services to validate company infomraiotn and corretcly code the expense type for accounting purposes.

### Components of GenAI application

Any GenAI app you will build, may have the following components.
- Orchestration: How GenAI help us simplify code and write our instructions in plain english
- Knowledge: How MCP servers improve the context for LLM for better business outcomes
- Memory: LLMs are stateless. We will see how the orchestration layer provides memory to maintain state across sessions and effectively perform complicated tasks.
- Validation and Measurement. We will touch base on how LangFuse help us to capture and measure the performance of our application.

Let's see how our application fits the mould

- Orchestration: 