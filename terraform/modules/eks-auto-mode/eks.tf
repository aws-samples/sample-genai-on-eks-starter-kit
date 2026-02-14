# ECR Pull Through Cache policy for EKS Auto Mode nodes
resource "aws_iam_policy" "ecr_pull_through_cache" {
  name        = "${var.name}-${var.region}-ecr-pull-through-cache"
  description = "Allows EKS nodes to create ECR repositories for pull through cache"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ECRPullThroughCache"
      Effect   = "Allow"
      Action   = "ecr:CreateRepository"
      Resource = "*"
    }]
  })
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "21.3.1"

  name                   = var.name
  kubernetes_version     = var.eks_cluster_version
  endpoint_public_access = true

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids
  # control_plane_subnet_ids = module.vpc.intra_subnets

  enable_cluster_creator_admin_permissions = true

  compute_config = {
    enabled    = true
    node_pools = ["general-purpose"]
  }

  # Use cluster name in KMS alias to avoid conflicts
  cluster_encryption_config = {
    resources        = ["secrets"]
    provider_key_arn = null
  }
  
  # Use cluster name in CloudWatch log group to avoid conflicts
  cloudwatch_log_group_name = "/aws/eks/${var.name}/cluster"

  # Enable ECR pull through cache for EKS Auto Mode nodes
  node_iam_role_additional_policies = {
    ECRPullThroughCache = aws_iam_policy.ecr_pull_through_cache.arn
  }
}

resource "null_resource" "update_kubeconfig" {
  provisioner "local-exec" {
    command = <<EOT
      # Update Global Config
      ORIGINAL_CONTEXT=$(kubectl config current-context)
      KUBECONFIG=$HOME/.kube/config aws --region ${var.region} eks update-kubeconfig --name ${module.eks.cluster_name} --alias ${module.eks.cluster_name}-${var.region}
      kubectl config use-context $ORIGINAL_CONTEXT
      # Update Project Config
      aws --region ${var.region} eks update-kubeconfig --name ${module.eks.cluster_name} --alias ${module.eks.cluster_name}-${var.region}
    EOT
  }

  depends_on = [module.eks]
}

output "eks_update_kubeconfig" {
  value = "aws --region ${var.region} eks update-kubeconfig --name ${module.eks.cluster_name} --alias ${module.eks.cluster_name}-${var.region}"
}

output "eks_cluster_name" {
  value = module.eks.cluster_name
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "--region", var.region, "get-token", "--cluster-name", module.eks.cluster_name]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "--region", var.region, "get-token", "--cluster-name", module.eks.cluster_name]
    }
  }
}

provider "kubectl" {
  apply_retry_count      = 5
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  load_config_file       = false

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "--region", var.region, "get-token", "--cluster-name", module.eks.cluster_name]
  }
}