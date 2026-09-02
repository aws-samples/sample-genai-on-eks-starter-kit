#!/bin/bash
# Build and push the Ray Serve + vLLM-Neuron (inf2) serving image to public ECR.
# Usage: ./build-and-push.sh [ECR_REGISTRY_ALIAS]   (default alias: prompted)
#
# The Neuron base image (public.ecr.aws/agentic-ai-platforms-on-k8s/vllm-neuron:qwen3-8b-optimum-neuron)
# is linux/amd64 ONLY (inf2 hosts are amd64; there is no arm64 Neuron base). Do not add arm64.
# This image just layers ray[serve] onto the workshop's own inf2 vLLM image so the Ray-served model
# uses the EXACT same Neuron SDK / vLLM / driver-compat as the fixed vllm/qwen3-8b-neuron deployment.
# Maintainers publish to the official registry; for testing you can push to your own alias.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="ray-vllm-neuron"
# Must match the tag referenced by the RayService manifest + the Track A doc.
# We use :latest (same convention as the mcp/agent example images), not a versioned tag.
TAG="latest"

# Publishes to the official workshop registry by default (same alias as vllm-neuron, litellm,
# guardrails-ai, and the mcp/agent example images). Override with an arg for personal testing:
#   ./build-and-push.sh my-test-alias
ECR_REGISTRY_ALIAS="${1:-agentic-ai-platforms-on-k8s}"

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
