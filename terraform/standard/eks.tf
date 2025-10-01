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

  eks_managed_node_groups = {
    karpenter = {
      ami_type       = "BOTTLEROCKET_x86_64"
      instance_types = ["m5.large"]

      min_size     = 2
      max_size     = 2
      desired_size = 2

      labels = {
        # Used to ensure Karpenter runs on nodes that it does not manage
        "karpenter.sh/controller" = "true"
      }

      taints = {
        # The pods that do not tolerate this taint should run on nodes
        # created by Karpenter
        karpenter = {
          key    = "karpenter.sh/controller"
          value  = "true"
          effect = "NO_SCHEDULE"
        }
      }
    }
  }

  node_security_group_tags = {
    "karpenter.sh/discovery" = var.name
  }

  access_entries = {
    admin = {
      principal_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/Admin"
      policy_associations = {
        AmazonEKSClusterAdminPolicy = {
          policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = {
            type = "cluster"
          }
        }
      }
    }
  }
  create_node_security_group = false
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
