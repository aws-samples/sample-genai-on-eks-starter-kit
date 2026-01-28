# ECR Pull Through Cache Configuration
# This enables caching of external container images from Docker Hub and GitHub Container Registry
# in the user's private ECR registry to avoid rate limits and improve pull performance.

#------------------------------------------------------------------------------
# Secrets Manager - Registry Credentials
#------------------------------------------------------------------------------

# Docker Hub credentials secret
resource "aws_secretsmanager_secret" "dockerhub" {
  count       = var.enable_ecr_pull_through_cache ? 1 : 0
  name        = "ecr-pullthroughcache/dockerhub"
  description = "Docker Hub credentials for ECR pull through cache"
}

resource "aws_secretsmanager_secret_version" "dockerhub" {
  count     = var.enable_ecr_pull_through_cache ? 1 : 0
  secret_id = aws_secretsmanager_secret.dockerhub[0].id
  secret_string = jsonencode({
    username    = var.dockerhub_username
    accessToken = var.dockerhub_access_token
  })
}

# GitHub Container Registry credentials secret
resource "aws_secretsmanager_secret" "github" {
  count       = var.enable_ecr_pull_through_cache ? 1 : 0
  name        = "ecr-pullthroughcache/github"
  description = "GitHub Container Registry credentials for ECR pull through cache"
}

resource "aws_secretsmanager_secret_version" "github" {
  count     = var.enable_ecr_pull_through_cache ? 1 : 0
  secret_id = aws_secretsmanager_secret.github[0].id
  secret_string = jsonencode({
    username    = var.github_username
    accessToken = var.github_token
  })
}

#------------------------------------------------------------------------------
# Pull Through Cache Rules - Docker Hub
#------------------------------------------------------------------------------

# Docker Hub - All Docker Hub images (vllm/*, lmsysorg/*, ollama/*, etc.)
# Pull format: {account}.dkr.ecr.{region}.amazonaws.com/docker-hub/namespace/image:tag
resource "aws_ecr_pull_through_cache_rule" "docker_hub" {
  count                 = var.enable_ecr_pull_through_cache ? 1 : 0
  ecr_repository_prefix = "docker-hub"
  upstream_registry_url = "registry-1.docker.io"
  credential_arn        = aws_secretsmanager_secret.dockerhub[0].arn
}

#------------------------------------------------------------------------------
# Pull Through Cache Rules - GitHub Container Registry
#------------------------------------------------------------------------------

# GitHub Container Registry - All GHCR images (huggingface/*, etc.)
# Pull format: {account}.dkr.ecr.{region}.amazonaws.com/github/namespace/image:tag
resource "aws_ecr_pull_through_cache_rule" "github" {
  count                 = var.enable_ecr_pull_through_cache ? 1 : 0
  ecr_repository_prefix = "github"
  upstream_registry_url = "ghcr.io"
  credential_arn        = aws_secretsmanager_secret.github[0].arn
}

#------------------------------------------------------------------------------
# Outputs for CLI usage
#------------------------------------------------------------------------------

output "account_id" {
  description = "AWS Account ID"
  value       = local.account_id
}

output "region" {
  description = "AWS Region"
  value       = var.region
}

output "enable_ecr_pull_through_cache" {
  description = "Whether ECR pull through cache is enabled"
  value       = var.enable_ecr_pull_through_cache
}

output "ecr_registry_url" {
  description = "ECR registry URL prefix for pull through cache"
  value       = var.enable_ecr_pull_through_cache ? "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com" : ""
}
