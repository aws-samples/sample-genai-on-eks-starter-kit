variable "region" {
  type    = string
  default = "us-west-2"
}
variable "name" {
  type    = string
  default = "genai-on-eks"
}
variable "repo_name" {
  type    = string
  default = "calculator-agent"
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
resource "aws_ecr_repository" "this" {
  name                 = "${var.name}-${var.repo_name}"
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
  source = "terraform-aws-modules/eks-pod-identity/aws"
  version = "1.12.0"

  name                 = "${var.name}-${var.region}-calculator-agent"
  use_name_prefix      = false
  attach_custom_policy = true
  policy_statements = [
    {
      sid = "Bedrock"
      actions = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ]
      resources = ["*"]
    }
  ]
  associations = {
    litellm = {
      service_account = "calculator-agent"
      namespace       = "strands-agents"
      cluster_name    = var.name
    }
  }
}