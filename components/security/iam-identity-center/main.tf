terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "region" {
  type = string
}

variable "name" {
  type = string
}

variable "domain" {
  type    = string
  default = ""
}

variable "identity_center_region" {
  type    = string
  default = "us-east-1"
}

provider "aws" {
  region = var.region
}

provider "aws" {
  alias  = "identity_center"
  region = var.identity_center_region
}

# Look up the IAM Identity Center instance (always in identity_center_region)
data "aws_ssoadmin_instances" "this" {
  provider = aws.identity_center
}

locals {
  identity_store_arn = tolist(data.aws_ssoadmin_instances.this.arns)[0]
  instance_id        = tolist(data.aws_ssoadmin_instances.this.identity_store_ids)[0]
  callback_url       = var.domain != "" ? "https://openwebui.${var.domain}/oauth/oidc/callback" : "http://localhost:8080/oauth/oidc/callback"
}

# Create OIDC Application in IAM Identity Center
resource "aws_ssoadmin_application" "openwebui" {
  provider                 = aws.identity_center
  name                     = "${var.name}-openwebui"
  application_provider_arn = "arn:aws:sso::aws:applicationProvider/custom"
  instance_arn             = local.identity_store_arn

  portal_options {
    visibility = "ENABLED"
    sign_in_options {
      application_url = local.callback_url
      origin          = "APPLICATION"
    }
  }
}

# Register OIDC client credentials (client_id + client_secret)
resource "null_resource" "oidc_credentials" {
  triggers = {
    app_id = aws_ssoadmin_application.openwebui.id
  }

  provisioner "local-exec" {
    command = <<-EOT
      aws sso-oidc register-client \
        --client-name "${var.name}-openwebui-oidc" \
        --client-type public \
        --region ${var.identity_center_region} \
        --output json > ${path.module}/oidc-credentials.json
    EOT
  }
}

data "local_file" "oidc_credentials" {
  depends_on = [null_resource.oidc_credentials]
  filename   = "${path.module}/oidc-credentials.json"
}

locals {
  oidc_creds = jsondecode(data.local_file.oidc_credentials.content)
}

# Create groups for RBAC
resource "aws_identitystore_group" "senior_dev" {
  provider          = aws.identity_center
  identity_store_id = local.instance_id
  display_name      = "senior-dev"
  description       = "Senior developers - access to all models"
}

resource "aws_identitystore_group" "junior_dev" {
  provider          = aws.identity_center
  identity_store_id = local.instance_id
  display_name      = "junior-dev"
  description       = "Junior developers - access to limited models"
}

output "oidc_application_arn" {
  value = aws_ssoadmin_application.openwebui.application_arn
}

output "oidc_client_id" {
  value = local.oidc_creds.clientId
}

output "oidc_client_secret" {
  value     = local.oidc_creds.clientSecret
  sensitive = true
}

output "oidc_issuer_url" {
  value = "https://portal.sso.${var.identity_center_region}.amazonaws.com"
}

output "senior_dev_group_id" {
  value = aws_identitystore_group.senior_dev.group_id
}

output "junior_dev_group_id" {
  value = aws_identitystore_group.junior_dev.group_id
}
