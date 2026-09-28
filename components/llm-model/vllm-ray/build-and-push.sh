#!/bin/bash
# Build and push the Ray Serve + stock-vLLM (GPU) serving image to public ECR.
# Usage: ./build-and-push.sh [ECR_REGISTRY_ALIAS] [TAG]
#   ECR_REGISTRY_ALIAS  default: jalawala          (testing; workshop publishes to its own alias)
#   TAG                 default: deepseek-r1-qwen3-8b
# Examples:
#   ./build-and-push.sh                                   # jalawala / deepseek-r1-qwen3-8b
#   ./build-and-push.sh jalawala deepseek-r1-qwen3-8b-v2  # push a test tag, leaving the
#                                                         # currently-referenced tag untouched
#
# Layers ray[serve] (isolated venv) + the Serve apps onto the workshop's own
# vllm/vllm-openai:v0.10.2, so the Ray-served deepseek-r1-qwen3-8b uses the EXACT same vLLM as
# the fixed GPU deployment (clean detokenization). CUDA base is linux/amd64 ONLY.
#
# Apps baked in (select one per service via import_path):
#   vllm_serve:app   single GPU deployment, whole L4        (ray-serve-autoscaling)
#   compose_app:app  CPU gateway+guard -> GPU model         (ray-serve-composition)
#   pack_app:app     two small models sharing one L4        (ray-gpu-packing)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="ray-vllm-gpu"
# Alias resolution order: positional arg -> $ECR_PUBLIC_ALIAS -> jalawala (test default).
# Set ECR_PUBLIC_ALIAS to publish under the workshop's own alias without editing this file.
ECR_REGISTRY_ALIAS="${1:-${ECR_PUBLIC_ALIAS:-jalawala}}"
TAG="${2:-deepseek-r1-qwen3-8b}"

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
