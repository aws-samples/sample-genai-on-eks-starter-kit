#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# Deploy the streaming Loan Buddy agent (SSE + Pydantic validation).
#
# Same image-reuse strategy as the RAG agent: mount code from a ConfigMap onto
# the Module 3 image and pip-install the extra deps at start. Bundles the
# streaming agent, the Pydantic schema, and Module 3's utils.py.
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
NAMESPACE="workshop"

echo -e "${BLUE}=== Deploy Loan Buddy Streaming Agent ===${NC}"

: "${REGION:=${AWS_REGION:-us-east-1}}"
# Credentials come from this account's generated values, never a shared default.
# /workshop/.env.local is written per team account at provisioning time.
if [ -f /workshop/.env.local ]; then
  # shellcheck disable=SC1091
  . /workshop/.env.local
fi
# AGENT_KEY is deliberately NOT defaulted to LITELLM_API_KEY. That variable holds
# the LiteLLM *master* key, and this value is written into the agent pod spec, so
# a default would hand the master key to the workload instead of a scoped virtual key.
: "${AGENT_KEY:=}"
: "${LANGFUSE_PUBLIC_KEY:=}"
: "${LANGFUSE_SECRET_KEY:=}"
if [ -z "$AGENT_KEY" ]; then
  echo "ERROR: AGENT_KEY is not set." >&2
  echo "       It must be a LiteLLM virtual key (starts with sk-), not LITELLM_API_KEY, which is the master key." >&2
  echo "       Create one in the LiteLLM UI (Virtual Keys > Create New Key), as described in Module A1 or in the" >&2
  echo "       virtual-key shortcut of the Introduction, then run: export AGENT_KEY=\"sk-...\"" >&2
  echo "       (or save it as AGENT_KEY=sk-... in /workshop/.env.local) and run this script again." >&2
  exit 1
fi

if [ -z "${S3_BUCKET_NAME:-}" ]; then
  S3_BUCKET_NAME=$(kubectl get deployment loan-buddy-agent -n "$NAMESPACE" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="S3_BUCKET_NAME")].value}' 2>/dev/null || true)
fi
[ -n "${S3_BUCKET_NAME:-}" ] || { echo -e "${RED}❌ S3_BUCKET_NAME unset.${NC}"; exit 1; }
echo -e "${GREEN}✅ Region=$REGION  S3 bucket=$S3_BUCKET_NAME${NC}"

UTILS_PY="${UTILS_PY:-$SCRIPT_DIR/../../module3/credit-validation/utils.py}"
[ -f "$UTILS_PY" ] || { echo -e "${RED}❌ utils.py not found at $UTILS_PY${NC}"; exit 1; }

echo -e "${YELLOW}Creating ConfigMap loan-buddy-streaming-code...${NC}"
kubectl create configmap loan-buddy-streaming-code -n "$NAMESPACE" \
  --from-file=credit-underwriting-agent-streaming.py="$SCRIPT_DIR/credit-underwriting-agent-streaming.py" \
  --from-file=credit_decision_schema.py="$SCRIPT_DIR/credit_decision_schema.py" \
  --from-file=utils.py="$UTILS_PY" \
  --dry-run=client -o yaml | kubectl apply -f -

echo -e "${YELLOW}Applying loan-buddy-agent-streaming deployment...${NC}"
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: loan-buddy-agent-streaming
  namespace: ${NAMESPACE}
  labels: { app: loan-buddy-agent-streaming }
spec:
  replicas: 1
  selector:
    matchLabels: { app: loan-buddy-agent-streaming }
  template:
    metadata:
      labels: { app: loan-buddy-agent-streaming }
    spec:
      serviceAccountName: loan-buddy-sa
      containers:
      - name: loan-buddy-agent-streaming
        image: public.ecr.aws/agentic-ai-platforms-on-k8s/loan-buddy-example:1.0.4
        imagePullPolicy: IfNotPresent
        workingDir: /app
        command: ["sh","-c"]
        args:
          - |
            # Preserve the image's langchain-core 1.3.2 (MCP + langgraph need
            # >=1.3.1). langchain-aws is pinned to 1.4.6, the newest release whose
            # langchain-core floor (>=1.3.2) the image meets, and installed with
            # --no-deps so pip cannot replace langchain-core. Use MilvusClient
            # (native pymilvus) for retrieval — no langchain-milvus.
            pip install --quiet --no-cache-dir pymilvus && \
            pip install --quiet --no-cache-dir --no-deps "langchain-aws==1.4.6" && \
            pip install --quiet --no-cache-dir "boto3>=1.34" "numpy<2" && \
            cp /code/*.py /app/ && \
            python /app/credit-underwriting-agent-streaming.py
        env:
        - { name: LANGFUSE_URL, value: "http://langfuse-web.langfuse.svc.cluster.local:3000" }
        - { name: LANGFUSE_PUBLIC_KEY, value: "${LANGFUSE_PUBLIC_KEY}" }
        - { name: LANGFUSE_SECRET_KEY, value: "${LANGFUSE_SECRET_KEY}" }
        - { name: GATEWAY_URL, value: "http://litellm.litellm.svc.cluster.local:4000" }
        - { name: GATEWAY_MODEL_ACCESS_KEY, value: "${AGENT_KEY}" }
        - { name: S3_BUCKET_NAME, value: "${S3_BUCKET_NAME}" }
        - { name: AWS_REGION, value: "${REGION}" }
        - { name: MILVUS_URI, value: "http://milvus.milvus.svc.cluster.local:19530" }
        - { name: MCP_ADDRESS_VALIDATOR, value: "http://mcp-address-validator:8000" }
        - { name: MCP_EMPLOYMENT_VALIDATOR, value: "http://mcp-employment-validator:8000" }
        - { name: MCP_IMAGE_PROCESSOR, value: "http://mcp-image-processor:8000" }
        volumeMounts:
        - { name: agent-code, mountPath: /code }
        resources:
          requests: { memory: "8Gi", cpu: "1" }
          limits: { memory: "16Gi", cpu: "2" }
      volumes:
      - name: agent-code
        configMap: { name: loan-buddy-streaming-code }
---
apiVersion: v1
kind: Service
metadata:
  name: loan-buddy-agent-streaming
  namespace: ${NAMESPACE}
spec:
  selector: { app: loan-buddy-agent-streaming }
  ports:
  - { port: 8080, targetPort: 8080 }
EOF

echo -e "${YELLOW}Waiting for rollout...${NC}"
kubectl rollout status deployment/loan-buddy-agent-streaming -n "$NAMESPACE" --timeout=300s

echo -e "${GREEN}✅ Streaming agent deployed.${NC}"
echo -e "   kubectl port-forward svc/loan-buddy-agent-streaming 8082:8080 -n ${NAMESPACE}"
echo -e "   curl --no-buffer -X POST -F \"image_file=@./example1.png\" http://localhost:8082/api/process_credit_application_stream"
