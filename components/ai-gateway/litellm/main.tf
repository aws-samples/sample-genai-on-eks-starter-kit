variable "region" {
  type    = string
  default = "us-west-2"
}
variable "bedrock_region" {
  type    = string
  default = "us-west-2"
}
variable "name" {
  type    = string
  default = "genai-on-eks"
}
variable "enable_bedrock_guardrail" {
  type    = bool
  default = false
}
# Bedrock model IDs this proxy is allowed to invoke, exactly as configured in
# config.json (bedrock.llm.models[].model and bedrock.embedding.models[].model).
# Passed in by index.mjs. The pod role is scoped to these and nothing else, so
# a model added later through the LiteLLM admin API cannot be invoked.
# Empty means the deployment configured no Bedrock models, so no Bedrock grant
# is created at all.
variable "bedrock_model_ids" {
  type    = list(string)
  default = []
}
# Regions in which this role may call the Bedrock API. Constrains the region of
# the API call itself, which is what stops cross-region probing with a stolen
# credential. Note it does not constrain where a cross-region inference profile
# (global.* / us.* / eu.* / apac.*) internally routes -- the model-ARN scoping
# above is the stronger control.
variable "bedrock_allowed_regions" {
  type    = list(string)
  default = []
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
provider "aws" {
  alias  = "bedrock"
  region = var.bedrock_region
}

data "aws_caller_identity" "current" {}

locals {
  bedrock_regions = length(var.bedrock_allowed_regions) > 0 ? var.bedrock_allowed_regions : distinct([var.region, var.bedrock_region])

  # A cross-region inference profile ID (global.* / us.* / eu.* / apac.*) needs
  # BOTH the profile ARN and the underlying foundation-model ARN. Strip the
  # prefix to get the base model ID for the foundation-model ARN.
  bedrock_base_model_ids = [for m in var.bedrock_model_ids : replace(m, "/^(global|us|eu|apac)\\./", "")]

  # Foundation models are region-wildcarded: a cross-region profile routes the
  # inference to whichever region it chooses, and the call is still constrained
  # by the aws:RequestedRegion condition below.
  bedrock_foundation_model_arns = [for m in local.bedrock_base_model_ids : "arn:aws:bedrock:*::foundation-model/${m}"]

  # Only prefixed IDs are inference profiles; a bare model ID has no profile ARN.
  bedrock_inference_profile_arns = [
    for m in var.bedrock_model_ids : "arn:aws:bedrock:${var.bedrock_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${m}"
    if length(regexall("^(global|us|eu|apac)\\.", m)) > 0
  ]

  bedrock_invoke_resources = concat(local.bedrock_foundation_model_arns, local.bedrock_inference_profile_arns)

  # bedrock:InvokeModel on the configured models only. Dropped from the previous
  # policy: resources = ["*"] (any model in any account's region), and
  # aws-marketplace:Subscribe / ViewSubscriptions -- those let the role accept
  # Marketplace model agreements and so enable models the deployment never
  # configured. Nothing in this stack needs to subscribe at runtime.
  bedrock_invoke_statements = length(local.bedrock_invoke_resources) > 0 ? [
    {
      sid = "BedrockInvokeConfiguredModels"
      actions = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ]
      resources = local.bedrock_invoke_resources
      condition = [
        {
          test     = "StringEquals"
          variable = "aws:RequestedRegion"
          values   = local.bedrock_regions
        }
      ]
    }
  ] : []

  bedrock_guardrail_statements = var.enable_bedrock_guardrail ? [
    {
      sid       = "BedrockApplyGuardrail"
      actions   = ["bedrock:ApplyGuardrail"]
      resources = [aws_bedrock_guardrail.this[0].guardrail_arn]
    }
  ] : []

  litellm_policy_statements = concat(local.bedrock_invoke_statements, local.bedrock_guardrail_statements)
}

module "pod_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "1.12.0"

  name            = "${var.name}-${var.region}-litellm"
  use_name_prefix = false
  # No configured Bedrock models and no guardrail means no policy to attach --
  # attaching an empty statement list would fail.
  attach_custom_policy = length(local.litellm_policy_statements) > 0
  policy_statements    = local.litellm_policy_statements
  associations = {
    litellm = {
      service_account = "litellm"
      namespace       = "litellm"
      cluster_name    = var.name
    }
  }
}

resource "aws_bedrock_guardrail" "this" {
  count                     = var.enable_bedrock_guardrail ? 1 : 0
  provider                  = aws.bedrock
  name                      = var.name
  blocked_input_messaging   = "Sorry, the model cannot answer this question."
  blocked_outputs_messaging = "Sorry, the model cannot answer this question."
  description               = var.name
  contextual_grounding_policy_config {
    filters_config {
      threshold = 0.7
      type      = "GROUNDING"
    }
    filters_config {
      threshold = 0.7
      type      = "RELEVANCE"
    }
  }
  word_policy_config {
    managed_word_lists_config {
      type = "PROFANITY"
    }
  }
}
output "bedrock_guardrail_id" {
  value = var.enable_bedrock_guardrail ? aws_bedrock_guardrail.this[0].guardrail_id : ""
}
resource "aws_bedrock_guardrail_version" "this" {
  count         = var.enable_bedrock_guardrail ? 1 : 0
  provider      = aws.bedrock
  description   = var.name
  guardrail_arn = aws_bedrock_guardrail.this[0].guardrail_arn
}
output "bedrock_guardrail_version" {
  value = var.enable_bedrock_guardrail ? aws_bedrock_guardrail_version.this[0].version : ""
}