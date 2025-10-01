module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "20.36.0"

  cluster_name                   = var.name
  cluster_version                = var.eks_cluster_version
  cluster_endpoint_public_access = true

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets
  # control_plane_subnet_ids = module.vpc.intra_subnets

  enable_cluster_creator_admin_permissions = true

  cluster_compute_config = {
    enabled    = true
    node_pools = ["general-purpose"]
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
