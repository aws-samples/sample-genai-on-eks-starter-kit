# Kong AI Gateway

Enterprise-grade API gateway with advanced rate limiting, authentication, and AI-specific plugins for LLM applications.

| | |
|---|---|
| **Category** | ai-gateway |
| **Official Docs** | [Kong Gateway Documentation](https://docs.konghq.com/) |
| **CLI Install** | `./cli ai-gateway kong install` |
| **CLI Uninstall** | `./cli ai-gateway kong uninstall` |
| **Namespace** | `kong` |

## Overview

Kong Gateway provides enterprise features for LLM applications:
- **Authentication**: API key, OAuth2, JWT
- **Rate Limiting**: Advanced throttling policies
- **Request/Response Transformation**: Modify payloads on the fly
- **AI Plugins**: AI prompt guard, AI request transformer, AI rate limiting
- **Observability**: Datadog, Prometheus, StatsD integration
- **High Availability**: Multi-instance deployments with PostgreSQL backend

## Installation

```bash
./cli ai-gateway kong install
```

The installer deploys:
1. PostgreSQL database for Kong state
2. Kong Gateway with DB mode
3. Kong Ingress Controller (optional)
4. Admin API and Proxy services

## Verification

```bash
# Check Kong pods
kubectl get pods -n kong

# Check services
kubectl get svc -n kong

# Port-forward Admin API
kubectl port-forward svc/kong-admin 8001:8001 -n kong --address 0.0.0.0 &

# Check Kong status
curl http://localhost:8001/status

# List services
curl http://localhost:8001/services
```

## Configuration

### Exposing Backend Services

Create Kong Service and Route for LiteLLM:

```bash
# Create Service
curl -X POST http://localhost:8001/services \
  --data name=litellm \
  --data url=http://litellm.litellm:4000

# Create Route
curl -X POST http://localhost:8001/services/litellm/routes \
  --data paths[]=/litellm \
  --data strip_path=true
```

### Rate Limiting

Add rate limiting plugin:

```bash
curl -X POST http://localhost:8001/services/litellm/plugins \
  --data name=rate-limiting \
  --data config.minute=100 \
  --data config.policy=local
```

### Authentication

Enable API key authentication:

```bash
# Add key-auth plugin
curl -X POST http://localhost:8001/services/litellm/plugins \
  --data name=key-auth

# Create consumer
curl -X POST http://localhost:8001/consumers \
  --data username=myapp

# Create API key
curl -X POST http://localhost:8001/consumers/myapp/key-auth \
  --data key=my-secret-key
```

Test with API key:

```bash
curl http://localhost:8000/litellm/v1/models \
  -H "apikey: my-secret-key"
```

### AI Rate Limiting

Kong's AI Rate Limiting plugin provides token-based throttling:

```bash
curl -X POST http://localhost:8001/services/litellm/plugins \
  --data name=ai-rate-limiting-advanced \
  --data config.limit_by=consumer \
  --data config.window_size=60 \
  --data config.window_type=sliding \
  --data config.max_tokens=10000
```

## Usage

### Access via Kong Proxy

```bash
# Port-forward Kong proxy
kubectl port-forward svc/kong-proxy 8000:8000 -n kong --address 0.0.0.0 &

# Make request through Kong
curl http://localhost:8000/litellm/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "apikey: my-secret-key" \
  -d '{
    "model": "vllm/qwen3-30b-instruct-fp8",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Declarative Configuration

Create Kong resources via YAML:

```yaml
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata:
  name: rate-limiting
  namespace: kong
config:
  minute: 100
  policy: local
plugin: rate-limiting
---
apiVersion: v1
kind: Service
metadata:
  name: litellm-proxy
  namespace: kong
  annotations:
    konghq.com/plugins: rate-limiting
spec:
  selector:
    app: litellm
  ports:
  - port: 4000
    targetPort: 4000
```

## Observability

### Prometheus Metrics

Enable Prometheus plugin:

```bash
curl -X POST http://localhost:8001/plugins \
  --data name=prometheus
```

Metrics available at `http://kong-admin.kong:8001/metrics`.

### Logging

Enable file-log plugin to send logs to external systems:

```bash
curl -X POST http://localhost:8001/plugins \
  --data name=file-log \
  --data config.path=/tmp/kong.log
```

## Troubleshooting

### Kong pods not starting

```bash
# Check PostgreSQL connection
kubectl logs -n kong -l app=kong | grep postgres

# Check database migrations
kubectl logs -n kong -l job-name=kong-migrations
```

### Admin API not accessible

```bash
# Check Admin API service
kubectl get svc -n kong kong-admin

# Check port-forward
kubectl port-forward svc/kong-admin 8001:8001 -n kong --address 0.0.0.0 &
curl http://localhost:8001/status
```

### Rate limiting not working

```bash
# Check plugin is enabled
curl http://localhost:8001/services/litellm/plugins | jq '.data[] | select(.name=="rate-limiting")'

# Check rate limit headers in response
curl -i http://localhost:8000/litellm/v1/models
# Look for: X-RateLimit-Limit-Minute, X-RateLimit-Remaining-Minute
```

## Learn More

- [Kong Gateway Documentation](https://docs.konghq.com/)
- [Kong AI Plugins](https://docs.konghq.com/hub/?category=ai)
- [Kong Ingress Controller](https://docs.konghq.com/kubernetes-ingress-controller/)
- [Rate Limiting Plugin](https://docs.konghq.com/hub/kong-inc/rate-limiting/)
