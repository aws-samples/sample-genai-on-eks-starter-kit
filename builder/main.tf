variable "region" {
  type    = string
  default = "us-east-2"
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
  app       = "calculator-agent"
  namespace = "strands-agents"
  full_name = "${var.name}-${local.namespace}-${local.app}"
}
module "pod_identity_vllm_buildah" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "1.12.0"

  name                 = "${var.name}-vllm-buildah"
  use_name_prefix      = false
  attach_custom_policy = true
  policy_statements = [
    {
      sid = "ECR"
      actions = [
        "ecr:CompleteLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:InitiateLayerUpload",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:BatchGetImage",
        "ecr:GetAuthorizationToken",
        "ecr-public:PutImage",
        "ecr-public:UploadLayerPart",
        "ecr-public:InitiateLayerUpload",
        "ecr-public:CompleteLayerUpload",
        "ecr-public:BatchCheckLayerAvailability",
        "ecr-public:BatchGetImage",
        "ecr-public:GetAuthorizationToken"
      ]
      resources = ["*"]
    }
  ]
  associations = {
    app = {
      service_account = "buildah"
      namespace       = "vllm"
      cluster_name    = var.name
    }
  }
}

provider "aws" {
  region = "us-east-1"
  alias  = "virginia"
}

resource "aws_ecrpublic_repository" "vllm_neuron" {
  provider        = aws.virginia
  repository_name = "vllm-neuron"
  catalog_data {
    architectures     = ["x86"]
    operating_systems = ["Linux"]
  }
}