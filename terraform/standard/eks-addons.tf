resource "aws_iam_role" "external_dns" {
  name = "${module.eks.cluster_name}-${var.region}-external-dns"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "pods.eks.amazonaws.com"
        }
        Action = [
          "sts:AssumeRole",
          "sts:TagSession"
        ]
      }
    ]
  })
}
resource "aws_iam_role_policy_attachment" "external_dns_route53" {
  role       = aws_iam_role.external_dns.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonRoute53FullAccess"
}
resource "aws_eks_pod_identity_association" "external_dns" {
  cluster_name    = module.eks.cluster_name
  namespace       = "external-dns"
  service_account = "external-dns"
  role_arn        = aws_iam_role.external_dns.arn
}

resource "aws_iam_role" "efs_csi_driver" {
  name = "${module.eks.cluster_name}-${var.region}-efs-csi-driver"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "pods.eks.amazonaws.com"
        }
        Action = [
          "sts:AssumeRole",
          "sts:TagSession"
        ]
      }
    ]
  })
}
resource "aws_iam_role_policy_attachment" "efs_csi_driver" {
  role       = aws_iam_role.efs_csi_driver.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEFSCSIDriverPolicy"
}
resource "aws_eks_pod_identity_association" "efs_csi_driver" {
  cluster_name    = module.eks.cluster_name
  namespace       = "kube-system"
  service_account = "efs-csi-controller-sa"
  role_arn        = aws_iam_role.efs_csi_driver.arn
}

module "eks_blueprints_addons_core" {
  source  = "aws-ia/eks-blueprints-addons/aws"
  version = "1.21.0"

  cluster_name      = module.eks.cluster_name
  cluster_endpoint  = module.eks.cluster_endpoint
  cluster_version   = module.eks.cluster_version
  oidc_provider_arn = module.eks.oidc_provider_arn

  # EKS-managed Add-ons
  eks_addons = {
    coredns = {
      configuration_values = jsonencode({
        tolerations = [
          # Allow CoreDNS to run on the same nodes as the Karpenter controller
          # for use during cluster creation when Karpenter nodes do not yet exist
          {
            key    = "karpenter.sh/controller"
            value  = "true"
            effect = "NoSchedule"
          }
        ]
      })
    }
    eks-pod-identity-agent = {}
    # VPC CNI uses worker node IAM role policies and should only run on cloud nodes
    vpc-cni = {}
    aws-ebs-csi-driver = {
      service_account_role_arn = module.ebs_csi_driver_irsa.iam_role_arn
    }
    aws-efs-csi-driver = { most_recent = true }
    # cert-manager       = { most_recent = true }
    external-dns = {
      most_recent = true
      configuration_values = jsonencode({
        sources       = ["service", "ingress"] # default
        domainFilters = [var.domain]
        extraArgs     = ["--aws-zone-type=public", "--exclude-record-types=AAAA"]
        policy        = "sync"
        registry      = "txt" # default
        txtOwnerId    = "${module.eks.cluster_name}-${var.region}"
        env = [{
          name  = "AWS_REGION"
          value = var.region
        }]
        interval = "5s"
        resources = {
          requests = {
            cpu    = "50m"
            memory = "64Mi"
          }
          limits = {
            memory = "64Mi"
          }
        }
      })
    }
    metrics-server = {
      most_recent = true
      configuration_values = jsonencode({
        resources = {
          requests = {
            cpu    = "100m"
            memory = "256Mi"
          }
          limits = {
            memory = "256Mi"
          }
        }
      })
    }
  }
  #---------------------------------------
  # AWS Load Balancer Controller Add-on
  #---------------------------------------
  enable_aws_load_balancer_controller = true
  # turn off the mutating webhook for services because we are using
  # service.beta.kubernetes.io/aws-load-balancer-type: external
  aws_load_balancer_controller = {
    set = [
      {
        name  = "enableServiceMutatorWebhook"
        value = "false"
      },
      {
        name  = "vpcId"
        value = module.vpc.vpc_id
      },
      {
        name  = "tolerations[0].key"
        value = "karpenter.sh/controller"
      },
      {
        name  = "tolerations[0].operator"
        value = "Exists"
      },
      {
        name  = "tolerations[0].effect"
        value = "NoSchedule"
      }
    ]
  }
  
  enable_ingress_nginx = true
  ingress_nginx = {
    chart_version = "4.12.3"
    values = [
      yamlencode({
        controller = {
          service = {
            type = "ClusterIP"
          }
          resources = {
            requests = {
              cpu    = "100m"
              memory = "256Mi"
            }
            limits = {
              memory = "256Mi"
            }
          }
        }
      })
    ]
  }

  depends_on = [kubectl_manifest.karpenter_nodepool_default]
}

#---------------------------------------------------------------
# GP3 Encrypted Storage Class
#---------------------------------------------------------------
resource "kubernetes_annotations" "disable_gp2" {
  annotations = {
    "storageclass.kubernetes.io/is-default-class" : "false"
  }
  api_version = "storage.k8s.io/v1"
  kind        = "StorageClass"
  metadata {
    name = "gp2"
  }
  force = true

  depends_on = [module.eks.eks_cluster_id]
}

resource "kubernetes_storage_class" "default_gp3" {
  metadata {
    name = "gp3"
    annotations = {
      "storageclass.kubernetes.io/is-default-class" : "true"
    }
  }

  storage_provisioner    = "ebs.csi.aws.com"
  reclaim_policy         = "Delete"
  allow_volume_expansion = true
  volume_binding_mode    = "WaitForFirstConsumer"
  parameters = {
    fsType    = "ext4"
    encrypted = true
    type      = "gp3"
  }

  depends_on = [kubernetes_annotations.disable_gp2]
}

#---------------------------------------------------------------
# IRSA for EBS CSI Driver
#---------------------------------------------------------------
module "ebs_csi_driver_irsa" {
  source                = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version               = "~> 5.20"
  role_name_prefix      = format("%s-%s-", var.name, "ebs-csi-driver")
  attach_ebs_csi_policy = true
  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:ebs-csi-controller-sa"]
    }
  }
  tags = local.tags
}

resource "helm_release" "lws" {
  name             = "lws"
  namespace        = "lws-system"
  repository       = "oci://registry.k8s.io/lws/charts"
  chart            = "lws"
  version          = "0.7.0"
  create_namespace = true

  depends_on = [module.eks_blueprints_addons_core]
}
