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
      source = "hashicorp/aws"
      # NFM resources (aws_networkflowmonitor_scope / _monitor) were added in the
      # AWS provider 6.x line, so this module pins 6.x. Isolated to this module —
      # other components keep their own ~> 5.96 pin.
      version = ">= 6.0"
    }
  }
}
provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}

# NFM Scope — the Region/account pair to monitor.
resource "aws_networkflowmonitor_scope" "this" {
  target {
    region = var.region
    target_identifier {
      target_type = "ACCOUNT"
      target_id {
        account_id = data.aws_caller_identity.current.account_id
      }
    }
  }
  tags = {
    Name = "${var.name}-nfm-scope"
  }
}

# NFM Monitor — scoped to the EKS cluster so the console service map / flow
# table are populated for this cluster's workloads.
resource "aws_networkflowmonitor_monitor" "this" {
  monitor_name = "${var.name}-nfm"
  scope_arn    = aws_networkflowmonitor_scope.this.scope_arn

  local_resource {
    type       = "AWS::EKS::Cluster"
    identifier = "arn:aws:eks:${var.region}:${data.aws_caller_identity.current.account_id}:cluster/${var.name}"
  }

  tags = {
    Name = "${var.name}-nfm"
  }
}

# IAM role for the NFM agent add-on, assumed via EKS Pod Identity. The AWS
# managed policy grants permission to publish telemetry to the NFM backend.
resource "aws_iam_role" "nfm_agent" {
  name = "${var.name}-${var.region}-nfm-agent"
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

resource "aws_iam_role_policy_attachment" "nfm_agent" {
  role       = aws_iam_role.nfm_agent.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchNetworkFlowMonitorAgentPublishPolicy"
}

# NOTE: the Pod Identity association is intentionally NOT created here. The
# `aws eks create-addon --pod-identity-associations ...` call in index.mjs
# creates it as part of installing the add-on (SA
# aws-network-flow-monitor-agent-service-account in ns
# amazon-network-flow-monitor). Creating it here too would conflict.

# --- Workload Insights exporter -------------------------------------------
# Reads the NFM Workload Insights top-contributor queries (AZ/VPC/subnet
# granularity that the agent's OpenMetrics endpoint doesn't expose) and
# re-publishes them as Prometheus metrics for the Grafana traffic/cost panels.

resource "aws_iam_role" "nfm_wi_exporter" {
  name = "${var.name}-${var.region}-nfm-wi-exporter"
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

resource "aws_iam_role_policy" "nfm_wi_exporter" {
  name = "workload-insights-read"
  role = aws_iam_role.nfm_wi_exporter.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "networkflowmonitor:ListScopes",
        "networkflowmonitor:GetScope",
        "networkflowmonitor:StartQueryWorkloadInsightsTopContributors",
        "networkflowmonitor:StartQueryWorkloadInsightsTopContributorsData",
        "networkflowmonitor:GetQueryStatusWorkloadInsightsTopContributors",
        "networkflowmonitor:GetQueryStatusWorkloadInsightsTopContributorsData",
        "networkflowmonitor:GetQueryResultsWorkloadInsightsTopContributors",
        "networkflowmonitor:GetQueryResultsWorkloadInsightsTopContributorsData",
        "networkflowmonitor:StopQueryWorkloadInsightsTopContributors",
        "networkflowmonitor:StopQueryWorkloadInsightsTopContributorsData"
      ]
      Resource = "*"
    }]
  })
}

# Unlike the agent add-on (whose association is created by create-addon), the
# exporter is a plain Deployment, so its Pod Identity association lives here.
resource "aws_eks_pod_identity_association" "nfm_wi_exporter" {
  cluster_name    = var.name
  namespace       = "amazon-network-flow-monitor"
  service_account = "nfm-wi-exporter-sa"
  role_arn        = aws_iam_role.nfm_wi_exporter.arn
}

output "nfm_monitor_name" {
  value = aws_networkflowmonitor_monitor.this.monitor_name
}
output "nfm_agent_role_arn" {
  value = aws_iam_role.nfm_agent.arn
}
