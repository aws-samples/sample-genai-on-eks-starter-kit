#!/bin/bash

# ECR Image Sync Script
# Usage: ./ecr-image-sync.sh

set -e

# List of images to sync (add your images here)
IMAGES=(
    "bitnamilegacy/redis:8.2.1-debian-12-r0"
    "bitnamilegacy/postgresql:17.5.0-debian-12-r8"
    "bitnamilegacy/clickhouse:25.2.1-debian-12-r0"
    "bitnamilegacy/valkey:8.0.2-debian-12-r2"
    "bitnamilegacy/zookeeper:3.9.3-debian-12-r8"
    "bitnamilegacy/minio:2024.12.18-debian-12-r1"
)

# Prompt for AWS configuration
read -p "Enter AWS Region: " AWS_REGION
read -p "Enter AWS Account ID: " AWS_ACCOUNT_ID
read -p "Enter Public ECR Registry Alias: " ECR_REGISTRY_ALIAS

echo "Configuration:"
echo "  AWS Region: $AWS_REGION"
echo "  AWS Account ID: $AWS_ACCOUNT_ID"
echo "  ECR Registry Alias: $ECR_REGISTRY_ALIAS"
echo ""

# Login to public ECR (always uses us-east-1 for public ECR)
echo "Logging into public ECR..."
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws

# Function to process each image
process_image() {
    local image=$1
    local repo_name=$(echo $image | cut -d':' -f1 | sed 's/.*\///')
    local tag=$(echo $image | cut -d':' -f2)
    
    echo "Processing: $image"
    echo "  Repository: $repo_name"
    echo "  Tag: $tag"
    
    # Check if ECR repository exists, create if not
    if ! aws ecr-public describe-repositories --repository-names $repo_name --region us-east-1 2>/dev/null; then
        echo "  Creating ECR repository: $repo_name"
        aws ecr-public create-repository --repository-name $repo_name --region us-east-1
    else
        echo "  ECR repository exists: $repo_name"
    fi
    
    # Pull source image
    echo "  Pulling source image: $image"
    docker pull $image
    
    # Tag for ECR
    local ecr_image="public.ecr.aws/$ECR_REGISTRY_ALIAS/$repo_name:$tag"
    echo "  Tagging as: $ecr_image"
    docker tag $image $ecr_image
    
    # Push to ECR
    echo "  Pushing to ECR: $ecr_image"
    docker push $ecr_image
    
    echo "  ✓ Completed: $image"
    echo ""
}

# Process all images in the list
echo "Processing ${#IMAGES[@]} images..."
echo ""

for image in "${IMAGES[@]}"; do
    process_image "$image"
done

echo "All images processed successfully!"
