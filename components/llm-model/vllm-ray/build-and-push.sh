#!/bin/bash
# Build and push the Ray Serve + vLLM serving image to public ECR.
# Usage: ./build-and-push.sh [ECR_REGISTRY_ALIAS]   (default alias: prompted)
#
# CUDA image => linux/amd64 ONLY (no arm64 CUDA base). Do not add arm64.
# Maintainers publish to the official registry; for testing you can push to your own alias.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="ray-vllm"
TAG="2.56.1-vllm-qwen3"

ECR_REGISTRY_ALIAS="${1:-}"
if [ -z "$ECR_REGISTRY_ALIAS" ]; then
  read -p "Enter Public ECR Registry Alias (e.g. your alias, or the official one): " ECR_REGISTRY_ALIAS
fi

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
