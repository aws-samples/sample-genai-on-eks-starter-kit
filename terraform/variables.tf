variable "name" {
  type    = string
  default = "genai-on-eks"
}
variable "region" {
  type    = string
  default = "us-west-2"
}
variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}
variable "eks_cluster_version" {
  type    = string
  default = "1.34"
}
variable "domain" {
  type    = string
  default = "bursting"
}
variable "efs_throughput_mode" {
  type    = string
  default = ""
}
variable "gpu_nodepool_capacity_type" {
  type    = list(string)
  default = ["spot", "on-demand"]
}

variable "gpu_nodepool_instance_family" {
  type    = list(string)
  default = ["g6e", "g6", "g5g", "p5en", "p5e", "p5", "p4de", "p4d"]
}

variable "enable_nginx" {
  type    = bool
  default = true
}

variable "enable_lws" {
  type    = bool
  default = true
}

variable "enable_ecr_pull_through_cache" {
  description = "Enable ECR pull through cache for Docker Hub and GitHub Container Registry images"
  type        = bool
  default     = false
}

variable "dockerhub_username" {
  description = "Docker Hub username for ECR pull through cache authentication"
  type        = string
  default     = ""
  sensitive   = true
}

variable "dockerhub_access_token" {
  description = "Docker Hub access token for ECR pull through cache authentication"
  type        = string
  default     = ""
  sensitive   = true
}

variable "github_username" {
  description = "GitHub username for GitHub Container Registry pull through cache authentication"
  type        = string
  default     = ""
  sensitive   = true
}

variable "github_token" {
  description = "GitHub Personal Access Token for GitHub Container Registry pull through cache authentication"
  type        = string
  default     = ""
  sensitive   = true
}

locals {
  account_id = data.aws_caller_identity.current.account_id
}

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {}

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.15.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.38.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17.0"
    }
    kubectl = {
      source  = "alekc/kubectl"
      version = "~> 2.1.3"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5.3"
    }
  }
}

provider "aws" { region = var.region }
