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
  app       = "devops-agent"
  namespace = "openclaw"
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
