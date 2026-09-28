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
# "reserved" lets Karpenter launch GPU nodes into an On-Demand Capacity
# Reservation attached to NodeClass/gpu (see eks-addons.tf). Karpenter prices
# reserved offerings at zero, so it prefers them whenever a matching reservation
# has room; with no reservation attached, selection is unchanged from before.
# Set to ["reserved", "on-demand"] for events that must not be interrupted.
variable "gpu_nodepool_capacity_type" {
  type    = list(string)
  default = ["reserved", "spot", "on-demand"]
}

# Kept deliberately broad so a workload can choose its GPU by pod nodeSelector
# (node.kubernetes.io/instance-type) without needing a starter-kit change.
#
# Full NVIDIA G-series g5 through g7, including the "e" and "f" variants, so
# newer models that require current-generation GPUs can run without editing this
# list. GPU per family (from ec2:DescribeInstanceTypes):
#   g5   A10G   | g5g  T4g               | g6  L4    | g6e L40S
#   g6f  L4     | gr6 / gr6f  L4         | g7  RTX PRO 4500
#   g7e  RTX PRO 6000 (96 GB, SM120)
# Note g7/g7e have no .xlarge shape - the smallest are g7.2xlarge / g7e.2xlarge -
# and sizing does not carry across families: g7e.12xlarge is 2x GPU while
# g6e.12xlarge is 4x.
variable "gpu_nodepool_instance_family" {
  type = list(string)
  default = [
    "g7e", "g7",                       # RTX PRO 6000 / 4500
    "g6e", "g6f", "g6", "gr6f", "gr6", # L40S / L4
    "g5g", "g5",                       # T4g / A10G
    "p5en", "p5e", "p5", "p4de", "p4d",
  ]
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
