provider "aws" {
  alias  = "ecr"
  region = "us-east-1"
}

data "aws_ecrpublic_authorization_token" "token" {
  provider = aws.ecr
}

data "aws_iam_policy_document" "karpenter_irsa" {
  statement {
    sid     = "IRSA"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(module.eks.oidc_provider_arn, "/^(.*provider/)/", "")}:sub"
      values   = ["system:serviceaccount:kube-system:karpenter"]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(module.eks.oidc_provider_arn, "/^(.*provider/)/", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

module "karpenter" {
  source  = "terraform-aws-modules/eks/aws//modules/karpenter"
  version = "21.3.1"

  cluster_name                            = module.eks.cluster_name
  iam_role_use_name_prefix                = false
  iam_role_name                           = "${var.name}-karpenter"
  node_iam_role_use_name_prefix           = false
  node_iam_role_name                      = "${var.name}-node"
  create_pod_identity_association         = false
  iam_role_source_assume_policy_documents = [data.aws_iam_policy_document.karpenter_irsa.json]

  depends_on = [module.eks]
}

resource "helm_release" "karpenter" {
  name                = "karpenter"
  namespace           = "kube-system"
  create_namespace    = true
  repository          = "oci://public.ecr.aws/karpenter"
  repository_username = data.aws_ecrpublic_authorization_token.token.user_name
  repository_password = data.aws_ecrpublic_authorization_token.token.password
  chart               = "karpenter"
  version             = "1.8.2"
  wait                = false

  values = [
    <<-EOT
    dnsPolicy: Default
    settings:
      clusterName: ${module.eks.cluster_name}
      clusterEndpoint: ${module.eks.cluster_endpoint}
      interruptionQueue: ${module.karpenter.queue_name}
    serviceAccount:
      annotations:
        eks.amazonaws.com/role-arn: ${module.karpenter.iam_role_arn}
    webhook:
      enabled: false
    EOT
  ]

  lifecycle {
    ignore_changes = [
      repository_password
    ]
  }
}

resource "kubectl_manifest" "karpenter_ec2nodeclass_default" {
  yaml_body = <<-YAML
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: default
spec:
  amiSelectorTerms:
    - alias: bottlerocket@latest
  role: ${module.karpenter.node_iam_role_name}
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: ${module.eks.cluster_name}
  securityGroupSelectorTerms:
    - tags:
        karpenter.sh/discovery: ${module.eks.cluster_name}
  tags:
    karpenter.sh/discovery: ${module.eks.cluster_name}
  kubelet:
    maxPods: 110
  blockDeviceMappings:
    - deviceName: /dev/xvda
      ebs:
        volumeSize: 4Gi
        volumeType: gp3
        encrypted: true
    - deviceName: /dev/xvdb
      ebs:
        volumeSize: 100Gi
        volumeType: gp3
        encrypted: true
  YAML

  depends_on = [helm_release.karpenter]
}

resource "kubectl_manifest" "karpenter_nodepool_default" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  weight: 100
  limits:
    cpu: 100
  disruption:
    budgets:
      - nodes: 10%
    consolidateAfter: 30s
    consolidationPolicy: WhenEmptyOrUnderutilized
  template:
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]
        - key: karpenter.k8s.aws/instance-category
          operator: In
          values: ["c", "m", "r"]
        - key: karpenter.k8s.aws/instance-generation
          operator: Gt
          values: ["4"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64", "arm64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
  YAML

  depends_on = [kubectl_manifest.karpenter_ec2nodeclass_default]
}

resource "kubectl_manifest" "karpenter_nodepool_gpu" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu
spec:
  weight: 100
  limits:
    nvidia.com/gpu: 50
  disruption:
    budgets:
      - nodes: 100%
        reasons:
          - Empty
      - nodes: 0%
        reasons:
          - Underutilized
          - Drifted
    consolidateAfter: 30s
    consolidationPolicy: WhenEmptyOrUnderutilized
  template:
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_capacity_type)}"]
        # - key: node.kubernetes.io/instance-type
        #   operator: In
        #   values: ["g6e.xlarge"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_instance_family)}"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64", "arm64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
      taints:
        - key: nvidia.com/gpu
          value: "true"
          effect: NoSchedule
  YAML

  depends_on = [kubectl_manifest.karpenter_ec2nodeclass_default]
}

resource "kubectl_manifest" "karpenter_nodepool_neuron" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: neuron
spec:
  limits:
    aws.amazon.com/neuroncore: 50
  disruption:
    budgets:
      - nodes: 100%
        reasons:
          - Empty
      - nodes: 0%
        reasons:
          - Underutilized
          - Drifted
    consolidateAfter: 30s
    consolidationPolicy: WhenEmptyOrUnderutilized
  template:
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["inf2", "trn1", "trn2"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
      taints:
        - key: aws.amazon.com/neuron
          value: "true"
          effect: NoSchedule
  YAML

  depends_on = [kubectl_manifest.karpenter_ec2nodeclass_default]
}

# EKS add-ons
resource "aws_iam_role" "ebs_csi_driver" {
  name = "${module.eks.cluster_name}-${var.region}-ebs-csi-driver"
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
resource "aws_iam_role_policy_attachment" "ebs_csi_driver" {
  role       = aws_iam_role.ebs_csi_driver.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}
resource "aws_eks_pod_identity_association" "ebs_csi_driver" {
  cluster_name    = module.eks.cluster_name
  namespace       = "kube-system"
  service_account = "ebs-csi-controller-sa"
  role_arn        = aws_iam_role.ebs_csi_driver.arn
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

module "eks_blueprints_addons_core" {
  source  = "aws-ia/eks-blueprints-addons/aws"
  version = "1.22.0"

  cluster_name      = module.eks.cluster_name
  cluster_endpoint  = module.eks.cluster_endpoint
  cluster_version   = module.eks.cluster_version
  oidc_provider_arn = module.eks.oidc_provider_arn

  # EKS-managed Add-ons
  eks_addons = {
    aws-ebs-csi-driver = { most_recent = true }
    aws-efs-csi-driver = { most_recent = true }
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

  # Self-managed Add-ons
  enable_aws_load_balancer_controller = true
  aws_load_balancer_controller = {
    chart_version = "1.13.4"
    values = [
      <<-EOT
          vpcId: ${var.vpc_id}
          region: ${var.region}
        EOT
    ]
  }
  enable_ingress_nginx = true
  ingress_nginx = {
    chart_version = "4.14.0"
    values = [
      yamlencode({
        controller = {
          service = {
            type = "ClusterIP"
          }
          resources = {
            requests = {
              cpu    = "100m"
              memory = "512Mi"
            }
            limits = {
              memory = "512Mi"
            }
          }
        }
      })
    ]
  }

  depends_on = [kubectl_manifest.karpenter_nodepool_default]
}

resource "kubernetes_namespace_v1" "neuron_healthcheck_system" {
  metadata {
    name = "neuron-healthcheck-system"
  }

  depends_on = [module.eks_blueprints_addons_core]
}

resource "helm_release" "neuron" {
  name                = "neuron"
  namespace           = "kube-system"
  repository          = "oci://public.ecr.aws/neuron"
  repository_username = data.aws_ecrpublic_authorization_token.token.user_name
  repository_password = data.aws_ecrpublic_authorization_token.token.password
  chart               = "neuron-helm-chart"
  version             = "1.3.0"
  create_namespace    = false

  lifecycle {
    ignore_changes = [
      repository_password
    ]
  }

  depends_on = [kubernetes_namespace_v1.neuron_healthcheck_system]
}

# ALB
resource "kubectl_manifest" "ingressclassparams_shared_internet_facing_alb" {
  count     = var.domain != "" ? 1 : 0
  yaml_body = <<-YAML
apiVersion: elbv2.k8s.aws/v1beta1
kind: IngressClassParams
metadata:
  name: shared-internet-facing-alb
spec:
  scheme: internet-facing
  group:
    name: shared-internet-facing-alb
  YAML

  depends_on = [module.eks_blueprints_addons_core]
}

resource "kubectl_manifest" "ingressclass_shared_internet_facing_alb" {
  count     = var.domain != "" ? 1 : 0
  yaml_body = <<-YAML
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"
  name: shared-internet-facing-alb
spec:
  controller: ingress.k8s.aws/alb
  parameters:
    apiGroup: elbv2.k8s.aws
    kind: IngressClassParams
    name: shared-internet-facing-alb
  YAML

  depends_on = [kubectl_manifest.ingressclassparams_shared_internet_facing_alb]
}

resource "kubectl_manifest" "ingress_internet_facing_alb" {
  count     = var.domain != "" ? 1 : 0
  yaml_body = <<-YAML
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: default
  namespace: default
  annotations:
    alb.ingress.kubernetes.io/group.order: "1000"
    alb.ingress.kubernetes.io/target-type: ip
spec:
  ingressClassName: shared-internet-facing-alb
  defaultBackend:
    service:
      name: default
      port:
        number: 80
  YAML

  depends_on = [kubectl_manifest.ingressclass_shared_internet_facing_alb]
}

resource "kubectl_manifest" "ingressclassparams_internet_facing_alb" {
  count     = var.domain == "" ? 1 : 0
  yaml_body = <<-YAML
apiVersion: elbv2.k8s.aws/v1beta1
kind: IngressClassParams
metadata:
  name: internet-facing-alb
spec:
  scheme: internet-facing
  YAML

  depends_on = [module.eks_blueprints_addons_core]
}

resource "kubectl_manifest" "ingressclass_internet_facing_alb" {
  count = var.domain == "" ? 1 : 0

  yaml_body = <<-YAML
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"
  name: internet-facing-alb
spec:
  controller: elbv2.k8s.aws/alb
  parameters:
    apiGroup: elbv2.k8s.aws
    kind: IngressClassParams
    name: internet-facing-alb
  YAML

  depends_on = [kubectl_manifest.ingressclassparams_internet_facing_alb]
}

# EBS
resource "kubectl_manifest" "storageclass_ebs" {
  yaml_body = <<-YAML
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
parameters:
  type: gp3
  YAML

  ignore_fields = ["metadata.uid", "metadata.resourceVersion"]

  depends_on = [module.eks_blueprints_addons_core]
}

resource "null_resource" "delete_gp2_storageclass" {
  provisioner "local-exec" {
    command = <<-EOT
      kubectl delete storageclass gp2 --ignore-not-found
    EOT
  }

  depends_on = [module.eks_blueprints_addons_core]
}

# EFS
resource "kubectl_manifest" "storageclass_efs" {
  yaml_body = <<-YAML
    apiVersion: storage.k8s.io/v1
    kind: StorageClass
    metadata:
      name: efs
    provisioner: efs.csi.aws.com
    parameters:
      provisioningMode: efs-ap
      fileSystemId: ${var.efs_file_system_id}
      directoryPerms: "700"
      reuseAccessPoint: "true"
  YAML

  ignore_fields = ["metadata.uid", "metadata.resourceVersion"]

  depends_on = [module.eks_blueprints_addons_core]
}

# LWS
resource "helm_release" "lws" {
  name             = "lws"
  namespace        = "lws-system"
  repository       = "oci://registry.k8s.io/lws/charts"
  chart            = "lws"
  version          = "0.7.0"
  create_namespace = true

  depends_on = [module.eks_blueprints_addons_core]
}
