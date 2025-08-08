---
title: "Observability with LangFuse"
weight: 32
duration: "45 minutes"
---

# Observability with LangFuse

In this section, you'll integrate LangFuse for comprehensive observability and tracing of your GenAI applications.

## What is LangFuse?

LangFuse is an open-source observability platform specifically designed for LLM applications. It provides:

- **Tracing**: End-to-end visibility into LLM calls and agent workflows
- **Monitoring**: Performance metrics, latency, and error tracking
- **Analytics**: Token usage, cost tracking, and quality metrics
- **Debugging**: Detailed logs and request/response inspection

## LangFuse Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Application   │───▶│   LangFuse      │───▶│   PostgreSQL    │
│   (Agents)      │    │   Server        │    │   Database      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   LangFuse      │
                       │   Web UI        │
                       └─────────────────┘
```

## Step 1: Deploy LangFuse

### LangFuse Server Configuration
```yaml
# langfuse-deployment.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: langfuse-config
  namespace: genai-platform
data:
  DATABASE_URL: "postgresql://genai_user:genai_password@postgres-service:5432/genai_platform"
  NEXTAUTH_URL: "http://localhost:3000"
  NEXTAUTH_SECRET: "your-secret-key-here"
  SALT: "your-salt-here"
  ENCRYPTION_KEY: "your-encryption-key-here"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: langfuse-server
  namespace: genai-platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app: langfuse-server
  template:
    metadata:
      labels:
        app: langfuse-server
    spec:
      containers:
      - name: langfuse
        image: langfuse/langfuse:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: langfuse-config
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 1000m
            memory: 2Gi
        livenessProbe:
          httpGet:
            path: /api/public/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/public/health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: langfuse-service
  namespace: genai-platform
spec:
  selector:
    app: langfuse-server
  ports:
  - port: 3000
    targetPort: 3000
```

### Deploy LangFuse
```bash
# Deploy LangFuse
kubectl apply -f langfuse-deployment.yaml

# Wait for deployment
kubectl wait --for=condition=ready pod -l app=langfuse-server -n genai-platform --timeout=300s

# Check deployment
kubectl get pods -l app=langfuse-server -n genai-platform
kubectl logs deployment/langfuse-server -n genai-platform
```

## Step 2: Configure LangFuse Integration

### Python SDK Integration
```python
# langfuse_client.py
import os
from langfuse import Langfuse
from langfuse.decorators import observe
from langfuse.openai import openai
import asyncio
from typing import Dict, Any

class LangFuseClient:
    def __init__(self):
        self.langfuse = Langfuse(
            host=os.getenv("LANGFUSE_HOST", "http://langfuse-service:3000"),
            public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
            secret_key=os.getenv("LANGFUSE_SECRET_KEY")
        )
    
    @observe(as_type="generation")
    def llm_call(self, prompt: str, model: str, **kwargs) -> Dict[str, Any]:
        """Traced LLM call with automatic observability"""
        
        # This will be automatically traced by LangFuse
        response = openai.Completion.create(
            model=model,
            prompt=prompt,
            **kwargs
        )
        
        return {
            "response": response.choices[0].text,
            "model": model,
            "usage": response.usage._asdict(),
            "prompt": prompt
        }
    
    @observe(as_type="span")
    def agent_workflow(self, task: str, agent_id: str) -> Dict[str, Any]:
        """Traced agent workflow execution"""
        
        # Simulate agent workflow steps
        with self.langfuse.trace(name="agent_workflow", user_id=agent_id) as trace:
            # Step 1: Planning
            with trace.span(name="planning") as planning_span:
                planning_span.update(input={"task": task})
                plan = self.llm_call(
                    prompt=f"Create a plan for: {task}",
                    model="gpt-3.5-turbo",
                    max_tokens=200
                )
                planning_span.update(output=plan)
            
            # Step 2: Execution
            with trace.span(name="execution") as execution_span:
                execution_span.update(input={"plan": plan})
                result = self.llm_call(
                    prompt=f"Execute this plan: {plan['response']}",
                    model="gpt-3.5-turbo",
                    max_tokens=500
                )
                execution_span.update(output=result)
            
            # Step 3: Validation
            with trace.span(name="validation") as validation_span:
                validation_span.update(input={"result": result})
                validation = self.llm_call(
                    prompt=f"Validate this result: {result['response']}",
                    model="gpt-3.5-turbo",
                    max_tokens=100
                )
                validation_span.update(output=validation)
            
            trace.update(
                output={"final_result": result, "validation": validation},
                metadata={"agent_id": agent_id, "task_type": "general"}
            )
        
        return {
            "result": result,
            "validation": validation,
            "trace_id": trace.id
        }
    
    def create_custom_trace(self, name: str, user_id: str = None) -> Any:
        """Create custom trace for complex workflows"""
        return self.langfuse.trace(name=name, user_id=user_id)
    
    def log_event(self, name: str, data: Dict[str, Any], level: str = "INFO"):
        """Log custom events"""
        self.langfuse.event(
            name=name,
            level=level,
            data=data
        )
    
    def flush(self):
        """Ensure all traces are sent"""
        self.langfuse.flush()

# Usage example
client = LangFuseClient()
```

### LangChain Integration
```python
# langchain_integration.py
from langchain.llms import OpenAI
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate
from langfuse.callback import CallbackHandler
import os

class TracedLangChain:
    def __init__(self):
        self.callback_handler = CallbackHandler(
            host=os.getenv("LANGFUSE_HOST", "http://langfuse-service:3000"),
            public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
            secret_key=os.getenv("LANGFUSE_SECRET_KEY")
        )
    
    def create_traced_chain(self, template: str, llm_model: str = "gpt-3.5-turbo"):
        """Create a LangChain with LangFuse tracing"""
        
        prompt = PromptTemplate(
            input_variables=["input"],
            template=template
        )
        
        llm = OpenAI(
            model_name=llm_model,
            callbacks=[self.callback_handler]
        )
        
        return LLMChain(
            llm=llm,
            prompt=prompt,
            callbacks=[self.callback_handler]
        )
    
    def run_traced_chain(self, chain: LLMChain, input_data: str, 
                        session_id: str = None, user_id: str = None):
        """Run chain with tracing context"""
        
        # Update callback handler with session context
        self.callback_handler.set_trace_params(
            session_id=session_id,
            user_id=user_id
        )
        
        return chain.run(input_data)

# Example usage
traced_chain = TracedLangChain()
qa_chain = traced_chain.create_traced_chain(
    template="Answer the following question: {input}"
)
```

## Step 3: Custom Metrics and Analytics

### Metrics Collection
```python
# metrics_collector.py
import time
from typing import Dict, Any, Optional
from langfuse import Langfuse
import json

class MetricsCollector:
    def __init__(self, langfuse_client: Langfuse):
        self.langfuse = langfuse_client
        self.metrics = {}
    
    def track_latency(self, operation: str, duration: float, metadata: Dict = None):
        """Track operation latency"""
        self.langfuse.event(
            name="latency_metric",
            data={
                "operation": operation,
                "duration_ms": duration * 1000,
                "metadata": metadata or {}
            }
        )
    
    def track_cost(self, model: str, prompt_tokens: int, completion_tokens: int, 
                   cost_per_token: float = 0.0001):
        """Track token usage and cost"""
        total_cost = (prompt_tokens + completion_tokens) * cost_per_token
        
        self.langfuse.event(
            name="cost_metric",
            data={
                "model": model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
                "total_cost": total_cost
            }
        )
    
    def track_quality_score(self, response_id: str, score: float, 
                           criteria: str, evaluator: str = "human"):
        """Track response quality scores"""
        self.langfuse.score(
            trace_id=response_id,
            name=f"quality_{criteria}",
            value=score,
            comment=f"Evaluated by {evaluator}"
        )
    
    def track_user_feedback(self, trace_id: str, rating: int, 
                           comment: str = None):
        """Track user feedback"""
        self.langfuse.score(
            trace_id=trace_id,
            name="user_satisfaction",
            value=rating,
            comment=comment
        )

# Context manager for automatic timing
class TimedOperation:
    def __init__(self, collector: MetricsCollector, operation_name: str, 
                 metadata: Dict = None):
        self.collector = collector
        self.operation_name = operation_name
        self.metadata = metadata or {}
        self.start_time = None
    
    def __enter__(self):
        self.start_time = time.time()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.start_time:
            duration = time.time() - self.start_time
            self.collector.track_latency(
                self.operation_name, 
                duration, 
                self.metadata
            )
```

## Step 4: Dashboard and Monitoring

### Deploy Monitoring Dashboard
```yaml
# monitoring-dashboard.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: dashboard-config
  namespace: genai-platform
data:
  dashboard.py: |
    import streamlit as st
    import pandas as pd
    import plotly.express as px
    import plotly.graph_objects as go
    from langfuse import Langfuse
    import os
    from datetime import datetime, timedelta
    
    # Initialize LangFuse client
    langfuse = Langfuse(
        host=os.getenv("LANGFUSE_HOST", "http://langfuse-service:3000"),
        public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
        secret_key=os.getenv("LANGFUSE_SECRET_KEY")
    )
    
    st.title("GenAI Platform Observability Dashboard")
    
    # Sidebar for filters
    st.sidebar.header("Filters")
    time_range = st.sidebar.selectbox(
        "Time Range",
        ["Last Hour", "Last 24 Hours", "Last 7 Days", "Last 30 Days"]
    )
    
    # Convert time range to datetime
    now = datetime.now()
    if time_range == "Last Hour":
        start_time = now - timedelta(hours=1)
    elif time_range == "Last 24 Hours":
        start_time = now - timedelta(days=1)
    elif time_range == "Last 7 Days":
        start_time = now - timedelta(days=7)
    else:
        start_time = now - timedelta(days=30)
    
    # Fetch traces
    traces = langfuse.get_traces(
        from_timestamp=start_time,
        to_timestamp=now
    )
    
    # Display metrics
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        st.metric("Total Traces", len(traces.data))
    
    with col2:
        avg_latency = sum(t.latency for t in traces.data if t.latency) / len(traces.data)
        st.metric("Avg Latency", f"{avg_latency:.2f}ms")
    
    with col3:
        total_cost = sum(t.cost for t in traces.data if t.cost)
        st.metric("Total Cost", f"${total_cost:.4f}")
    
    with col4:
        error_rate = len([t for t in traces.data if t.level == "ERROR"]) / len(traces.data)
        st.metric("Error Rate", f"{error_rate:.2%}")
    
    # Latency over time chart
    st.subheader("Latency Over Time")
    latency_data = pd.DataFrame([
        {"timestamp": t.timestamp, "latency": t.latency}
        for t in traces.data if t.latency
    ])
    
    if not latency_data.empty:
        fig = px.line(latency_data, x="timestamp", y="latency", 
                     title="Response Latency Over Time")
        st.plotly_chart(fig, use_container_width=True)
    
    # Cost breakdown chart
    st.subheader("Cost Breakdown by Model")
    cost_data = pd.DataFrame([
        {"model": t.model, "cost": t.cost}
        for t in traces.data if t.cost and t.model
    ])
    
    if not cost_data.empty:
        cost_summary = cost_data.groupby("model")["cost"].sum().reset_index()
        fig = px.pie(cost_summary, values="cost", names="model", 
                    title="Cost Distribution by Model")
        st.plotly_chart(fig, use_container_width=True)
    
    # Recent traces table
    st.subheader("Recent Traces")
    recent_traces = traces.data[:10]
    trace_df = pd.DataFrame([
        {
            "Trace ID": t.id,
            "Name": t.name,
            "Latency": f"{t.latency:.2f}ms" if t.latency else "N/A",
            "Cost": f"${t.cost:.4f}" if t.cost else "N/A",
            "Status": t.level,
            "Timestamp": t.timestamp
        }
        for t in recent_traces
    ])
    
    st.dataframe(trace_df, use_container_width=True)
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: monitoring-dashboard
  namespace: genai-platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app: monitoring-dashboard
  template:
    metadata:
      labels:
        app: monitoring-dashboard
    spec:
      containers:
      - name: dashboard
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
          pip install streamlit pandas plotly langfuse
          streamlit run /config/dashboard.py --server.port=8501 --server.address=0.0.0.0
        volumeMounts:
        - name: dashboard-config
          mountPath: /config
      volumes:
      - name: dashboard-config
        configMap:
          name: dashboard-config
---
apiVersion: v1
kind: Service
metadata:
  name: monitoring-dashboard-service
  namespace: genai-platform
spec:
  selector:
    app: monitoring-dashboard
  ports:
  - port: 8501
    targetPort: 8501
```

## Step 5: Lab Exercise

### Create Sample Traced Application
```python
# sample_traced_app.py
import asyncio
import random
from langfuse_client import LangFuseClient
from metrics_collector import MetricsCollector, TimedOperation

async def main():
    # Initialize clients
    langfuse_client = LangFuseClient()
    metrics_collector = MetricsCollector(langfuse_client.langfuse)
    
    # Simulate different types of operations
    operations = [
        "question_answering",
        "code_generation",
        "summarization",
        "translation",
        "creative_writing"
    ]
    
    for i in range(50):
        operation = random.choice(operations)
        user_id = f"user_{random.randint(1, 10)}"
        
        # Simulate traced workflow
        with TimedOperation(metrics_collector, operation, {"user_id": user_id}):
            result = langfuse_client.agent_workflow(
                task=f"Perform {operation} task #{i}",
                agent_id=f"agent_{random.randint(1, 3)}"
            )
            
            # Simulate cost tracking
            prompt_tokens = random.randint(50, 200)
            completion_tokens = random.randint(100, 500)
            metrics_collector.track_cost(
                model="gpt-3.5-turbo",
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens
            )
            
            # Simulate quality scoring
            quality_score = random.uniform(0.6, 1.0)
            metrics_collector.track_quality_score(
                response_id=result["trace_id"],
                score=quality_score,
                criteria="overall_quality"
            )
        
        print(f"Completed operation {i+1}/50: {operation}")
        await asyncio.sleep(0.1)  # Small delay to avoid overwhelming
    
    # Flush all traces
    langfuse_client.flush()
    print("All traces sent to LangFuse!")

if __name__ == "__main__":
    asyncio.run(main())
```

### Deploy and Test
```bash
# Deploy monitoring dashboard
kubectl apply -f monitoring-dashboard.yaml

# Run sample traced application
python3 sample_traced_app.py

# Access LangFuse UI
kubectl port-forward svc/langfuse-service 3000:3000 -n genai-platform

# Access monitoring dashboard
kubectl port-forward svc/monitoring-dashboard-service 8501:8501 -n genai-platform
```

## Best Practices

1. **Structured Tracing**: Use consistent naming conventions for traces and spans
2. **Metadata Enrichment**: Add relevant metadata to traces for better analysis
3. **Cost Tracking**: Always track token usage and associated costs
4. **Performance Monitoring**: Set up alerts for latency and error rate thresholds
5. **Privacy Considerations**: Be mindful of sensitive data in traces

## Next Steps

With observability in place, you're ready to set up the AI Gateway with [LiteLLM](/module2-genai-components/ai-gateway/). 