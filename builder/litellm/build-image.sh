#!/bin/bash
set -e

# Build and push multi-arch image to public ECR
# Usage: ./build-image.sh [version]

PUBLIC_ECR_REGISTRY="public.ecr.aws/agentic-ai-platforms-on-k8s"
COMPONENT="litellm"
VERSION=${1:-"latest"}

echo "Building multi-arch image for component: ${COMPONENT}"
echo "Version: ${VERSION}"
echo "Registry: ${PUBLIC_ECR_REGISTRY}"

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Authenticate to public ECR (public ECR requires us-east-1 region)
echo "Authenticating to public ECR..."
aws ecr-public get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin public.ecr.aws

# Check if Dockerfile exists
if [ ! -f "${SCRIPT_DIR}/Dockerfile" ]; then
    echo "Error: Dockerfile not found in ${SCRIPT_DIR}"
    exit 1
fi

# Build and push multi-arch image
echo "Building and pushing multi-arch image..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ${PUBLIC_ECR_REGISTRY}/${COMPONENT}:${VERSION} \
  -t ${PUBLIC_ECR_REGISTRY}/${COMPONENT}:latest \
  --push \
  ${SCRIPT_DIR}/

echo "Successfully built and pushed ${PUBLIC_ECR_REGISTRY}/${COMPONENT}:${VERSION}"
echo "Also tagged as: ${PUBLIC_ECR_REGISTRY}/${COMPONENT}:latest"
