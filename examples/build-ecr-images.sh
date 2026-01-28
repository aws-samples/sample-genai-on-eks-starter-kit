#!/bin/bash

# Build and Push Example Images to ECR
# Usage: ./build-ecr-images.sh
#
# This script builds the example application images and pushes them to public ECR.
# Run this script before demo-setup to pre-build images and save time during deployment.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Example images to build (relative path from examples dir, image name)
EXAMPLES=(
    "mcp-server/calculator:mcp-server-calculator"
    "strands-agents/calculator-agent:strands-agents-calculator-agent"
    "agno/calculator-agent:agno-calculator-agent"
)

# Prompt for AWS configuration
read -p "Enter Public ECR Registry Alias: " ECR_REGISTRY_ALIAS

echo ""
echo "Configuration:"
echo "  ECR Registry Alias: $ECR_REGISTRY_ALIAS"
echo "  Examples to build: ${#EXAMPLES[@]}"
echo ""

# Login to public ECR (always uses us-east-1 for public ECR)
echo "Logging into public ECR..."
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws

# Create buildx builder if it doesn't exist
BUILDER_NAME="ecr-multiarch-builder"
if ! docker buildx inspect $BUILDER_NAME > /dev/null 2>&1; then
    echo "Creating buildx builder: $BUILDER_NAME"
    docker buildx create --name $BUILDER_NAME --use --bootstrap
else
    echo "Using existing buildx builder: $BUILDER_NAME"
    docker buildx use $BUILDER_NAME
fi

# Function to build and push each example image
build_and_push_image() {
    local example_info=$1
    local example_path=$(echo $example_info | cut -d':' -f1)
    local image_name=$(echo $example_info | cut -d':' -f2)
    local build_context="$SCRIPT_DIR/$example_path"
    
    echo "=========================================="
    echo "Building: $image_name"
    echo "  Context: $build_context"
    echo "=========================================="
    
    # Check if Dockerfile exists
    if [ ! -f "$build_context/Dockerfile" ]; then
        echo "  ❌ Error: Dockerfile not found at $build_context/Dockerfile"
        return 1
    fi
    
    # Check if ECR repository exists, create if not
    if ! aws ecr-public describe-repositories --repository-names $image_name --region us-east-1 2>/dev/null; then
        echo "  Creating ECR repository: $image_name"
        aws ecr-public create-repository --repository-name $image_name --region us-east-1
    else
        echo "  ECR repository exists: $image_name"
    fi
    
    # Build and push multi-arch image
    local ecr_image="public.ecr.aws/$ECR_REGISTRY_ALIAS/$image_name:latest"
    echo "  Building and pushing multi-arch image to: $ecr_image"
    
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        --tag $ecr_image \
        --push \
        $build_context
    
    echo "  ✓ Completed: $image_name"
    echo ""
}

# Build and push all example images
echo ""
echo "Building ${#EXAMPLES[@]} example images..."
echo ""

for example in "${EXAMPLES[@]}"; do
    build_and_push_image "$example"
done

echo "=========================================="
echo "All example images built and pushed successfully!"
echo ""
echo "Images available at:"
for example in "${EXAMPLES[@]}"; do
    image_name=$(echo $example | cut -d':' -f2)
    echo "  - public.ecr.aws/$ECR_REGISTRY_ALIAS/$image_name:latest"
done
echo "=========================================="