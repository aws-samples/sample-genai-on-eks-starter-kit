# Karpenter
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
        group: eks.amazonaws.com
        kind: NodeClass
        name: default
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]
        - key: eks.amazonaws.com/instance-category
          operator: In
          values: ["c", "m", "r"]
        - key: eks.amazonaws.com/instance-generation
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

  depends_on = [module.eks]
}

# Dedicated GPU NodeClass.
#
# The GPU NodePool intentionally does NOT use the EKS Auto Mode built-in
# "default" NodeClass. A dedicated NodeClass gives GPU nodes an object we own,
# so GPU-only settings can be applied without mutating the EKS-managed
# "default" NodeClass that every other NodePool (general-purpose, system,
# default, neuron) shares.
#
# The main use is On-Demand Capacity Reservations (ODCRs): an event operator can
# attach a reservation with
#
#   kubectl patch nodeclass gpu --type=merge \
#     -p '{"spec":{"capacityReservationSelectorTerms":[{"id":"cr-..."}]}}'
#
# or select by tag/owner for a reservation shared in from another account:
#
#   capacityReservationSelectorTerms:
#     - tags:    { <key>: <value> }
#       ownerID: "<odcr-owner-account-id>"
#
# capacityReservationSelectorTerms is deliberately left OUT of Terraform: the
# reservation id/owner/tags differ per event, per region and per run, so baking
# them in here would force a new starter-kit release for every event. Karpenter
# only consumes a reservation when "reserved" is also an allowed capacity type
# on the NodePool below.
resource "kubectl_manifest" "karpenter_nodeclass_gpu" {
  yaml_body = <<-YAML
apiVersion: eks.amazonaws.com/v1
kind: NodeClass
metadata:
  name: gpu
spec:
  role: ${module.eks.node_iam_role_name}
  subnetSelectorTerms: ${jsonencode([for subnet_id in var.subnet_ids : { id = subnet_id }])}
  securityGroupSelectorTerms:
    - tags:
        "aws:eks:cluster-name": ${module.eks.cluster_name}
  tags:
    intent: gpu
    cluster: ${module.eks.cluster_name}
  YAML

  depends_on = [module.eks]
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
        group: eks.amazonaws.com
        kind: NodeClass
        name: gpu
      requirements:
        # "reserved" must be present for Karpenter to launch into an ODCR.
        # Karpenter prices reserved offerings at zero, so it prefers them
        # automatically whenever a matching reservation has room, and falls
        # back to the remaining types when it does not.
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_capacity_type)}"]
        # Instance families stay broad on purpose (g6, g6e, ...). Pin the exact
        # instance type per workload with a pod nodeSelector, e.g.
        #   node.kubernetes.io/instance-type: g6.xlarge
        # so a different instance size never requires a starter-kit change.
        - key: eks.amazonaws.com/instance-family
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

  depends_on = [module.eks, kubectl_manifest.karpenter_nodeclass_gpu]
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
        group: eks.amazonaws.com
        kind: NodeClass
        name: default
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]
        - key: eks.amazonaws.com/instance-family
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

  depends_on = [module.eks]
}

# EKS add-ons
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

  enable_ingress_nginx = var.enable_nginx
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

# ALB
resource "kubectl_manifest" "ingressclassparams_shared_internet_facing_alb" {
  count     = var.domain != "" ? 1 : 0
  yaml_body = <<-YAML
apiVersion: eks.amazonaws.com/v1
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
  controller: eks.amazonaws.com/alb
  parameters:
    apiGroup: eks.amazonaws.com
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
apiVersion: eks.amazonaws.com/v1
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
  controller: eks.amazonaws.com/alb
  parameters:
    apiGroup: eks.amazonaws.com
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
provisioner: ebs.csi.eks.amazonaws.com
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
  YAML

  ignore_fields = ["metadata.uid", "metadata.resourceVersion"]

  depends_on = [module.eks_blueprints_addons_core]
}

# LWS
resource "helm_release" "lws" {
  count            = var.enable_lws ? 1 : 0
  name             = "lws"
  namespace        = "lws-system"
  repository       = "oci://registry.k8s.io/lws/charts"
  chart            = "lws"
  version          = "0.7.0"
  create_namespace = true

  depends_on = [module.eks_blueprints_addons_core]
}
