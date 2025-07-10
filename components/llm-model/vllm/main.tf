variable "region" {
  type    = string
  default = "us-west-2"
}
variable "name" {
  type    = string
  default = "genai-on-eks"
}
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.96.0"
    }
  }
}
provider "aws" {
  region = var.region
}
locals {
  name = "vllm-neuron"
}
resource "aws_ecr_repository" "this" {
  name                 = "${var.name}-${local.name}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
  }
}
output "ecr_repository_url" {
  value = aws_ecr_repository.this.repository_url
}

module "pod_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "1.12.0"

  name                 = "${var.name}-${var.region}-vllm-neuron-build"
  use_name_prefix      = false
  attach_custom_policy = true
  policy_statements = [
    {
      actions = [
        "ecr:GetAuthorizationToken",
      ]
      resources = ["*"]
    },
    {
      actions = [
        "ecr:CompleteLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:InitiateLayerUpload",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:BatchGetImage"
      ]
      resources = [aws_ecr_repository.this.arn]
    }
  ]
  associations = {
    litellm = {
      service_account = "vllm-neuron-build"
      namespace       = "vllm"
      cluster_name    = var.name
    }
  }
}
