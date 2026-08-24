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
# NOTE: No per-participant ECR repo. The agent image is pre-built multi-arch and
# published to the shared public registry (public.ecr.aws/agentic-ai-platforms-on-k8s),
# then pulled at deploy time — matching the calculator-agent / calculator examples.
# This terraform now only provisions the S3 Pod Identity the agent needs.

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
