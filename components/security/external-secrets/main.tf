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

# ─── IAM Role for External Secrets Operator ──────────────────────
resource "aws_iam_role" "external_secrets" {
  name = "${var.name}-${var.region}-external-secrets"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "pods.eks.amazonaws.com"
      }
      Action = ["sts:AssumeRole", "sts:TagSession"]
    }]
  })
}

resource "aws_iam_role_policy" "external_secrets_sm" {
  role = aws_iam_role.external_secrets.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
          "secretsmanager:ListSecrets"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_eks_pod_identity_association" "external_secrets" {
  cluster_name    = var.name
  namespace       = "external-secrets"
  service_account = "external-secrets"
  role_arn        = aws_iam_role.external_secrets.arn
}

# ─── Outputs ─────────────────────────────────────────────────────
output "eso_role_arn" {
  value = aws_iam_role.external_secrets.arn
}
