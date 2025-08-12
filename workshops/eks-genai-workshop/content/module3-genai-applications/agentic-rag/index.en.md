---
title: "Agentic RAG"
weight: 46
duration: "30 minutes"
difficulty: "advanced"
---

# Agentic RAG: Advanced Retrieval-Augmented Generation

Learn how to implement sophisticated agentic RAG systems that use intelligent agents to orchestrate retrieval, reasoning, and generation processes.

## Overview

Agentic RAG goes beyond traditional RAG by using intelligent agents to make decisions about what information to retrieve, how to process it, and how to generate responses. This enables more sophisticated reasoning and better handling of complex queries.

## Learning Objectives

By the end of this lab, you will be able to:
- Understand the differences between traditional RAG and agentic RAG
- Implement multi-step reasoning with retrieval agents
- Create query planning and decomposition agents
- Build self-correcting RAG systems
- Integrate multiple knowledge sources intelligently

## Prerequisites

- Completed [Multi-Agent Systems](/module3-genai-applications/multi-agent/)
- Understanding of RAG concepts and vector databases
- Familiarity with agent architectures

## Agentic RAG Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                Agentic RAG Architecture                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Query       │  │ Planning    │  │ Orchestrator│        │
│  │ Agent       │  │ Agent       │  │ Agent       │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│         │                 │                 │              │
│  ┌─────────────────────────────────────────────────────────┤
│  │              Knowledge Sources                          │
│  └─────────────────────────────────────────────────────────┤
│         │                 │                 │              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Vector      │  │ Graph       │  │ External    │        │
│  │ Database    │  │ Database    │  │ APIs        │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Lab: Implementing Agentic RAG

### Step 1: Create Query Planning Agent

```python
# agentic_rag.py
import asyncio
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from datetime import datetime
import json

@dataclass
class QueryPlan:
    original_query: str
    sub_queries: List[str]
    retrieval_strategy: str
    reasoning_steps: List[str]
    confidence: float

class QueryPlanningAgent:
    def __init__(self, llm):
        self.llm = llm
    
    async def create_query_plan(self, query: str) -> QueryPlan:
        """Create a comprehensive query plan"""
        
        planning_prompt = f"""
        Analyze the following query and create a detailed plan for answering it:
        
        Query: {query}
        
        Please provide:
        1. Break down into sub-queries if needed
        2. Suggest retrieval strategy
        3. Outline reasoning steps
        4. Estimate confidence level
        
        Format as JSON with keys: sub_queries, retrieval_strategy, reasoning_steps, confidence
        """
        
        response = await self.llm.agenerate([planning_prompt])
        
        try:
            plan_data = json.loads(response.generations[0][0].text)
            
            return QueryPlan(
                original_query=query,
                sub_queries=plan_data.get("sub_queries", [query]),
                retrieval_strategy=plan_data.get("retrieval_strategy", "semantic_search"),
                reasoning_steps=plan_data.get("reasoning_steps", ["retrieve", "analyze", "synthesize"]),
                confidence=plan_data.get("confidence", 0.7)
            )
        except:
            # Fallback plan
            return QueryPlan(
                original_query=query,
                sub_queries=[query],
                retrieval_strategy="semantic_search",
                reasoning_steps=["retrieve", "analyze", "synthesize"],
                confidence=0.5
            )

class RetrievalAgent:
    def __init__(self, vector_store, graph_store=None):
        self.vector_store = vector_store
        self.graph_store = graph_store
    
    async def retrieve_documents(self, query: str, strategy: str = "semantic_search", 
                                top_k: int = 5) -> List[Dict[str, Any]]:
        """Retrieve documents using specified strategy"""
        
        if strategy == "semantic_search":
            return await self.semantic_retrieval(query, top_k)
        elif strategy == "hybrid_search":
            return await self.hybrid_retrieval(query, top_k)
        elif strategy == "graph_traversal":
            return await self.graph_retrieval(query, top_k)
        else:
            return await self.semantic_retrieval(query, top_k)
    
    async def semantic_retrieval(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        """Perform semantic vector search"""
        # Mock implementation
        return [
            {
                "content": f"Document {i+1} content related to: {query}",
                "metadata": {"source": f"doc_{i+1}", "score": 0.9 - i*0.1},
                "type": "semantic"
            }
            for i in range(top_k)
        ]
    
    async def hybrid_retrieval(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        """Combine semantic and keyword search"""
        semantic_docs = await self.semantic_retrieval(query, top_k//2)
        
        # Mock keyword search
        keyword_docs = [
            {
                "content": f"Keyword match {i+1} for: {query}",
                "metadata": {"source": f"keyword_doc_{i+1}", "score": 0.8 - i*0.1},
                "type": "keyword"
            }
            for i in range(top_k//2)
        ]
        
        return semantic_docs + keyword_docs
    
    async def graph_retrieval(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        """Retrieve using graph traversal"""
        # Mock graph retrieval
        return [
            {
                "content": f"Graph node {i+1} connected to: {query}",
                "metadata": {"source": f"graph_node_{i+1}", "score": 0.85 - i*0.05},
                "type": "graph"
            }
            for i in range(top_k)
        ]

class ReasoningAgent:
    def __init__(self, llm):
        self.llm = llm
    
    async def analyze_documents(self, documents: List[Dict[str, Any]], 
                               query: str) -> Dict[str, Any]:
        """Analyze retrieved documents for relevance and extract key information"""
        
        doc_contents = [doc["content"] for doc in documents]
        
        analysis_prompt = f"""
        Analyze the following documents in relation to the query: {query}
        
        Documents:
        {json.dumps(doc_contents, indent=2)}
        
        Please provide:
        1. Relevance score for each document (0-1)
        2. Key information extracted
        3. Potential contradictions or gaps
        4. Synthesis strategy
        
        Format as JSON.
        """
        
        response = await self.llm.agenerate([analysis_prompt])
        
        try:
            return json.loads(response.generations[0][0].text)
        except:
            return {
                "relevance_scores": [0.8] * len(documents),
                "key_information": ["General information extracted"],
                "contradictions": [],
                "synthesis_strategy": "combine_all"
            }
    
    async def synthesize_response(self, analysis: Dict[str, Any], 
                                 query: str) -> str:
        """Synthesize final response based on analysis"""
        
        synthesis_prompt = f"""
        Based on the following analysis, provide a comprehensive answer to: {query}
        
        Analysis: {json.dumps(analysis, indent=2)}
        
        Provide a well-structured, accurate response that addresses the query directly.
        """
        
        response = await self.llm.agenerate([synthesis_prompt])
        return response.generations[0][0].text

class SelfCorrectionAgent:
    def __init__(self, llm):
        self.llm = llm
    
    async def evaluate_response(self, query: str, response: str, 
                               documents: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Evaluate the quality of the generated response"""
        
        evaluation_prompt = f"""
        Evaluate the following response to the query:
        
        Query: {query}
        Response: {response}
        
        Based on the source documents, assess:
        1. Accuracy (0-1)
        2. Completeness (0-1)
        3. Relevance (0-1)
        4. Potential improvements
        5. Need for additional retrieval
        
        Format as JSON.
        """
        
        eval_response = await self.llm.agenerate([evaluation_prompt])
        
        try:
            return json.loads(eval_response.generations[0][0].text)
        except:
            return {
                "accuracy": 0.8,
                "completeness": 0.7,
                "relevance": 0.9,
                "improvements": ["Add more specific examples"],
                "need_additional_retrieval": False
            }
    
    async def improve_response(self, original_response: str, 
                              evaluation: Dict[str, Any], 
                              query: str) -> str:
        """Improve response based on evaluation"""
        
        if evaluation.get("accuracy", 0) > 0.8 and evaluation.get("completeness", 0) > 0.8:
            return original_response
        
        improvement_prompt = f"""
        Improve the following response based on the evaluation:
        
        Original Response: {original_response}
        Evaluation: {json.dumps(evaluation, indent=2)}
        Original Query: {query}
        
        Provide an improved version that addresses the identified issues.
        """
        
        improved_response = await self.llm.agenerate([improvement_prompt])
        return improved_response.generations[0][0].text

class AgenticRAGSystem:
    def __init__(self, llm, vector_store, graph_store=None):
        self.query_planner = QueryPlanningAgent(llm)
        self.retrieval_agent = RetrievalAgent(vector_store, graph_store)
        self.reasoning_agent = ReasoningAgent(llm)
        self.correction_agent = SelfCorrectionAgent(llm)
        
    async def process_query(self, query: str, max_iterations: int = 2) -> Dict[str, Any]:
        """Process query using agentic RAG approach"""
        
        print(f"Processing query: {query}")
        
        # Step 1: Query Planning
        plan = await self.query_planner.create_query_plan(query)
        print(f"Query plan created with {len(plan.sub_queries)} sub-queries")
        
        # Step 2: Retrieve documents for each sub-query
        all_documents = []
        for sub_query in plan.sub_queries:
            docs = await self.retrieval_agent.retrieve_documents(
                sub_query, 
                plan.retrieval_strategy
            )
            all_documents.extend(docs)
        
        print(f"Retrieved {len(all_documents)} documents")
        
        # Step 3: Analyze and synthesize
        analysis = await self.reasoning_agent.analyze_documents(all_documents, query)
        initial_response = await self.reasoning_agent.synthesize_response(analysis, query)
        
        # Step 4: Self-correction loop
        current_response = initial_response
        for iteration in range(max_iterations):
            evaluation = await self.correction_agent.evaluate_response(
                query, current_response, all_documents
            )
            
            print(f"Iteration {iteration + 1} - Accuracy: {evaluation.get('accuracy', 0):.2f}")
            
            if evaluation.get("accuracy", 0) > 0.9 and evaluation.get("completeness", 0) > 0.9:
                break
            
            if evaluation.get("need_additional_retrieval", False):
                # Retrieve additional documents
                additional_docs = await self.retrieval_agent.retrieve_documents(
                    query, "hybrid_search", top_k=3
                )
                all_documents.extend(additional_docs)
                
                # Re-analyze with additional documents
                analysis = await self.reasoning_agent.analyze_documents(all_documents, query)
                current_response = await self.reasoning_agent.synthesize_response(analysis, query)
            else:
                # Improve current response
                current_response = await self.correction_agent.improve_response(
                    current_response, evaluation, query
                )
        
        return {
            "query": query,
            "plan": plan,
            "documents_retrieved": len(all_documents),
            "final_response": current_response,
            "iterations": iteration + 1,
            "timestamp": datetime.now().isoformat()
        }

# Demo implementation
async def run_agentic_rag_demo():
    """Run agentic RAG demonstration"""
    
    print("=== Agentic RAG Demo ===\n")
    
    # Mock LLM and vector store for demo
    class MockLLM:
        async def agenerate(self, prompts):
            # Mock response generation
            class MockGeneration:
                def __init__(self, text):
                    self.text = text
            
            class MockGenerations:
                def __init__(self, text):
                    self.generations = [[MockGeneration(text)]]
            
            prompt = prompts[0]
            
            if "create a detailed plan" in prompt.lower():
                response = json.dumps({
                    "sub_queries": ["What is machine learning?", "How does ML work?"],
                    "retrieval_strategy": "hybrid_search",
                    "reasoning_steps": ["retrieve", "analyze", "compare", "synthesize"],
                    "confidence": 0.85
                })
            elif "analyze the following documents" in prompt.lower():
                response = json.dumps({
                    "relevance_scores": [0.9, 0.8, 0.7],
                    "key_information": ["ML is a subset of AI", "Uses algorithms to learn patterns"],
                    "contradictions": [],
                    "synthesis_strategy": "combine_complementary"
                })
            elif "evaluate the following response" in prompt.lower():
                response = json.dumps({
                    "accuracy": 0.85,
                    "completeness": 0.80,
                    "relevance": 0.90,
                    "improvements": ["Add more specific examples"],
                    "need_additional_retrieval": False
                })
            else:
                response = "Machine learning is a method of data analysis that automates analytical model building."
            
            return MockGenerations(response)
    
    class MockVectorStore:
        pass
    
    # Initialize agentic RAG system
    llm = MockLLM()
    vector_store = MockVectorStore()
    
    agentic_rag = AgenticRAGSystem(llm, vector_store)
    
    # Test queries
    test_queries = [
        "What is machine learning and how does it work?",
        "Compare supervised and unsupervised learning approaches",
        "Explain the role of neural networks in deep learning"
    ]
    
    for query in test_queries:
        print(f"\n{'='*60}")
        result = await agentic_rag.process_query(query)
        
        print(f"Query: {result['query']}")
        print(f"Sub-queries: {len(result['plan'].sub_queries)}")
        print(f"Documents retrieved: {result['documents_retrieved']}")
        print(f"Iterations: {result['iterations']}")
        print(f"Response: {result['final_response'][:200]}...")

if __name__ == "__main__":
    asyncio.run(run_agentic_rag_demo())
```

Continue with [Use Cases](/module3-genai-applications/use-cases/) to explore practical applications.