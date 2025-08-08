---
title: "AI Gateway with LiteLLM"
weight: 33
duration: "30 minutes"
---

# AI Gateway with LiteLLM

In this section, you'll deploy LiteLLM as a unified AI gateway to manage multiple LLM providers with a single API interface.

## What is LiteLLM?

LiteLLM is a unified API that allows you to call multiple LLM providers (OpenAI, Anthropic, Cohere, etc.) using the OpenAI format. It provides:

- **Unified API**: Single interface for multiple LLM providers
- **Load Balancing**: Distribute requests across multiple models
- **Fallback**: Automatic failover between providers
- **Rate Limiting**: Control usage and costs
- **Caching**: Reduce latency and costs with intelligent caching

## LiteLLM Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Applications  │───▶│   LiteLLM       │───▶│   OpenAI API    │
│   (Agents)      │    │   Gateway       │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ├────────────────▶┌─────────────────┐
                                │                 │  Anthropic API  │
                                │                 │                 │
                                │                 └─────────────────┘
                                │
                                └────────────────▶┌─────────────────┐
                                                  │   Local vLLM    │
                                                  │                 │
                                                  └─────────────────┘
```

## Step 1: Deploy LiteLLM Gateway

### LiteLLM Configuration
```yaml
# litellm-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: litellm-config
  namespace: genai-platform
data:
  config.yaml: |
    model_list:
      - model_name: gpt-3.5-turbo
        litellm_params:
          model: openai/gpt-3.5-turbo
          api_key: env/OPENAI_API_KEY
          max_tokens: 4000
          temperature: 0.7
      
      - model_name: gpt-4
        litellm_params:
          model: openai/gpt-4
          api_key: env/OPENAI_API_KEY
          max_tokens: 8000
          temperature: 0.7
      
      - model_name: claude-3-sonnet
        litellm_params:
          model: anthropic/claude-3-sonnet-20240229
          api_key: env/ANTHROPIC_API_KEY
          max_tokens: 4000
          temperature: 0.7
      
      - model_name: llama2-7b
        litellm_params:
          model: vllm/meta-llama/Llama-2-7b-hf
          api_base: http://vllm-service:8000/v1
          temperature: 0.7
      
      - model_name: llama2-70b
        litellm_params:
          model: vllm/meta-llama/Llama-2-70b-hf
          api_base: http://vllm-service-70b:8000/v1
          temperature: 0.7
    
    # Router settings
    router_settings:
      routing_strategy: "least-busy"
      retry_policy:
        max_retries: 3
        backoff_factor: 2
      
      # Fallback configuration
      fallbacks:
        - ["gpt-4", "gpt-3.5-turbo"]
        - ["claude-3-sonnet", "gpt-4"]
        - ["llama2-70b", "llama2-7b"]
      
      # Load balancing
      load_balancing:
        - model_name: "balanced-gpt"
          models: ["gpt-3.5-turbo", "gpt-4"]
          weights: [0.7, 0.3]
        - model_name: "balanced-local"
          models: ["llama2-7b", "llama2-70b"]
          weights: [0.8, 0.2]
    
    # General settings
    general_settings:
      master_key: env/LITELLM_MASTER_KEY
      database_url: env/LITELLM_DATABASE_URL
      
      # Logging
      langfuse_public_key: env/LANGFUSE_PUBLIC_KEY
      langfuse_secret_key: env/LANGFUSE_SECRET_KEY
      langfuse_host: env/LANGFUSE_HOST
      
      # Caching
      redis_host: env/REDIS_HOST
      redis_port: 6379
      cache_responses: true
      cache_ttl: 3600
      
      # Rate limiting
      rpm_limit: 1000
      tpm_limit: 100000
      
      # Cost tracking
      track_cost_callback: true
      
      # Security
      allowed_ips: ["0.0.0.0/0"]
      disable_spend_logs: false
---
apiVersion: v1
kind: Secret
metadata:
  name: litellm-secrets
  namespace: genai-platform
type: Opaque
data:
  OPENAI_API_KEY: <base64-encoded-key>
  ANTHROPIC_API_KEY: <base64-encoded-key>
  LITELLM_MASTER_KEY: <base64-encoded-key>
  LITELLM_DATABASE_URL: cG9zdGdyZXNxbDovL2dlbmFpX3VzZXI6Z2VuYWlfcGFzc3dvcmRAcG9zdGdyZXMtc2VydmljZTo1NDMyL2dlbmFpX3BsYXRmb3Jt
  LANGFUSE_PUBLIC_KEY: <base64-encoded-key>
  LANGFUSE_SECRET_KEY: <base64-encoded-key>
  LANGFUSE_HOST: aHR0cDovL2xhbmdmdXNlLXNlcnZpY2U6MzAwMA==
  REDIS_HOST: cmVkaXMtc2VydmljZQ==
```

### LiteLLM Deployment
```yaml
# litellm-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: litellm-gateway
  namespace: genai-platform
spec:
  replicas: 2
  selector:
    matchLabels:
      app: litellm-gateway
  template:
    metadata:
      labels:
        app: litellm-gateway
    spec:
      containers:
      - name: litellm
        image: ghcr.io/berriai/litellm:main-latest
        ports:
        - containerPort: 4000
        envFrom:
        - secretRef:
            name: litellm-secrets
        env:
        - name: CONFIG_FILE_PATH
          value: /config/config.yaml
        - name: PORT
          value: "4000"
        - name: STORE_MODEL_IN_DB
          value: "true"
        volumeMounts:
        - name: config-volume
          mountPath: /config
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 1000m
            memory: 2Gi
        livenessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 10
          periodSeconds: 5
      volumes:
      - name: config-volume
        configMap:
          name: litellm-config
---
apiVersion: v1
kind: Service
metadata:
  name: litellm-service
  namespace: genai-platform
spec:
  selector:
    app: litellm-gateway
  ports:
  - port: 4000
    targetPort: 4000
  type: ClusterIP
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: litellm-hpa
  namespace: genai-platform
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: litellm-gateway
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

## Step 2: Advanced Configuration

### User Management and API Keys
```yaml
# user-management.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: user-config
  namespace: genai-platform
data:
  users.yaml: |
    users:
      - user_id: "agent-user-1"
        user_email: "agent1@example.com"
        models: ["gpt-3.5-turbo", "llama2-7b"]
        spend_limit: 100.0
        duration: "1mo"
        aliases: {}
        config: {}
        
      - user_id: "agent-user-2"
        user_email: "agent2@example.com"
        models: ["gpt-4", "claude-3-sonnet"]
        spend_limit: 500.0
        duration: "1mo"
        aliases: {}
        config: {}
      
      - user_id: "admin-user"
        user_email: "admin@example.com"
        models: ["*"]
        spend_limit: 10000.0
        duration: "1mo"
        aliases: {}
        config: {}
    
    # Team configurations
    teams:
      - team_id: "development-team"
        team_alias: "dev"
        members: ["agent-user-1", "agent-user-2"]
        spend_limit: 1000.0
        duration: "1mo"
        
      - team_id: "production-team"
        team_alias: "prod"
        members: ["admin-user"]
        spend_limit: 5000.0
        duration: "1mo"
```

### Custom Middleware
```python
# custom_middleware.py
from litellm import completion, acompletion
from litellm.integrations.custom_logger import CustomLogger
import time
import asyncio
from typing import Dict, Any

class CustomLiteLLMLogger(CustomLogger):
    def __init__(self):
        super().__init__()
        self.start_time = {}
    
    def log_pre_api_call(self, model, messages, kwargs):
        """Log before API call"""
        request_id = kwargs.get('request_id', 'unknown')
        self.start_time[request_id] = time.time()
        
        print(f"[PRE-CALL] Model: {model}, Request ID: {request_id}")
        print(f"[PRE-CALL] Messages: {len(messages)} messages")
        print(f"[PRE-CALL] Kwargs: {kwargs}")
    
    def log_post_api_call(self, kwargs, response_obj, start_time, end_time):
        """Log after API call"""
        request_id = kwargs.get('request_id', 'unknown')
        duration = end_time - start_time
        
        print(f"[POST-CALL] Request ID: {request_id}")
        print(f"[POST-CALL] Duration: {duration:.2f}s")
        print(f"[POST-CALL] Response: {response_obj}")
        
        # Custom metrics collection
        self.collect_custom_metrics(kwargs, response_obj, duration)
    
    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        """Log successful completion"""
        request_id = kwargs.get('request_id', 'unknown')
        print(f"[SUCCESS] Request {request_id} completed successfully")
    
    def log_failure_event(self, kwargs, response_obj, start_time, end_time):
        """Log failed completion"""
        request_id = kwargs.get('request_id', 'unknown')
        print(f"[FAILURE] Request {request_id} failed: {response_obj}")
    
    def collect_custom_metrics(self, kwargs, response_obj, duration):
        """Collect custom metrics"""
        # Implement custom metrics collection
        pass

# Initialize custom logger
custom_logger = CustomLiteLLMLogger()

# Example usage with custom routing
class SmartRouter:
    def __init__(self):
        self.model_performance = {}
        self.load_balancer = {}
    
    def route_request(self, messages: list, model_preferences: list = None, 
                     performance_threshold: float = 2.0) -> str:
        """Smart routing based on performance and availability"""
        
        # Default to fastest performing model
        if not model_preferences:
            model_preferences = ["gpt-3.5-turbo", "llama2-7b", "gpt-4"]
        
        for model in model_preferences:
            avg_performance = self.model_performance.get(model, 0)
            
            if avg_performance < performance_threshold:
                return model
        
        # Fallback to first available model
        return model_preferences[0]
    
    def update_performance_metrics(self, model: str, duration: float):
        """Update performance metrics for routing decisions"""
        if model not in self.model_performance:
            self.model_performance[model] = []
        
        self.model_performance[model].append(duration)
        
        # Keep only last 100 measurements
        if len(self.model_performance[model]) > 100:
            self.model_performance[model] = self.model_performance[model][-100:]
    
    def get_model_stats(self) -> Dict[str, Any]:
        """Get performance statistics for all models"""
        stats = {}
        for model, durations in self.model_performance.items():
            if durations:
                stats[model] = {
                    "avg_duration": sum(durations) / len(durations),
                    "min_duration": min(durations),
                    "max_duration": max(durations),
                    "request_count": len(durations)
                }
        return stats

# Initialize smart router
router = SmartRouter()
```

## Step 3: Client Integration

### Python Client
```python
# litellm_client.py
import openai
import asyncio
from typing import Dict, Any, List
import json

class LiteLLMClient:
    def __init__(self, base_url: str = "http://litellm-service:4000", 
                 api_key: str = None):
        self.client = openai.OpenAI(
            base_url=base_url,
            api_key=api_key or "sk-1234"  # Use actual API key in production
        )
    
    def completion(self, messages: List[Dict[str, str]], model: str = "gpt-3.5-turbo", 
                  **kwargs) -> Dict[str, Any]:
        """Synchronous completion"""
        try:
            response = self.client.chat.completions.create(
                model=model,
                messages=messages,
                **kwargs
            )
            return {
                "content": response.choices[0].message.content,
                "model": response.model,
                "usage": response.usage.dict() if response.usage else None,
                "finish_reason": response.choices[0].finish_reason
            }
        except Exception as e:
            return {"error": str(e)}
    
    async def acompletion(self, messages: List[Dict[str, str]], 
                         model: str = "gpt-3.5-turbo", **kwargs) -> Dict[str, Any]:
        """Asynchronous completion"""
        try:
            response = await self.client.chat.completions.acreate(
                model=model,
                messages=messages,
                **kwargs
            )
            return {
                "content": response.choices[0].message.content,
                "model": response.model,
                "usage": response.usage.dict() if response.usage else None,
                "finish_reason": response.choices[0].finish_reason
            }
        except Exception as e:
            return {"error": str(e)}
    
    def stream_completion(self, messages: List[Dict[str, str]], 
                         model: str = "gpt-3.5-turbo", **kwargs):
        """Streaming completion"""
        try:
            stream = self.client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                **kwargs
            )
            
            for chunk in stream:
                if chunk.choices[0].delta.content is not None:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            yield f"Error: {str(e)}"
    
    def get_available_models(self) -> List[str]:
        """Get list of available models"""
        try:
            models = self.client.models.list()
            return [model.id for model in models.data]
        except Exception as e:
            return []
    
    def health_check(self) -> Dict[str, Any]:
        """Check gateway health"""
        try:
            response = self.client.get("/health")
            return response.json()
        except Exception as e:
            return {"status": "unhealthy", "error": str(e)}

# Usage examples
client = LiteLLMClient(base_url="http://localhost:4000")

# Simple completion
response = client.completion(
    messages=[{"role": "user", "content": "Hello, how are you?"}],
    model="gpt-3.5-turbo"
)
print(response)

# Async completion
async def async_example():
    response = await client.acompletion(
        messages=[{"role": "user", "content": "What is AI?"}],
        model="claude-3-sonnet"
    )
    print(response)

# Streaming completion
print("Streaming response:")
for chunk in client.stream_completion(
    messages=[{"role": "user", "content": "Tell me a story"}],
    model="llama2-7b"
):
    print(chunk, end="")
```

## Step 4: Load Testing and Monitoring

### Load Testing Script
```python
# load_test.py
import asyncio
import aiohttp
import time
from concurrent.futures import ThreadPoolExecutor
import json
import statistics

class LoadTester:
    def __init__(self, base_url: str = "http://localhost:4000"):
        self.base_url = base_url
        self.results = []
    
    async def single_request(self, session, model: str, test_id: int):
        """Single request for load testing"""
        start_time = time.time()
        
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": f"Test request {test_id}: Please respond with a brief greeting."
                }
            ],
            "max_tokens": 50
        }
        
        try:
            async with session.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers={"Authorization": "Bearer sk-1234"}
            ) as response:
                result = await response.json()
                end_time = time.time()
                
                return {
                    "test_id": test_id,
                    "model": model,
                    "duration": end_time - start_time,
                    "status": response.status,
                    "success": response.status == 200,
                    "response": result
                }
        except Exception as e:
            end_time = time.time()
            return {
                "test_id": test_id,
                "model": model,
                "duration": end_time - start_time,
                "status": 0,
                "success": False,
                "error": str(e)
            }
    
    async def run_load_test(self, models: list, requests_per_model: int = 100, 
                           concurrent_requests: int = 10):
        """Run load test across multiple models"""
        
        connector = aiohttp.TCPConnector(limit=concurrent_requests)
        timeout = aiohttp.ClientTimeout(total=30)
        
        async with aiohttp.ClientSession(
            connector=connector, 
            timeout=timeout
        ) as session:
            
            tasks = []
            test_id = 0
            
            for model in models:
                for _ in range(requests_per_model):
                    task = self.single_request(session, model, test_id)
                    tasks.append(task)
                    test_id += 1
            
            print(f"Starting load test with {len(tasks)} total requests...")
            start_time = time.time()
            
            results = await asyncio.gather(*tasks)
            
            end_time = time.time()
            total_duration = end_time - start_time
            
            self.results = results
            self.analyze_results(total_duration)
    
    def analyze_results(self, total_duration: float):
        """Analyze load test results"""
        successful_requests = [r for r in self.results if r["success"]]
        failed_requests = [r for r in self.results if not r["success"]]
        
        print(f"\n=== LOAD TEST RESULTS ===")
        print(f"Total requests: {len(self.results)}")
        print(f"Successful requests: {len(successful_requests)}")
        print(f"Failed requests: {len(failed_requests)}")
        print(f"Success rate: {len(successful_requests)/len(self.results)*100:.2f}%")
        print(f"Total duration: {total_duration:.2f}s")
        print(f"Requests per second: {len(self.results)/total_duration:.2f}")
        
        if successful_requests:
            durations = [r["duration"] for r in successful_requests]
            print(f"\nLatency Statistics:")
            print(f"Average: {statistics.mean(durations):.2f}s")
            print(f"Median: {statistics.median(durations):.2f}s")
            print(f"Min: {min(durations):.2f}s")
            print(f"Max: {max(durations):.2f}s")
            print(f"P95: {statistics.quantiles(durations, n=20)[18]:.2f}s")
            print(f"P99: {statistics.quantiles(durations, n=100)[98]:.2f}s")
        
        # Per-model analysis
        model_stats = {}
        for result in successful_requests:
            model = result["model"]
            if model not in model_stats:
                model_stats[model] = []
            model_stats[model].append(result["duration"])
        
        print(f"\nPer-Model Statistics:")
        for model, durations in model_stats.items():
            print(f"{model}:")
            print(f"  Requests: {len(durations)}")
            print(f"  Avg Duration: {statistics.mean(durations):.2f}s")
            print(f"  P95: {statistics.quantiles(durations, n=20)[18]:.2f}s")

# Run load test
async def main():
    tester = LoadTester()
    await tester.run_load_test(
        models=["gpt-3.5-turbo", "llama2-7b", "balanced-local"],
        requests_per_model=50,
        concurrent_requests=20
    )

if __name__ == "__main__":
    asyncio.run(main())
```

## Step 5: Deployment and Testing

### Deploy LiteLLM
```bash
# Deploy secrets (update with actual API keys)
kubectl apply -f litellm-secrets.yaml

# Deploy configuration
kubectl apply -f litellm-config.yaml

# Deploy LiteLLM gateway
kubectl apply -f litellm-deployment.yaml

# Wait for deployment
kubectl wait --for=condition=ready pod -l app=litellm-gateway -n genai-platform --timeout=300s

# Check deployment
kubectl get pods -l app=litellm-gateway -n genai-platform
kubectl logs deployment/litellm-gateway -n genai-platform
```

### Test Gateway
```bash
# Port forward for testing
kubectl port-forward svc/litellm-service 4000:4000 -n genai-platform

# Test health endpoint
curl http://localhost:4000/health

# Test completion endpoint
curl -X POST http://localhost:4000/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-1234" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }'

# Test model listing
curl http://localhost:4000/models \
  -H "Authorization: Bearer sk-1234"
```

## Best Practices

1. **API Key Management**: Use Kubernetes secrets for API keys
2. **Rate Limiting**: Configure appropriate rate limits for different users
3. **Monitoring**: Set up comprehensive monitoring and alerting
4. **Caching**: Enable response caching for frequently used prompts
5. **Cost Control**: Implement spend limits and usage tracking
6. **Security**: Use proper authentication and authorization

## What's Next?

Congratulations! You've completed Module 2. You now have a complete GenAI platform with:
- Core infrastructure components
- Comprehensive observability with LangFuse
- Unified API gateway with LiteLLM

Ready to build GenAI applications? Continue with [Module 3: GenAI Applications](/module3-genai-applications/). 