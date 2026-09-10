#!/bin/bash
# Build and push the Ray Serve + stock-vLLM (GPU) serving image to public ECR.
# Usage: ./build-and-push.sh [ECR_REGISTRY_ALIAS]   (default: agentic-ai-platforms-on-k8s)
#
# Layers ray[serve] (isolated venv) + vllm_serve.py onto the workshop's own vllm/vllm-openai:v0.10.2,
# so the Ray-served deepseek-r1-qwen3-8b uses the EXACT same vLLM as the fixed GPU deployment (clean
# detokenization). CUDA base is linux/amd64 ONLY.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="ray-vllm-gpu"
TAG="deepseek-r1-qwen3-8b"
ECR_REGISTRY_ALIAS="${1:-jalawala}"

echo "Logging into public ECR..."
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws

if ! aws ecr-public describe-repositories --repository-names "$IMAGE_NAME" --region us-east-1 >/dev/null 2>&1; then
  echo "Creating ECR repository: $IMAGE_NAME"
  aws ecr-public create-repository --repository-name "$IMAGE_NAME" --region us-east-1 >/dev/null
fi

IMAGE="public.ecr.aws/${ECR_REGISTRY_ALIAS}/${IMAGE_NAME}:${TAG}"
echo "Building + pushing (linux/amd64): $IMAGE"
docker buildx build --platform linux/amd64 -t "$IMAGE" --push "$SCRIPT_DIR"

echo "Done: $IMAGE"
