# ECR Pull Through Cache Configuration
# This enables caching of external container images from Docker Hub and GitHub Container Registry
# in the user's private ECR registry to avoid rate limits and improve pull performance.

#------------------------------------------------------------------------------
# Pull Through Cache Rules - Docker Hub Namespaces
#------------------------------------------------------------------------------

# vLLM - LLM inference engine
resource "aws_ecr_pull_through_cache_rule" "vllm" {
  count                 = var.enable_ecr_pull_through_cache ? 1 : 0
  ecr_repository_prefix = "vllm"
  upstream_registry_url = "registry-1.docker.io"
}

# LMSys - SGLang inference engine
resource "aws_ecr_pull_through_cache_rule" "lmsysorg" {
  count                 = var.enable_ecr_pull_through_cache ? 1 : 0
  ecr_repository_prefix = "lmsysorg"
  upstream_registry_url = "registry-1.docker.io"
}

# Ollama - Local LLM runtime
resource "aws_ecr_pull_through_cache_rule" "ollama" {
  count                 = var.enable_ecr_pull_through_cache ? 1 : 0
  ecr_repository_prefix = "ollama"
  upstream_registry_url = "registry-1.docker.io"
}

#------------------------------------------------------------------------------
# Pull Through Cache Rules - GitHub Container Registry Namespaces
#------------------------------------------------------------------------------

# Hugging Face - TGI and TEI inference engines
resource "aws_ecr_pull_through_cache_rule" "huggingface" {
  count                 = var.enable_ecr_pull_through_cache ? 1 : 0
  ecr_repository_prefix = "huggingface"
  upstream_registry_url = "ghcr.io"
}
