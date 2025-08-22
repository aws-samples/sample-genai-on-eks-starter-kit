---
title: "Langfuse - LLM Observability"
weight: 2
---

## Overview

Langfuse provides comprehensive observability for LLM applications, enabling you to monitor, debug, and optimize your AI interactions. It captures detailed traces of LLM calls, including prompts, completions, latency, and costs.

## Architecture

Langfuse deployment includes multiple components for scalability:

```mermaid
graph TB
    A[LLM Applications] --> B[Langfuse Server]
    B --> C[(PostgreSQL)]
    B --> D[(ClickHouse)]
    B --> E[(Redis)]
    
    F[Langfuse Worker] --> C
    F --> D
    F --> E
    
    style B fill:#9f9,stroke:#333,stroke-width:4px
    style F fill:#9f9,stroke:#333,stroke-width:2px
```

## Deployment Configuration

Langfuse is deployed with a complete observability stack:

### Helm Values Overview

```yaml
# components/o11y/langfuse/values.template.yaml
langfuse:
  service:
    type: ClusterIP
    port: 3000
    
  resources:
    limits:
      cpu: "2"
      memory: "2Gi"
    requests:
      cpu: "500m"
      memory: "512Mi"

  env:
    - name: DATABASE_URL
      value: "postgresql://postgres:postgres@langfuse-postgresql:5432/langfuse"
    - name: CLICKHOUSE_URL
      value: "http://langfuse-clickhouse:8123"
    - name: REDIS_URL
      value: "redis://langfuse-redis-master:6379"
    - name: NEXTAUTH_SECRET
      value: "mysecretkey"
    - name: SALT
      value: "mysalt"
    - name: NEXTAUTH_URL
      value: "http://localhost:3001"
    - name: TELEMETRY_ENABLED
      value: "false"
    - name: LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES
      value: "true"

# PostgreSQL for metadata
postgresql:
  enabled: true
  auth:
    username: postgres
    password: postgres
    database: langfuse
  primary:
    persistence:
      enabled: true
      size: 10Gi

# ClickHouse for analytics
clickhouse:
  enabled: true
  auth:
    username: default
    password: clickhouse
  persistence:
    enabled: true
    size: 20Gi

# Redis for caching
redis:
  enabled: true
  auth:
    enabled: false
  master:
    persistence:
      enabled: true
      size: 5Gi

# Background worker for async processing
langfuseWorker:
  enabled: true
  replicaCount: 1
```

## Current Deployment Status

Check the Langfuse components:

```bash
# View all Langfuse components
kubectl get all -n genai -l app.kubernetes.io/instance=langfuse

# Check specific components
kubectl get pods -n genai | grep langfuse
```

Expected output:
```
langfuse-server-7d9f8b6c5-k2x3m          1/1     Running   0          2h
langfuse-worker-6b5c4d3f2-p9q8n          1/1     Running   0          2h
langfuse-postgresql-0                     1/1     Running   0          2h
langfuse-clickhouse-0                     1/1     Running   0          2h
langfuse-redis-master-0                   1/1     Running   0          2h
```

## Access Langfuse UI

Set up port forwarding to access the Langfuse dashboard:

```bash
# Port-forward the Langfuse service
kubectl port-forward -n genai svc/langfuse 3001:3000
```

Open http://localhost:3001 in your browser.

### Initial Setup

1. **Create an account**:
   - Click "Sign up"
   - Enter your email and password
   - Confirm your account

2. **Create a project**:
   - Click "New Project"
   - Name: `eks-workshop`
   - Description: `EKS GenAI Workshop Traces`

3. **Generate API keys**:
   - Go to Settings → API Keys
   - Click "Create new API key"
   - Copy the Public and Secret keys

## 🛠️ Exercise: Configure LiteLLM Integration

Now let's connect LiteLLM to send traces to Langfuse:

### Step 1: Update LiteLLM Configuration

Create an updated values file with Langfuse integration:

```bash
cat > litellm-langfuse-values.yaml <<EOF
env:
  # Existing environment variables
  - name: LITELLM_MASTER_KEY
    value: "sk-1234"
  - name: DATABASE_URL
    value: "postgresql://llmproxy:dbpassword9999@litellm-db:5432/litellm"
  - name: STORE_MODEL_IN_DB
    value: "True"
  - name: LITELLM_MODE
    value: "PROXY"
    
  # Langfuse integration
  - name: LANGFUSE_PUBLIC_KEY
    value: "pk_lf_YOUR_PUBLIC_KEY"  # Replace with your key
  - name: LANGFUSE_SECRET_KEY
    value: "sk_lf_YOUR_SECRET_KEY"  # Replace with your key
  - name: LANGFUSE_HOST
    value: "http://langfuse:3000"
  - name: LITELLM_CALLBACKS
    value: "langfuse"
  - name: LANGFUSE_FLUSH_INTERVAL
    value: "1"

# Keep existing model configuration
model_list:
  - model_name: "meta-llama/Llama-3.2-1B-Instruct"
    litellm_params:
      model: "openai/meta-llama/Llama-3.2-1B-Instruct"
      api_base: "http://vllm-llama3-2-1b:8000/v1"
      api_key: "dummy"
      
  - model_name: "claude-3-sonnet"
    litellm_params:
      model: "bedrock/anthropic.claude-3-sonnet-20240229-v1:0"
      aws_region_name: "us-west-2"
      
  - model_name: "claude-3.5-haiku"
    litellm_params:
      model: "bedrock/anthropic.claude-3-5-haiku-20241022-v1:0"
      aws_region_name: "us-west-2"
EOF
```

### Step 2: Apply the Configuration

```bash
# Upgrade LiteLLM with Langfuse integration
helm upgrade litellm litellm/litellm \
  -n genai \
  -f litellm-langfuse-values.yaml \
  --reuse-values

# Wait for rollout
kubectl rollout status deployment/litellm -n genai
```

### Step 3: Test the Integration

Generate some test traces:

```bash
# Send a test request through LiteLLM
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-1234" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3.5-haiku",
    "messages": [
      {"role": "user", "content": "What is observability in the context of LLMs?"}
    ]
  }'
```

### Step 4: View Traces in Langfuse

1. Go back to Langfuse UI (http://localhost:3001)
2. Navigate to the **Traces** section
3. You should see your request with:
   - Input prompt
   - Model response
   - Token usage
   - Latency metrics
   - Cost calculation

## Exploring Langfuse Features

### Traces Dashboard

The main dashboard shows:
- **Request volume** over time
- **Token usage** trends
- **Cost breakdown** by model
- **Latency distribution**
- **Error rates**

### Detailed Trace View

Click on any trace to see:

1. **Conversation Flow**:
   ```
   User → LiteLLM → Claude 3.5 Haiku → Response
   ```

2. **Metadata**:
   - Request ID
   - Timestamp
   - Model used
   - Token counts (input/output)
   - Duration

3. **Raw Data**:
   - Full prompt
   - Complete response
   - Model parameters

### Sessions

Group related traces into sessions:

```python
# Example: Tracking a conversation session
headers = {
    "Authorization": "Bearer sk-1234",
    "Content-Type": "application/json",
    "X-Langfuse-Session-Id": "workshop-session-001"
}
```

### Scoring and Feedback

Add quality scores to traces:

```bash
# Add a score via API
curl -X POST http://localhost:3001/api/public/scores \
  -H "Authorization: Bearer YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "traceId": "TRACE_ID_HERE",
    "name": "quality",
    "value": 0.9,
    "comment": "High quality response"
  }'
```

## Analytics and Insights

### Model Comparison

Compare performance across models:

1. Go to **Analytics** → **Models**
2. View side-by-side metrics:
   - Average latency
   - Token efficiency
   - Cost per request
   - Error rates

### Usage Patterns

Analyze usage patterns:

```sql
-- Example query in ClickHouse (accessible via Langfuse UI)
SELECT 
  model,
  COUNT(*) as requests,
  AVG(latency_ms) as avg_latency,
  SUM(total_tokens) as total_tokens
FROM traces
WHERE timestamp > now() - INTERVAL 1 DAY
GROUP BY model
ORDER BY requests DESC
```

### Cost Optimization

Identify cost optimization opportunities:

1. **High-cost queries**: Find prompts using excessive tokens
2. **Model selection**: Compare cost/performance trade-offs
3. **Caching opportunities**: Identify repeated queries

## Alerting and Monitoring

### Set Up Alerts

Configure alerts for:

1. **High latency** (> 5 seconds)
2. **Error spikes** (> 5% error rate)
3. **Cost thresholds** (> $10/hour)
4. **Token limits** (> 100k tokens/request)

Example alert configuration:

```yaml
alerts:
  - name: high_latency
    condition: "avg(latency_ms) > 5000"
    window: "5m"
    notification:
      slack: "#genai-alerts"
      
  - name: cost_threshold
    condition: "sum(cost_usd) > 10"
    window: "1h"
    notification:
      email: "team@example.com"
```

## Debugging with Langfuse

### Common Issues to Track

1. **Prompt Issues**:
   - Ambiguous instructions
   - Missing context
   - Token limit exceeded

2. **Model Behavior**:
   - Inconsistent responses
   - Hallucinations
   - Refusals

3. **Performance Problems**:
   - Slow responses
   - Timeouts
   - Rate limiting

### Using Filters

Filter traces to debug specific issues:

```javascript
// Filter examples in Langfuse UI
filters = {
  model: "claude-3.5-haiku",
  latency: "> 3000",
  status: "error",
  timeRange: "last_hour"
}
```

## Export and Integration

### Export Data

Export trace data for analysis:

```bash
# Export traces via API
curl -X GET "http://localhost:3001/api/public/traces?limit=1000" \
  -H "Authorization: Bearer YOUR_SECRET_KEY" \
  -o traces.json
```

### Integrate with Other Tools

Langfuse can integrate with:

1. **Grafana**: For custom dashboards
2. **Datadog**: For infrastructure correlation
3. **Slack**: For notifications
4. **Python SDK**: For custom analysis

Example Python integration:

```python
from langfuse import Langfuse

# Initialize client
langfuse = Langfuse(
    public_key="pk_lf_YOUR_KEY",
    secret_key="sk_lf_YOUR_KEY",
    host="http://localhost:3001"
)

# Fetch traces
traces = langfuse.get_traces(limit=100)
for trace in traces:
    print(f"Model: {trace.model}, Latency: {trace.latency_ms}ms")
```

## Best Practices

1. **Consistent Naming**: Use clear, consistent names for traces and sessions
2. **Add Metadata**: Include relevant context (user ID, feature flags, etc.)
3. **Score Important Interactions**: Add quality scores for critical paths
4. **Regular Review**: Schedule weekly reviews of analytics
5. **Set Baselines**: Establish performance baselines for each model
6. **Privacy Compliance**: Configure data retention according to requirements

## Troubleshooting

### No Traces Appearing

```bash
# Check LiteLLM logs for Langfuse connection
kubectl logs -n genai deployment/litellm | grep -i langfuse

# Verify Langfuse is accessible from LiteLLM
kubectl exec -n genai deployment/litellm -- curl http://langfuse:3000/health
```

### Missing Data

```bash
# Check Langfuse worker logs
kubectl logs -n genai -l app=langfuse-worker

# Verify database connections
kubectl exec -n genai langfuse-postgresql-0 -- psql -U postgres -d langfuse -c "SELECT COUNT(*) FROM traces;"
```

### Performance Issues

```bash
# Check resource usage
kubectl top pods -n genai | grep langfuse

# Scale if needed
kubectl scale deployment langfuse-worker -n genai --replicas=3
```

## Next Steps

With Langfuse providing comprehensive observability, let's explore how all components work together in an integrated system.

[Continue to Integration →](../integration/)
