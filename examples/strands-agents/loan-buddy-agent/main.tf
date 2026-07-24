variable "region" {
  type    = string
  default = "us-east-1"
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
  app       = "loan-buddy-agent"
  namespace = "strands-agents"
  full_name = "${var.name}-${local.namespace}-${local.app}"
}
resource "aws_ecr_repository" "this" {
  name                 = local.full_name
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

# The Strands Loan Buddy agent reaches Bedrock THROUGH Kong (ai-proxy), so it
# does NOT need Bedrock IAM. It DOES need S3 (to store/read the uploaded loan
# application image, same as the default LangChain agent).
module "pod_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "1.12.0"

  name                 = local.full_name
  use_name_prefix      = false
  attach_custom_policy = true
  policy_statements = [
    {
      sid = "S3"
      actions = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket",
      ]
      resources = ["*"]
    }
  ]
  associations = {
    app = {
      service_account = local.app
      namespace       = local.namespace
      cluster_name    = var.name
    }
  }
}
