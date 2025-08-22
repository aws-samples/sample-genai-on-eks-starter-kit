---
title: "LiteLLM - Unified AI Gateway"
weight: 1
---

## Overview

LiteLLM serves as a unified API gateway for all your LLM models, providing a single OpenAI-compatible endpoint that can route requests to multiple backend providers including self-hosted models (vLLM), AWS Bedrock, and other cloud providers.

## Architecture

```mermaid
graph LR
    A[Open WebUI] --> B[LiteLLM Gateway]
    B --> C[vLLM Models]
    B --> D[AWS Bedrock]
    B --> E[Other Providers]
    
    style B fill:#f9f,stroke:#333,stroke-width:4px
```

## Deployment Configuration

LiteLLM is deployed using Helm with dynamic model discovery. Let's examine the configuration:

### Helm Values Template

```yaml
# components/ai-gateway/litellm/values.template.yaml
replicaCount: 1

image:
  repository: ghcr.io/berriai/litellm
  tag: main-v1.55.8
  pullPolicy: Always

service:
  type: ClusterIP
  port: 4000
  annotations: {}

resources:
  limits:
    cpu: "2"
    memory: "2Gi"
  requests:
    cpu: "1"
    memory: "1Gi"

# Dynamic model configuration using Handlebars templating
env:
  - name: LITELLM_MASTER_KEY
    value: "sk-1234"
  - name: DATABASE_URL
    value: "postgresql://llmproxy:dbpassword9999@litellm-db:5432/litellm"
  - name: STORE_MODEL_IN_DB
    value: "True"
  - name: LITELLM_MODE
    value: "PROXY"

# Model configuration loaded dynamically
litellm_settings:
  drop_params: true
  set_verbose: true
  
model_list:
{{#each litellm_models}}
  - model_name: {{this.model_name}}
    litellm_params:
      model: {{this.litellm_params.model}}
      {{#if this.litellm_params.api_base}}
      api_base: {{this.litellm_params.api_base}}
      {{/if}}
      {{#if this.litellm_params.aws_region_name}}
      aws_region_name: {{this.litellm_params.aws_region_name}}
      {{/if}}
      {{#if this.litellm_params.aws_access_key_id}}
      aws_access_key_id: {{this.litellm_params.aws_access_key_id}}
      {{/if}}
      {{#if this.litellm_params.aws_secret_access_key}}
      aws_secret_access_key: {{this.litellm_params.aws_secret_access_key}}
      {{/if}}
{{/each}}
```

### Dynamic Model Discovery

The configuration uses Handlebars templating to dynamically discover and configure models:

1. **vLLM Models**: Automatically discovered from running vLLM services
2. **Bedrock Models**: Configured through environment variables
3. **Other Providers**: Can be added through the model_list configuration

## Current Deployment

Check the current LiteLLM deployment:

```bash
# View the deployment
kubectl get deployment litellm -n genai

# Check the pods
kubectl get pods -n genai -l app=litellm

# View the service
kubectl get svc litellm -n genai
```

Expected output:
```
NAME      READY   UP-TO-DATE   AVAILABLE   AGE
litellm   1/1     1            1           2h

NAME                       READY   STATUS    RESTARTS   AGE
litellm-7b9c5d4f6-x2m3p   1/1     Running   0          2h

NAME      TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
litellm   ClusterIP   10.100.50.123   <none>        4000/TCP   2h
```

## Access LiteLLM UI

LiteLLM provides a web interface for monitoring and management:

```bash
# Port-forward to access the UI
kubectl port-forward -n genai svc/litellm 4000:4000
```

Then open http://localhost:4000 in your browser. Use the master key `sk-1234` to authenticate.

## Current Models

View the currently configured models:

```bash
# Get the current configuration
kubectl get configmap litellm-config -n genai -o yaml | grep -A 20 "model_list:"
```

You should see models like:
- `meta-llama/Llama-3.2-1B-Instruct` (from vLLM)
- `bedrock/anthropic.claude-3-sonnet-20240229-v1:0` (from Bedrock)

## 🛠️ Exercise: Add Claude 3.5 Haiku to LiteLLM

Let's add a new Bedrock model (Claude 3.5 Haiku) to LiteLLM using Helm upgrade.

### Step 1: Enable Claude 3.5 Haiku in Bedrock

First, ensure the model is enabled in your AWS account:

1. Open the AWS Console and navigate to Amazon Bedrock
2. Go to **Model access** in the left sidebar
3. Find **Claude 3.5 Haiku** (anthropic.claude-3-5-haiku-20241022-v1:0)
4. Click **Request model access** if not already enabled
5. Wait for the status to show **Access granted**

### Step 2: Update the Helm Values

Create a new values file with the additional model:

```bash
cat > litellm-update-values.yaml <<EOF
model_list:
  # Existing vLLM model
  - model_name: "meta-llama/Llama-3.2-1B-Instruct"
    litellm_params:
      model: "openai/meta-llama/Llama-3.2-1B-Instruct"
      api_base: "http://vllm-llama3-2-1b:8000/v1"
      api_key: "dummy"
      
  # Existing Bedrock Sonnet model  
  - model_name: "claude-3-sonnet"
    litellm_params:
      model: "bedrock/anthropic.claude-3-sonnet-20240229-v1:0"
      aws_region_name: "us-west-2"
      
  # NEW: Claude 3.5 Haiku model
  - model_name: "claude-3.5-haiku"
    litellm_params:
      model: "bedrock/anthropic.claude-3-5-haiku-20241022-v1:0"
      aws_region_name: "us-west-2"
EOF
```

### Step 3: Upgrade the Helm Release

Apply the configuration update:

```bash
# Upgrade the LiteLLM deployment
helm upgrade litellm litellm/litellm \
  -n genai \
  -f litellm-update-values.yaml \
  --reuse-values

# Watch the rollout
kubectl rollout status deployment/litellm -n genai
```

### Step 4: Verify the New Model

Check that the new model is available:

```bash
# Test the model endpoint
curl -X POST http://localhost:4000/v1/models \
  -H "Authorization: Bearer sk-1234" | jq '.data[] | select(.id == "claude-3.5-haiku")'
```

### Step 5: Test in Open WebUI

1. Go back to Open WebUI (http://localhost:3000)
2. Click on the model selector dropdown
3. You should now see **claude-3.5-haiku** in the list
4. Select it and test with a prompt:
   ```
   What makes you different from Claude 3 Sonnet?
   ```

## Model Routing Logic

LiteLLM intelligently routes requests based on:

1. **Model Availability**: Checks if the model endpoint is healthy
2. **Cost Optimization**: Can route to cheaper models when appropriate
3. **Rate Limiting**: Distributes load across multiple endpoints
4. **Fallback Logic**: Automatically fails over to backup models

Example routing configuration:

```yaml
router_settings:
  routing_strategy: "least-cost"  # Options: least-cost, latency-based, simple-shuffle
  
  model_group_alias:
    "claude-models":
      - "claude-3-sonnet"
      - "claude-3.5-haiku"
    "llama-models":
      - "meta-llama/Llama-3.2-1B-Instruct"
```

## Monitoring and Metrics

LiteLLM provides built-in monitoring:

```bash
# View metrics endpoint
curl http://localhost:4000/metrics

# Check model usage
curl -X GET http://localhost:4000/spend/report \
  -H "Authorization: Bearer sk-1234"
```

Key metrics to monitor:
- Request latency per model
- Token usage and costs
- Error rates by provider
- Model availability status

## Troubleshooting

Common issues and solutions:

### Model Not Appearing
```bash
# Check LiteLLM logs
kubectl logs -n genai deployment/litellm --tail=50

# Verify ConfigMap
kubectl get configmap litellm-config -n genai -o yaml
```

### Authentication Errors
```bash
# Verify AWS credentials
kubectl get secret -n genai aws-credentials -o yaml

# Test Bedrock access
aws bedrock list-foundation-models --region us-west-2
```

### Connection Issues
```bash
# Test internal connectivity
kubectl run test-curl --image=curlimages/curl -it --rm -- \
  curl http://litellm:4000/health
```

## Best Practices

1. **Use Environment Variables**: Store sensitive credentials in Kubernetes secrets
2. **Enable Caching**: Configure Redis for response caching
3. **Set Rate Limits**: Protect backend services from overload
4. **Monitor Costs**: Track token usage across models
5. **Configure Fallbacks**: Ensure high availability with backup models

## Next Steps

Now that LiteLLM is configured with multiple models, let's move on to setting up observability with Langfuse to track and analyze our LLM interactions.

[Continue to Langfuse →](../observability/)
