# Guardrails AI

References:

- https://www.guardrailsai.com/docs/how_to_guides/hosting_with_docker
- https://github.com/guardrails-ai/guardrails-lite-server
- https://github.com/guardrails-ai/detect_pii

## Test

- Via Open WebUI:

```
Validate this email address - genai-on-eks@example.com

Validate this IP address - 50.0.10.1

Validate this phone number - 123-456-7890
```

- Via curl to Guardrails Server pod:

```
curl -X 'POST' \
  'http://localhost:8000/guards/detect-pii/validate' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
      "llmOutput": "My email address is john.doe@example.com, my IP address and 192.168.1.1, and my phone number is 123-456-7890"
}'
```
