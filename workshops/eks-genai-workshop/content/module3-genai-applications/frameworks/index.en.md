---
title: "Application Frameworks"
weight: 41
duration: "30 minutes"
---

# Application Frameworks

In this section, you'll learn to build GenAI applications using LangChain and LangGraph, the most popular frameworks for LLM application development.

## LangChain Fundamentals

LangChain provides building blocks for LLM applications:
- **Chains**: Sequential processing pipelines
- **Agents**: Autonomous decision-making systems
- **Memory**: Persistent context management
- **Tools**: External integrations and capabilities

### Basic Chain Example

```python
# simple_chain.py
from langchain.llms import OpenAI
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate
from langchain.memory import ConversationBufferMemory

class SimpleQAChain:
    def __init__(self, llm_url: str = "http://litellm-service:4000"):
        self.llm = OpenAI(
            base_url=llm_url,
            api_key="sk-1234",
            model_name="gpt-3.5-turbo"
        )
        
        self.memory = ConversationBufferMemory(
            memory_key="chat_history",
            return_messages=True
        )
        
        self.prompt = PromptTemplate(
            input_variables=["question", "chat_history"],
            template="""
            You are a helpful AI assistant. Use the chat history to provide context-aware responses.
            
            Chat History:
            {chat_history}
            
            Human: {question}
            Assistant:
            """
        )
        
        self.chain = LLMChain(
            llm=self.llm,
            prompt=self.prompt,
            memory=self.memory,
            verbose=True
        )
    
    def ask(self, question: str) -> str:
        """Ask a question and get a response"""
        response = self.chain.run(question=question)
        return response
    
    def clear_memory(self):
        """Clear conversation history"""
        self.memory.clear()

# Usage example
qa_chain = SimpleQAChain()
response = qa_chain.ask("What is machine learning?")
print(response)
```

### Advanced Chain with Tools

```python
# advanced_chain.py
from langchain.agents import Tool, AgentExecutor, create_react_agent
from langchain.tools import DuckDuckGoSearchRun, WikipediaQueryRun
from langchain.utilities import WikipediaAPIWrapper
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
from langchain.memory import ConversationBufferMemory

class AdvancedAgent:
    def __init__(self, llm_url: str = "http://litellm-service:4000"):
        self.llm = OpenAI(
            base_url=llm_url,
            api_key="sk-1234",
            model_name="gpt-3.5-turbo"
        )
        
        # Initialize tools
        self.tools = self._create_tools()
        
        # Create agent
        self.agent = self._create_agent()
    
    def _create_tools(self):
        """Create tools for the agent"""
        
        # Search tool
        search = DuckDuckGoSearchRun()
        search_tool = Tool(
            name="Search",
            func=search.run,
            description="Search the web for current information"
        )
        
        # Wikipedia tool
        wikipedia = WikipediaQueryRun(api_wrapper=WikipediaAPIWrapper())
        wiki_tool = Tool(
            name="Wikipedia",
            func=wikipedia.run,
            description="Get information from Wikipedia"
        )
        
        # Calculator tool
        def calculate(expression: str) -> str:
            """Safe calculator for basic math"""
            try:
                # Simple evaluation for basic math
                allowed_chars = set('0123456789+-*/.() ')
                if all(c in allowed_chars for c in expression):
                    result = eval(expression)
                    return str(result)
                else:
                    return "Error: Invalid characters in expression"
            except Exception as e:
                return f"Error: {str(e)}"
        
        calc_tool = Tool(
            name="Calculator",
            func=calculate,
            description="Calculate mathematical expressions"
        )
        
        return [search_tool, wiki_tool, calc_tool]
    
    def _create_agent(self):
        """Create ReAct agent with tools"""
        
        prompt = PromptTemplate(
            input_variables=["input", "agent_scratchpad", "tools", "tool_names"],
            template="""
            You are a helpful AI assistant with access to tools.
            
            Available tools:
            {tools}
            
            Use the following format:
            
            Question: the input question you must answer
            Thought: you should always think about what to do
            Action: the action to take, should be one of [{tool_names}]
            Action Input: the input to the action
            Observation: the result of the action
            ... (this Thought/Action/Action Input/Observation can repeat N times)
            Thought: I now know the final answer
            Final Answer: the final answer to the original input question
            
            Question: {input}
            Thought: {agent_scratchpad}
            """
        )
        
        agent = create_react_agent(
            llm=self.llm,
            tools=self.tools,
            prompt=prompt
        )
        
        return AgentExecutor(
            agent=agent,
            tools=self.tools,
            verbose=True,
            handle_parsing_errors=True
        )
    
    def run(self, query: str) -> str:
        """Run the agent with a query"""
        return self.agent.run(query)

# Usage example
agent = AdvancedAgent()
response = agent.run("What is the population of Tokyo and what is 15% of that number?")
print(response)
```

## LangGraph Workflows

LangGraph enables complex workflow orchestration with state management and conditional logic.

### Basic Workflow Example

```python
# langgraph_workflow.py
from langgraph import StateGraph, END
from langchain.llms import OpenAI
from typing import TypedDict, Annotated
import operator

class WorkflowState(TypedDict):
    messages: Annotated[list, operator.add]
    current_task: str
    results: dict
    iteration: int

class DocumentAnalysisWorkflow:
    def __init__(self, llm_url: str = "http://litellm-service:4000"):
        self.llm = OpenAI(
            base_url=llm_url,
            api_key="sk-1234",
            model_name="gpt-3.5-turbo"
        )
        
        self.workflow = self._create_workflow()
    
    def _create_workflow(self):
        """Create the workflow graph"""
        
        workflow = StateGraph(WorkflowState)
        
        # Add nodes
        workflow.add_node("analyze_document", self.analyze_document)
        workflow.add_node("extract_entities", self.extract_entities)
        workflow.add_node("summarize", self.summarize)
        workflow.add_node("validate_results", self.validate_results)
        
        # Add edges
        workflow.add_edge("analyze_document", "extract_entities")
        workflow.add_edge("extract_entities", "summarize")
        workflow.add_edge("summarize", "validate_results")
        
        # Add conditional edge for validation
        workflow.add_conditional_edges(
            "validate_results",
            self.should_retry,
            {
                "retry": "analyze_document",
                "finish": END
            }
        )
        
        # Set entry point
        workflow.set_entry_point("analyze_document")
        
        return workflow.compile()
    
    def analyze_document(self, state: WorkflowState):
        """Analyze document content"""
        document = state["messages"][-1] if state["messages"] else ""
        
        prompt = f"""
        Analyze the following document and identify:
        1. Main topics
        2. Key insights
        3. Document type
        4. Complexity level
        
        Document: {document}
        """
        
        response = self.llm.invoke(prompt)
        
        return {
            "messages": [response],
            "current_task": "analyze_document",
            "results": {**state["results"], "analysis": response},
            "iteration": state["iteration"]
        }
    
    def extract_entities(self, state: WorkflowState):
        """Extract named entities from document"""
        document = state["messages"][0] if state["messages"] else ""
        
        prompt = f"""
        Extract named entities from the following document:
        - Person names
        - Organizations
        - Locations
        - Dates
        - Key terms
        
        Document: {document}
        
        Return results in JSON format.
        """
        
        response = self.llm.invoke(prompt)
        
        return {
            "messages": state["messages"] + [response],
            "current_task": "extract_entities",
            "results": {**state["results"], "entities": response},
            "iteration": state["iteration"]
        }
    
    def summarize(self, state: WorkflowState):
        """Create document summary"""
        document = state["messages"][0] if state["messages"] else ""
        
        prompt = f"""
        Create a comprehensive summary of the following document:
        
        Document: {document}
        
        Include:
        - Executive summary (2-3 sentences)
        - Key points (bullet points)
        - Recommendations or next steps
        """
        
        response = self.llm.invoke(prompt)
        
        return {
            "messages": state["messages"] + [response],
            "current_task": "summarize",
            "results": {**state["results"], "summary": response},
            "iteration": state["iteration"]
        }
    
    def validate_results(self, state: WorkflowState):
        """Validate the quality of results"""
        results = state["results"]
        
        # Simple validation logic
        has_analysis = "analysis" in results and len(results["analysis"]) > 100
        has_entities = "entities" in results and len(results["entities"]) > 50
        has_summary = "summary" in results and len(results["summary"]) > 100
        
        validation_score = sum([has_analysis, has_entities, has_summary]) / 3
        
        return {
            "messages": state["messages"],
            "current_task": "validate_results",
            "results": {**results, "validation_score": validation_score},
            "iteration": state["iteration"] + 1
        }
    
    def should_retry(self, state: WorkflowState):
        """Determine if workflow should retry"""
        validation_score = state["results"].get("validation_score", 0)
        iteration = state["iteration"]
        
        if validation_score < 0.8 and iteration < 3:
            return "retry"
        return "finish"
    
    def run(self, document: str):
        """Run the workflow"""
        initial_state = {
            "messages": [document],
            "current_task": "",
            "results": {},
            "iteration": 0
        }
        
        result = self.workflow.invoke(initial_state)
        return result

# Usage example
workflow = DocumentAnalysisWorkflow()
document = """
The quarterly sales report shows a 15% increase in revenue compared to last quarter.
Our main products performed well, with the mobile app generating $2.3M in revenue.
The team at our Seattle office contributed significantly to this growth.
We recommend expanding our marketing efforts in the Pacific Northwest region.
"""

result = workflow.run(document)
print("Workflow Results:")
print(result["results"])
```

## Integration with LiteLLM and LangFuse

### Traced LangChain Application

```python
# traced_application.py
from langchain.llms import OpenAI
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate
from langchain.memory import ConversationBufferMemory
from langfuse.callback import CallbackHandler
import os

class TracedApplication:
    def __init__(self):
        # Initialize LangFuse callback
        self.callback_handler = CallbackHandler(
            host=os.getenv("LANGFUSE_HOST", "http://langfuse-service:3000"),
            public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
            secret_key=os.getenv("LANGFUSE_SECRET_KEY")
        )
        
        # Initialize LLM with LiteLLM
        self.llm = OpenAI(
            base_url="http://litellm-service:4000",
            api_key="sk-1234",
            model_name="gpt-3.5-turbo",
            callbacks=[self.callback_handler]
        )
        
        # Initialize memory
        self.memory = ConversationBufferMemory(
            memory_key="chat_history",
            return_messages=True
        )
        
        # Create chains
        self.qa_chain = self._create_qa_chain()
        self.summarization_chain = self._create_summarization_chain()
    
    def _create_qa_chain(self):
        """Create Q&A chain with tracing"""
        prompt = PromptTemplate(
            input_variables=["question", "chat_history"],
            template="""
            You are a helpful AI assistant. Answer the question based on the conversation history.
            
            Chat History:
            {chat_history}
            
            Question: {question}
            Answer:
            """
        )
        
        return LLMChain(
            llm=self.llm,
            prompt=prompt,
            memory=self.memory,
            callbacks=[self.callback_handler]
        )
    
    def _create_summarization_chain(self):
        """Create summarization chain with tracing"""
        prompt = PromptTemplate(
            input_variables=["text"],
            template="""
            Summarize the following text in 2-3 sentences:
            
            Text: {text}
            
            Summary:
            """
        )
        
        return LLMChain(
            llm=self.llm,
            prompt=prompt,
            callbacks=[self.callback_handler]
        )
    
    def ask_question(self, question: str, session_id: str = None, user_id: str = None):
        """Ask a question with tracing"""
        # Update callback with session info
        self.callback_handler.set_trace_params(
            session_id=session_id,
            user_id=user_id
        )
        
        response = self.qa_chain.run(question=question)
        return response
    
    def summarize_text(self, text: str, session_id: str = None, user_id: str = None):
        """Summarize text with tracing"""
        # Update callback with session info
        self.callback_handler.set_trace_params(
            session_id=session_id,
            user_id=user_id
        )
        
        response = self.summarization_chain.run(text=text)
        return response

# Usage example
app = TracedApplication()

# Q&A with tracing
response = app.ask_question(
    "What are the benefits of using LangChain?",
    session_id="demo-session-1",
    user_id="user-123"
)
print(response)

# Summarization with tracing
summary = app.summarize_text(
    "LangChain is a framework for developing applications powered by language models...",
    session_id="demo-session-1",
    user_id="user-123"
)
print(summary)
```

## Lab Exercise: Building a Knowledge Assistant

### Create a Complete Application

```python
# knowledge_assistant.py
from langchain.llms import OpenAI
from langchain.chains import LLMChain, ConversationChain
from langchain.prompts import PromptTemplate
from langchain.memory import ConversationSummaryBufferMemory
from langchain.agents import Tool, AgentExecutor, create_react_agent
from langchain.tools import DuckDuckGoSearchRun
from langfuse.callback import CallbackHandler
import streamlit as st
import os

class KnowledgeAssistant:
    def __init__(self):
        # Initialize tracing
        self.callback_handler = CallbackHandler(
            host=os.getenv("LANGFUSE_HOST", "http://langfuse-service:3000"),
            public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
            secret_key=os.getenv("LANGFUSE_SECRET_KEY")
        )
        
        # Initialize LLM
        self.llm = OpenAI(
            base_url="http://litellm-service:4000",
            api_key="sk-1234",
            model_name="gpt-3.5-turbo",
            callbacks=[self.callback_handler]
        )
        
        # Initialize memory
        self.memory = ConversationSummaryBufferMemory(
            llm=self.llm,
            max_token_limit=1000,
            memory_key="chat_history",
            return_messages=True
        )
        
        # Create tools and agent
        self.tools = self._create_tools()
        self.agent = self._create_agent()
    
    def _create_tools(self):
        """Create tools for the assistant"""
        search = DuckDuckGoSearchRun()
        
        def knowledge_search(query: str) -> str:
            """Search for knowledge on the web"""
            return search.run(query)
        
        def remember_fact(fact: str) -> str:
            """Remember a fact for later use"""
            # In a real implementation, this would store in a knowledge base
            return f"I'll remember that: {fact}"
        
        return [
            Tool(
                name="Search",
                func=knowledge_search,
                description="Search the web for current information"
            ),
            Tool(
                name="Remember",
                func=remember_fact,
                description="Remember important facts for later reference"
            )
        ]
    
    def _create_agent(self):
        """Create the knowledge assistant agent"""
        prompt = PromptTemplate(
            input_variables=["input", "agent_scratchpad", "tools", "tool_names", "chat_history"],
            template="""
            You are a knowledge assistant that helps users find and remember information.
            
            Chat History:
            {chat_history}
            
            Available tools:
            {tools}
            
            Use the following format:
            
            Question: the input question you must answer
            Thought: you should always think about what to do
            Action: the action to take, should be one of [{tool_names}]
            Action Input: the input to the action
            Observation: the result of the action
            ... (this Thought/Action/Action Input/Observation can repeat N times)
            Thought: I now know the final answer
            Final Answer: the final answer to the original input question
            
            Question: {input}
            Thought: {agent_scratchpad}
            """
        )
        
        agent = create_react_agent(
            llm=self.llm,
            tools=self.tools,
            prompt=prompt
        )
        
        return AgentExecutor(
            agent=agent,
            tools=self.tools,
            memory=self.memory,
            verbose=True,
            callbacks=[self.callback_handler]
        )
    
    def ask(self, question: str, session_id: str = None, user_id: str = None):
        """Ask the assistant a question"""
        self.callback_handler.set_trace_params(
            session_id=session_id,
            user_id=user_id
        )
        
        response = self.agent.run(question)
        return response

# Streamlit interface
def main():
    st.title("Knowledge Assistant")
    st.write("Ask me anything! I can search the web and remember facts.")
    
    # Initialize session state
    if "assistant" not in st.session_state:
        st.session_state.assistant = KnowledgeAssistant()
    
    if "messages" not in st.session_state:
        st.session_state.messages = []
    
    # Display chat history
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])
    
    # Chat input
    if prompt := st.chat_input("Ask me anything..."):
        # Add user message
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)
        
        # Get assistant response
        with st.chat_message("assistant"):
            with st.spinner("Thinking..."):
                response = st.session_state.assistant.ask(
                    prompt,
                    session_id=st.session_state.get("session_id", "default"),
                    user_id="streamlit-user"
                )
            st.markdown(response)
        
        # Add assistant response
        st.session_state.messages.append({"role": "assistant", "content": response})

if __name__ == "__main__":
    main()
```

## Deployment

### Create Kubernetes Deployment

```yaml
# knowledge-assistant-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: knowledge-assistant
  namespace: genai-platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app: knowledge-assistant
  template:
    metadata:
      labels:
        app: knowledge-assistant
    spec:
      containers:
      - name: assistant
        image: python:3.11-slim
        ports:
        - containerPort: 8501
        env:
        - name: LANGFUSE_HOST
          value: "http://langfuse-service:3000"
        - name: LANGFUSE_PUBLIC_KEY
          valueFrom:
            secretKeyRef:
              name: langfuse-secrets
              key: public_key
        - name: LANGFUSE_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: langfuse-secrets
              key: secret_key
        command:
        - sh
        - -c
        - |
          pip install streamlit langchain langfuse duckduckgo-search
          streamlit run /app/knowledge_assistant.py --server.port=8501 --server.address=0.0.0.0
        volumeMounts:
        - name: app-code
          mountPath: /app
      volumes:
      - name: app-code
        configMap:
          name: knowledge-assistant-code
---
apiVersion: v1
kind: Service
metadata:
  name: knowledge-assistant-service
  namespace: genai-platform
spec:
  selector:
    app: knowledge-assistant
  ports:
  - port: 8501
    targetPort: 8501
```

## Best Practices

1. **Start Simple**: Begin with basic chains before moving to complex workflows
2. **Use Memory Wisely**: Choose appropriate memory types for your use case
3. **Tool Design**: Create focused, single-purpose tools
4. **Error Handling**: Implement robust error handling and retries
5. **Observability**: Always include tracing and monitoring
6. **Testing**: Write comprehensive tests for your chains and agents

## Next Steps

Now that you understand application frameworks, let's explore [Memory Stores](/module3-genai-applications/memory-stores/) to add persistent memory capabilities to your applications. 