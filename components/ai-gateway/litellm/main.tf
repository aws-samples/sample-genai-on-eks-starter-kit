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
  bedrock_account = data.aws_caller_identity.current.account_id
  bedrock_actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]

  # Model IDs fall into three classes, and each needs a DIFFERENT policy shape.
  # Getting this wrong denies the very model the deployment is configured to
  # serve, so the classes are kept explicit rather than collapsed.
  #
  #   global.<model>            GLOBAL cross-Region inference (CRIS). Routes to
  #                             any Region AWS chooses. Destination-Region model
  #                             access is authorised with
  #                             aws:RequestedRegion = "unspecified" against a
  #                             REGIONLESS foundation-model ARN.
  #   us.|eu.|apac.<model>      GEOGRAPHIC CRIS. Routes within a geography.
  #                             Destination-Region model access is authorised per
  #                             Region, gated on the profile that routed it.
  #   <model>                   No profile. Plain in-Region invoke.
  #
  # Reference: "Securing Amazon Bedrock cross-Region inference: Geographic and
  # global" -- the global case requires the "unspecified" Region condition, which
  # a plain aws:RequestedRegion allow-list would deny.
  bedrock_global_model_ids = [for m in var.bedrock_model_ids : m if startswith(m, "global.")]
  bedrock_geo_model_ids    = [for m in var.bedrock_model_ids : m if length(regexall("^(us|eu|apac)\\.", m)) > 0]
  bedrock_plain_model_ids  = [for m in var.bedrock_model_ids : m if length(regexall("^(global|us|eu|apac)\\.", m)) == 0]
  bedrock_cris_model_ids   = concat(local.bedrock_global_model_ids, local.bedrock_geo_model_ids)

  # Base model ID = the profile ID with its routing prefix stripped.
  bedrock_base_of = { for m in var.bedrock_model_ids : m => replace(m, "/^(global|us|eu|apac)\\./", "") }

  # Inference profiles are resolved in the SOURCE Region (where the call lands).
  bedrock_profile_arns = [
    for m in local.bedrock_cris_model_ids :
    "arn:aws:bedrock:${var.bedrock_region}:${local.bedrock_account}:inference-profile/${m}"
  ]

  # 1. Invoke the configured inference profiles themselves, in the source Region.
  bedrock_profile_statements = length(local.bedrock_profile_arns) > 0 ? [
    {
      sid       = "BedrockInvokeConfiguredInferenceProfiles"
      actions   = local.bedrock_actions
      resources = local.bedrock_profile_arns
    }
  ] : []

  # 2. Invoke the underlying foundation model in whichever Region the profile
  #    routes to -- but ONLY when the request arrived through one of our
  #    profiles. That condition is what keeps this least-privilege: it does not
  #    permit direct, un-profiled invocation anywhere.
  bedrock_cris_model_statements = length(local.bedrock_cris_model_ids) > 0 ? [
    {
      sid     = "BedrockInvokeModelViaConfiguredProfiles"
      actions = local.bedrock_actions
      resources = [
        for m in local.bedrock_cris_model_ids : "arn:aws:bedrock:*::foundation-model/${local.bedrock_base_of[m]}"
      ]
      condition = [
        {
          test     = "ArnLike"
          variable = "bedrock:InferenceProfileArn"
          values   = local.bedrock_profile_arns
        }
      ]
    }
  ] : []

  # 3. GLOBAL CRIS only: the destination-Region grant uses a REGIONLESS
  #    foundation-model ARN plus aws:RequestedRegion = "unspecified". Without
  #    this statement a global.* profile is denied once it routes out of the
  #    source Region -- the failure mode this policy previously had.
  bedrock_global_model_statements = length(local.bedrock_global_model_ids) > 0 ? [
    {
      sid     = "BedrockInvokeModelViaGlobalProfiles"
      actions = local.bedrock_actions
      resources = [
        for m in local.bedrock_global_model_ids : "arn:aws:bedrock:::foundation-model/${local.bedrock_base_of[m]}"
      ]
      condition = [
        {
          test     = "StringEquals"
          variable = "aws:RequestedRegion"
          values   = ["unspecified"]
        },
        {
          test     = "ArnLike"
          variable = "bedrock:InferenceProfileArn"
          values   = local.bedrock_profile_arns
        }
      ]
    }
  ] : []

  # 4. Plain model IDs (no profile): in-Region invoke, Region-scoped.
  bedrock_plain_model_statements = length(local.bedrock_plain_model_ids) > 0 ? [
    {
      sid     = "BedrockInvokeConfiguredModelsInRegion"
      actions = local.bedrock_actions
      resources = [
        for m in local.bedrock_plain_model_ids : "arn:aws:bedrock:*::foundation-model/${m}"
      ]
      condition = [
        {
          test     = "StringEquals"
          variable = "aws:RequestedRegion"
          values   = local.bedrock_regions
        }
      ]
    }
  ] : []

  # Dropped from the previous policy: resources = ["*"] (any model, any Region)
  # and aws-marketplace:Subscribe / ViewSubscriptions, which let the role accept
  # Marketplace model agreements and so enable models the deployment never
  # configured. Nothing in this stack needs to subscribe at runtime.
  bedrock_invoke_statements = concat(
    local.bedrock_profile_statements,
    local.bedrock_cris_model_statements,
    local.bedrock_global_model_statements,
    local.bedrock_plain_model_statements,
  )

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