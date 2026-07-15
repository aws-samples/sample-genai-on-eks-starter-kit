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

data "aws_caller_identity" "current" {}
data "aws_eks_cluster" "this" {
  name = var.name
}

# ─── Amazon Managed Prometheus ───────────────────────────────────
resource "aws_prometheus_workspace" "this" {
  alias = "${var.name}-amp"
  tags = {
    Component = "amp-amg"
    Project   = var.name
  }
}

# ─── IAM Role for ADOT Collector (remote-write to AMP) ──────────
resource "aws_iam_role" "adot_collector" {
  name = "${var.name}-${var.region}-adot-collector"
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

resource "aws_iam_role_policy" "adot_amp_write" {
  role = aws_iam_role.adot_collector.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "aps:RemoteWrite",
          "aps:GetSeries",
          "aps:GetLabels",
          "aps:GetMetricMetadata"
        ]
        Resource = aws_prometheus_workspace.this.arn
      }
    ]
  })
}

resource "aws_eks_pod_identity_association" "adot_collector" {
  cluster_name    = var.name
  namespace       = "opentelemetry"
  service_account = "adot-collector"
  role_arn        = aws_iam_role.adot_collector.arn
}

# ─── IAM Role for Amazon Managed Grafana ─────────────────────────
resource "aws_iam_role" "amg" {
  name = "${var.name}-${var.region}-amg-service"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "grafana.amazonaws.com"
      }
      Action = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = data.aws_caller_identity.current.account_id
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "amg_amp_read" {
  role = aws_iam_role.amg.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "aps:QueryMetrics",
          "aps:GetSeries",
          "aps:GetLabels",
          "aps:GetMetricMetadata",
          "aps:ListWorkspaces",
          "aps:DescribeWorkspace"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_grafana_workspace" "this" {
  name                     = "${var.name}-amg"
  account_access_type      = "CURRENT_ACCOUNT"
  authentication_providers = ["AWS_SSO"]
  permission_type          = "SERVICE_MANAGED"
  role_arn                 = aws_iam_role.amg.arn
  data_sources             = ["PROMETHEUS"]

  tags = {
    Component = "amp-amg"
    Project   = var.name
  }
}

# ─── Outputs ─────────────────────────────────────────────────────
output "amp_workspace_id" {
  value = aws_prometheus_workspace.this.id
}

output "amp_remote_write_endpoint" {
  value = "${aws_prometheus_workspace.this.prometheus_endpoint}api/v1/remote_write"
}

output "amp_query_endpoint" {
  value = aws_prometheus_workspace.this.prometheus_endpoint
}

output "amg_workspace_id" {
  value = aws_grafana_workspace.this.id
}

output "amg_endpoint" {
  value = "https://${aws_grafana_workspace.this.endpoint}"
}

output "adot_role_arn" {
  value = aws_iam_role.adot_collector.arn
}
