#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# Deploy Loan Buddy v2 (RAG-enhanced) onto the existing workshop platform.
#
# Strategy: NO new container image. We reuse the Module 3 image
# (loan-buddy-example:1.0.4) which already contains Python + langchain +
# langgraph + langfuse + boto3, mount the v2 agent code from a ConfigMap, and
# pip-install the extra RAG dependencies (langchain-aws, pymilvus) at container
# start. The MCP servers from Module 3 are reused as-is.
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
NAMESPACE="workshop"

echo -e "${BLUE}=== Deploy Loan Buddy v2 (RAG-enhanced) ===${NC}"

# --- Resolve config from environment / .env (REGION, S3 bucket, keys) ----------
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
  # The Module 3 loan-buddy-agent already has the bucket wired in — reuse it.
  S3_BUCKET_NAME=$(kubectl get deployment loan-buddy-agent -n "$NAMESPACE" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="S3_BUCKET_NAME")].value}' 2>/dev/null || true)
fi
if [ -z "${S3_BUCKET_NAME:-}" ]; then
  echo -e "${RED}❌ S3_BUCKET_NAME not set and could not be read from loan-buddy-agent.${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Region=$REGION  S3 bucket=$S3_BUCKET_NAME${NC}"

# --- Build the ConfigMap from the agent code + Module 3 utils.py ---------------
UTILS_PY="${UTILS_PY:-$SCRIPT_DIR/../../module3/credit-validation/utils.py}"
if [ ! -f "$UTILS_PY" ]; then
  echo -e "${RED}❌ utils.py not found at $UTILS_PY (needed for S3 helpers).${NC}"
  exit 1
fi

echo -e "${YELLOW}Creating ConfigMap loan-buddy-v2-code...${NC}"
kubectl create configmap loan-buddy-v2-code -n "$NAMESPACE" \
  --from-file=credit-underwriting-agent-v2.py="$SCRIPT_DIR/credit-underwriting-agent-v2.py" \
  --from-file=utils.py="$UTILS_PY" \
  --dry-run=client -o yaml | kubectl apply -f -

# --- Deploy the v2 agent -------------------------------------------------------
echo -e "${YELLOW}Applying loan-buddy-agent-v2 deployment...${NC}"
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: loan-buddy-agent-v2
  namespace: ${NAMESPACE}
  labels: { app: loan-buddy-agent-v2 }
spec:
  replicas: 1
  selector:
    matchLabels: { app: loan-buddy-agent-v2 }
  template:
    metadata:
      labels: { app: loan-buddy-agent-v2 }
    spec:
      serviceAccountName: loan-buddy-sa
      containers:
      - name: loan-buddy-agent-v2
        image: public.ecr.aws/agentic-ai-platforms-on-k8s/loan-buddy-example:1.0.4
        imagePullPolicy: IfNotPresent
        workingDir: /app
        command: ["sh","-c"]
        args:
          - |
            # Install RAG deps WITHOUT disturbing the image's langchain stack.
            # Keep the image's langchain-core (1.3.2): the MCP adapters + langgraph
            # need >=1.3.1. langchain-aws is pinned to 1.4.6, the newest release
            # whose langchain-core floor (>=1.3.2) the image meets (1.4.7 and later
            # need >=1.4.0), and is installed with --no-deps so pip cannot replace
            # langchain-core. Only the small runtime deps Bedrock embeddings use follow.
            pip install --quiet --no-cache-dir pymilvus && \
            pip install --quiet --no-cache-dir --no-deps "langchain-aws==1.4.6" && \
            pip install --quiet --no-cache-dir "boto3>=1.34" "numpy<2" && \
            cp /code/credit-underwriting-agent-v2.py /app/ && \
            cp /code/utils.py /app/ && \
            python /app/credit-underwriting-agent-v2.py
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
        configMap: { name: loan-buddy-v2-code }
---
apiVersion: v1
kind: Service
metadata:
  name: loan-buddy-agent-v2
  namespace: ${NAMESPACE}
spec:
  selector: { app: loan-buddy-agent-v2 }
  ports:
  - { port: 8080, targetPort: 8080 }
EOF

echo -e "${YELLOW}Waiting for rollout (pip install adds ~30-60s to first start)...${NC}"
kubectl rollout status deployment/loan-buddy-agent-v2 -n "$NAMESPACE" --timeout=300s

echo -e "${GREEN}✅ Loan Buddy v2 (RAG) deployed.${NC}"
echo -e "   Test: kubectl port-forward svc/loan-buddy-agent-v2 8081:8080 -n ${NAMESPACE}"
echo -e "         curl -X POST -F \"image_file=@./example1.png\" http://localhost:8081/api/process_credit_application_with_upload"
