---
title: "LangSmith Advanced Debugging"
weight: 33
duration: "30 minutes"
difficulty: "intermediate"
---

# LangSmith Advanced Debugging and Prompt Optimization

Learn how to use LangSmith for advanced debugging, prompt optimization, and performance analysis of your GenAI applications.

## Overview

LangSmith is LangChain's commercial platform for debugging, testing, and monitoring LLM applications. It provides detailed insights into chain execution, prompt performance, and model behavior.

## Learning Objectives

By the end of this lab, you will be able to:
- Set up LangSmith for comprehensive debugging
- Trace complex agent workflows step-by-step
- Optimize prompts using LangSmith's evaluation tools
- Compare LangSmith with LangFuse for different use cases
- Implement automated testing and evaluation pipelines

## Prerequisites

- Completed [LangFuse Integration](/module2-genai-components/observability/)
- LangSmith API key (sign up at smith.langchain.com)
- Understanding of LangChain concepts

## LangSmith vs LangFuse Comparison

| Feature | LangSmith | LangFuse |
|---------|-----------|----------|
| **Cost** | Commercial | Open Source |
| **Debugging** | Advanced step-by-step | Basic tracing |
| **Prompt Optimization** | Built-in tools | Manual analysis |
| **Testing** | Automated test suites | Custom implementation |
| **Integration** | LangChain native | Framework agnostic |

## Lab: Setting Up LangSmith

### Step 1: Configure LangSmith Environment

Create LangSmith configuration:

```yaml
# langsmith-config.yaml
apiVersion: v1
kind: Secret
metadata:
  name: langsmith-secrets
  namespace: genai-platform
type: Opaque
stringData:
  LANGCHAIN_API_KEY: "your-langsmith-api-key"
  LANGCHAIN_PROJECT: "eks-genai-workshop"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: langsmith-config
  namespace: genai-platform
data:
  LANGCHAIN_TRACING_V2: "true"
  LANGCHAIN_ENDPOINT: "https://api.smith.langchain.com"
```

### Step 2: Deploy LangSmith-Enabled Application

```yaml
# langsmith-app.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: langsmith-demo-app
  namespace: genai-platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app: langsmith-demo-app
  template:
    metadata:
      labels:
        app: langsmith-demo-app
    spec:
      containers:
      - name: demo-app
        image: python:3.11-slim
        command: ["/bin/bash"]
        args: ["-c", "while true; do sleep 30; done"]
        env:
        - name: LANGCHAIN_TRACING_V2
          valueFrom:
            configMapKeyRef:
              name: langsmith-config
              key: LANGCHAIN_TRACING_V2
        - name: LANGCHAIN_ENDPOINT
          valueFrom:
            configMapKeyRef:
              name: langsmith-config
              key: LANGCHAIN_ENDPOINT
        - name: LANGCHAIN_API_KEY
          valueFrom:
            secretKeyRef:
              name: langsmith-secrets
              key: LANGCHAIN_API_KEY
        - name: LANGCHAIN_PROJECT
          valueFrom:
            secretKeyRef:
              name: langsmith-secrets
              key: LANGCHAIN_PROJECT
        volumeMounts:
        - name: app-code
          mountPath: /app
        workingDir: /app
      volumes:
      - name: app-code
        configMap:
          name: langsmith-demo-code
---
apiVersion: v1
kind: Service
metadata:
  name: langsmith-demo-service
  namespace: genai-platform
spec:
  selector:
    app: langsmith-demo-app
  ports:
  - port: 8000
    targetPort: 8000
  type: ClusterIP
```

### Step 3: Create Advanced Debugging Examples

```python
# langsmith_debugging_examples.py
import os
from langchain.llms import OpenAI
from langchain.chains import LLMChain, SimpleSequentialChain
from langchain.prompts import PromptTemplate
from langchain.agents import create_react_agent, AgentExecutor
from langchain.tools import Tool
from langchain.memory import ConversationBufferMemory
from langsmith import Client
import asyncio

# Initialize LangSmith client
client = Client()

class AdvancedLangSmithDebugging:
    def __init__(self):
        self.llm = OpenAI(
            base_url="http://litellm-service:4000/v1",
            api_key="sk-1234",
            model_name="gpt-3.5-turbo"
        )
    
    def create_complex_chain(self):
        """Create a complex chain for debugging demonstration"""
        
        # Step 1: Analysis prompt
        analysis_template = """
        Analyze the following user query and identify:
        1. The main intent
        2. Required information
        3. Potential challenges
        
        Query: {query}
        
        Analysis:
        """
        analysis_prompt = PromptTemplate(
            input_variables=["query"],
            template=analysis_template
        )
        analysis_chain = LLMChain(llm=self.llm, prompt=analysis_prompt)
        
        # Step 2: Solution generation prompt
        solution_template = """
        Based on the analysis below, provide a comprehensive solution:
        
        Analysis: {analysis}
        
        Solution:
        """
        solution_prompt = PromptTemplate(
            input_variables=["analysis"],
            template=solution_template
        )
        solution_chain = LLMChain(llm=self.llm, prompt=solution_prompt)
        
        # Combine into sequential chain
        overall_chain = SimpleSequentialChain(
            chains=[analysis_chain, solution_chain],
            verbose=True
        )
        
        return overall_chain
    
    def create_debugging_agent(self):
        """Create an agent with custom tools for debugging"""
        
        def search_tool(query: str) -> str:
            """Simulate a search tool"""
            return f"Search results for '{query}': Found relevant information about the topic."
        
        def calculator_tool(expression: str) -> str:
            """Simple calculator tool"""
            try:
                result = eval(expression)
                return f"Calculation result: {result}"
            except:
                return "Error in calculation"
        
        tools = [
            Tool(
                name="Search",
                func=search_tool,
                description="Search for information on any topic"
            ),
            Tool(
                name="Calculator",
                func=calculator_tool,
                description="Perform mathematical calculations"
            )
        ]
        
        prompt_template = """
        You are a helpful assistant with access to tools.
        
        TOOLS:
        ------
        You have access to the following tools:
        {tools}
        
        To use a tool, please use the following format:
        
        ```
        Thought: Do I need to use a tool? Yes
        Action: the action to take, should be one of [{tool_names}]
        Action Input: the input to the action
        Observation: the result of the action
        ```
        
        When you have a response to say to the Human, or if you do not need to use a tool, you MUST use the format:
        
        ```
        Thought: Do I need to use a tool? No
        Final Answer: [your response here]
        ```
        
        Begin!
        
        Question: {input}
        Thought: {agent_scratchpad}
        """
        
        prompt = PromptTemplate(
            template=prompt_template,
            input_variables=["input", "agent_scratchpad", "tools", "tool_names"]
        )
        
        agent = create_react_agent(
            llm=self.llm,
            tools=tools,
            prompt=prompt
        )
        
        return AgentExecutor(
            agent=agent,
            tools=tools,
            verbose=True,
            handle_parsing_errors=True,
            max_iterations=5
        )
    
    async def run_debugging_examples(self):
        """Run various debugging examples"""
        
        print("=== LangSmith Debugging Examples ===\n")
        
        # Example 1: Complex Chain Debugging
        print("1. Complex Chain Debugging:")
        complex_chain = self.create_complex_chain()
        
        try:
            result = complex_chain.run("How can I optimize my machine learning model for production?")
            print(f"Chain Result: {result}\n")
        except Exception as e:
            print(f"Chain Error: {e}\n")
        
        # Example 2: Agent Debugging
        print("2. Agent Debugging:")
        agent = self.create_debugging_agent()
        
        try:
            result = agent.run("What is 15% of 240, and can you search for information about percentage calculations?")
            print(f"Agent Result: {result}\n")
        except Exception as e:
            print(f"Agent Error: {e}\n")
        
        # Example 3: Prompt Optimization
        print("3. Prompt Optimization Example:")
        await self.demonstrate_prompt_optimization()
    
    async def demonstrate_prompt_optimization(self):
        """Demonstrate prompt optimization techniques"""
        
        # Original prompt
        original_prompt = PromptTemplate(
            input_variables=["question"],
            template="Answer this question: {question}"
        )
        
        # Optimized prompt
        optimized_prompt = PromptTemplate(
            input_variables=["question"],
            template="""
            You are an expert assistant. Please provide a comprehensive answer to the following question.
            
            Consider:
            - Accuracy and factual correctness
            - Clarity and structure
            - Practical examples where relevant
            
            Question: {question}
            
            Answer:
            """
        )
        
        test_question = "What is machine learning?"
        
        # Test both prompts
        original_chain = LLMChain(llm=self.llm, prompt=original_prompt)
        optimized_chain = LLMChain(llm=self.llm, prompt=optimized_prompt)
        
        print("Original Prompt Result:")
        original_result = original_chain.run(test_question)
        print(f"{original_result}\n")
        
        print("Optimized Prompt Result:")
        optimized_result = optimized_chain.run(test_question)
        print(f"{optimized_result}\n")

class LangSmithEvaluation:
    def __init__(self):
        self.client = Client()
    
    def create_evaluation_dataset(self):
        """Create a dataset for evaluation"""
        
        examples = [
            {
                "inputs": {"question": "What is the capital of France?"},
                "outputs": {"answer": "Paris"}
            },
            {
                "inputs": {"question": "What is 2 + 2?"},
                "outputs": {"answer": "4"}
            },
            {
                "inputs": {"question": "Who wrote Romeo and Juliet?"},
                "outputs": {"answer": "William Shakespeare"}
            }
        ]
        
        # Create dataset in LangSmith
        dataset_name = "qa-evaluation-dataset"
        
        try:
            dataset = self.client.create_dataset(
                dataset_name=dataset_name,
                description="Question-Answer evaluation dataset"
            )
            
            # Add examples to dataset
            for example in examples:
                self.client.create_example(
                    inputs=example["inputs"],
                    outputs=example["outputs"],
                    dataset_id=dataset.id
                )
            
            print(f"Created dataset: {dataset_name}")
            return dataset
            
        except Exception as e:
            print(f"Error creating dataset: {e}")
            return None
    
    def run_evaluation(self, chain, dataset_name):
        """Run evaluation on a chain"""
        
        def evaluate_chain(example):
            """Evaluate a single example"""
            try:
                result = chain.run(example.inputs["question"])
                return {"result": result}
            except Exception as e:
                return {"error": str(e)}
        
        # Run evaluation
        results = self.client.run_on_dataset(
            dataset_name=dataset_name,
            llm_or_chain_factory=lambda: chain,
            evaluation=evaluate_chain,
            project_name="chain-evaluation"
        )
        
        return results

# Usage example
async def main():
    # Set up environment variables
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_PROJECT"] = "eks-genai-workshop"
    
    # Run debugging examples
    debugger = AdvancedLangSmithDebugging()
    await debugger.run_debugging_examples()
    
    # Run evaluation examples
    evaluator = LangSmithEvaluation()
    dataset = evaluator.create_evaluation_dataset()
    
    if dataset:
        # Create a simple chain for evaluation
        simple_chain = LLMChain(
            llm=debugger.llm,
            prompt=PromptTemplate(
                input_variables=["question"],
                template="Answer this question concisely: {question}"
            )
        )
        
        results = evaluator.run_evaluation(simple_chain, "qa-evaluation-dataset")
        print(f"Evaluation completed: {results}")

if __name__ == "__main__":
    asyncio.run(main())
```

### Step 4: Create ConfigMap with Demo Code

```yaml
# langsmith-demo-code-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: langsmith-demo-code
  namespace: genai-platform
data:
  langsmith_debugging_examples.py: |
    # [Include the Python code from Step 3 here]
  
  requirements.txt: |
    langchain==0.1.0
    langsmith==0.0.70
    openai==1.3.0
    aiohttp==3.9.0
  
  run_demo.py: |
    import subprocess
    import sys
    
    # Install requirements
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
    
    # Run the demo
    exec(open("langsmith_debugging_examples.py").read())
```

### Step 5: Deploy and Test LangSmith Integration

```bash
# Apply configurations
kubectl apply -f langsmith-config.yaml
kubectl apply -f langsmith-demo-code-configmap.yaml
kubectl apply -f langsmith-app.yaml

# Wait for deployment
kubectl wait --for=condition=available --timeout=300s deployment/langsmith-demo-app -n genai-platform

# Run the debugging examples
kubectl exec -it deployment/langsmith-demo-app -n genai-platform -- python run_demo.py
```

## Advanced LangSmith Features

### 1. Custom Evaluators

```python
# custom_evaluators.py
from langsmith.evaluation import evaluate
from langsmith.schemas import Example, Run

def accuracy_evaluator(run: Run, example: Example) -> dict:
    """Custom accuracy evaluator"""
    prediction = run.outputs.get("result", "").lower()
    reference = example.outputs.get("answer", "").lower()
    
    # Simple exact match
    exact_match = prediction == reference
    
    # Fuzzy match (contains key terms)
    fuzzy_match = any(word in prediction for word in reference.split())
    
    return {
        "key": "accuracy",
        "score": 1.0 if exact_match else (0.5 if fuzzy_match else 0.0),
        "reason": f"Prediction: '{prediction}', Reference: '{reference}'"
    }

def relevance_evaluator(run: Run, example: Example) -> dict:
    """Custom relevance evaluator"""
    prediction = run.outputs.get("result", "")
    question = example.inputs.get("question", "")
    
    # Simple relevance check (length and keyword presence)
    relevance_score = 0.0
    
    if len(prediction) > 10:  # Minimum length
        relevance_score += 0.3
    
    if any(word.lower() in prediction.lower() for word in question.split()):
        relevance_score += 0.7
    
    return {
        "key": "relevance",
        "score": min(relevance_score, 1.0),
        "reason": f"Relevance analysis for question: '{question}'"
    }
```

### 2. A/B Testing with LangSmith

```python
# ab_testing.py
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate
from langsmith import Client
import random

class LangSmithABTesting:
    def __init__(self):
        self.client = Client()
        self.llm = OpenAI(base_url="http://litellm-service:4000/v1")
    
    def create_prompt_variants(self):
        """Create different prompt variants for A/B testing"""
        
        variant_a = PromptTemplate(
            input_variables=["question"],
            template="Answer briefly: {question}"
        )
        
        variant_b = PromptTemplate(
            input_variables=["question"],
            template="""
            Please provide a detailed and comprehensive answer to the following question:
            
            {question}
            
            Make sure to include relevant examples and explanations.
            """
        )
        
        return {
            "variant_a": LLMChain(llm=self.llm, prompt=variant_a),
            "variant_b": LLMChain(llm=self.llm, prompt=variant_b)
        }
    
    def run_ab_test(self, test_questions, num_runs=10):
        """Run A/B test with different prompt variants"""
        
        variants = self.create_prompt_variants()
        results = {"variant_a": [], "variant_b": []}
        
        for _ in range(num_runs):
            for question in test_questions:
                # Randomly assign variant
                variant_name = random.choice(["variant_a", "variant_b"])
                chain = variants[variant_name]
                
                try:
                    result = chain.run(question)
                    results[variant_name].append({
                        "question": question,
                        "result": result,
                        "length": len(result),
                        "word_count": len(result.split())
                    })
                except Exception as e:
                    print(f"Error with {variant_name}: {e}")
        
        return results
    
    def analyze_ab_results(self, results):
        """Analyze A/B test results"""
        
        analysis = {}
        
        for variant, data in results.items():
            if data:
                avg_length = sum(item["length"] for item in data) / len(data)
                avg_words = sum(item["word_count"] for item in data) / len(data)
                
                analysis[variant] = {
                    "count": len(data),
                    "avg_length": avg_length,
                    "avg_words": avg_words
                }
        
        return analysis
```

## Monitoring and Analytics

### 1. LangSmith Dashboard Integration

```python
# langsmith_monitoring.py
from langsmith import Client
import json
from datetime import datetime, timedelta

class LangSmithMonitoring:
    def __init__(self):
        self.client = Client()
    
    def get_project_analytics(self, project_name, days=7):
        """Get analytics for a specific project"""
        
        end_time = datetime.now()
        start_time = end_time - timedelta(days=days)
        
        try:
            runs = list(self.client.list_runs(
                project_name=project_name,
                start_time=start_time,
                end_time=end_time
            ))
            
            analytics = {
                "total_runs": len(runs),
                "successful_runs": len([r for r in runs if not r.error]),
                "error_rate": len([r for r in runs if r.error]) / len(runs) if runs else 0,
                "avg_latency": sum(r.total_time for r in runs if r.total_time) / len(runs) if runs else 0
            }
            
            return analytics
            
        except Exception as e:
            print(f"Error getting analytics: {e}")
            return {}
    
    def export_traces(self, project_name, output_file):
        """Export traces for analysis"""
        
        runs = list(self.client.list_runs(project_name=project_name))
        
        export_data = []
        for run in runs:
            export_data.append({
                "id": str(run.id),
                "name": run.name,
                "start_time": run.start_time.isoformat() if run.start_time else None,
                "end_time": run.end_time.isoformat() if run.end_time else None,
                "total_time": run.total_time,
                "inputs": run.inputs,
                "outputs": run.outputs,
                "error": run.error
            })
        
        with open(output_file, 'w') as f:
            json.dump(export_data, f, indent=2)
        
        print(f"Exported {len(export_data)} traces to {output_file}")
```

## Best Practices

### 1. Debugging Workflow

1. **Enable Tracing**: Always enable LangSmith tracing in development
2. **Use Projects**: Organize traces by project/environment
3. **Add Metadata**: Include relevant context in trace metadata
4. **Monitor Errors**: Set up alerts for error rates

### 2. Prompt Optimization

1. **Version Control**: Track prompt changes over time
2. **A/B Testing**: Compare prompt variants systematically
3. **Evaluation Metrics**: Define clear success criteria
4. **Iterative Improvement**: Use data to guide optimization

### 3. Production Monitoring

1. **Sampling**: Use trace sampling in high-volume production
2. **Privacy**: Be mindful of sensitive data in traces
3. **Performance**: Monitor impact of tracing on latency
4. **Alerting**: Set up monitoring for critical metrics

## Troubleshooting

### Common Issues

1. **API Key Issues**: Verify LANGCHAIN_API_KEY is set correctly
2. **Network Connectivity**: Ensure access to smith.langchain.com
3. **Trace Volume**: Monitor trace volume to avoid rate limits
4. **Memory Usage**: Large traces can impact application memory

### Validation Steps

```bash
# Check LangSmith configuration
kubectl exec -it deployment/langsmith-demo-app -n genai-platform -- env | grep LANGCHAIN

# Test API connectivity
kubectl exec -it deployment/langsmith-demo-app -n genai-platform -- \
  python -c "from langsmith import Client; print(Client().list_projects())"

# View application logs
kubectl logs deployment/langsmith-demo-app -n genai-platform
```

## Next Steps

Continue with [Network Observability with Hubble](/module2-genai-components/network-observability/) to learn about network-level monitoring and analysis.