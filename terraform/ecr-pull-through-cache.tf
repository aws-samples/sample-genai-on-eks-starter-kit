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
# Pull Through Cache Rules - Docker Hub Namespaces
#------------------------------------------------------------------------------

# vLLM - LLM inference engine
resource "aws_ecr_pull_through_cache_rule" "vllm" {
  count                 = var.enable_ecr_pull_through_cache ? 1 : 0
  ecr_repository_prefix = "vllm"
  upstream_registry_url = "registry-1.docker.io"
  credential_arn        = aws_secretsmanager_secret.dockerhub[0].arn
}

# LMSys - SGLang inference engine
resource "aws_ecr_pull_through_cache_rule" "lmsysorg" {
  count                 = var.enable_ecr_pull_through_cache ? 1 : 0
  ecr_repository_prefix = "lmsysorg"
  upstream_registry_url = "registry-1.docker.io"
  credential_arn        = aws_secretsmanager_secret.dockerhub[0].arn
}

# Ollama - Local LLM runtime
resource "aws_ecr_pull_through_cache_rule" "ollama" {
  count                 = var.enable_ecr_pull_through_cache ? 1 : 0
  ecr_repository_prefix = "ollama"
  upstream_registry_url = "registry-1.docker.io"
  credential_arn        = aws_secretsmanager_secret.dockerhub[0].arn
}

#------------------------------------------------------------------------------
# Pull Through Cache Rules - GitHub Container Registry Namespaces
#------------------------------------------------------------------------------

# Hugging Face - TGI and TEI inference engines
resource "aws_ecr_pull_through_cache_rule" "huggingface" {
  count                 = var.enable_ecr_pull_through_cache ? 1 : 0
  ecr_repository_prefix = "huggingface"
  upstream_registry_url = "ghcr.io"
  credential_arn        = aws_secretsmanager_secret.github[0].arn
}
