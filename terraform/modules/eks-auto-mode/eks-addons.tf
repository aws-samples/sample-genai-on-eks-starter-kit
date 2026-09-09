# Karpenter
# Custom NodeClass for the default NodePool. Same role/subnets/SG as the
# EKS-managed "default" NodeClass, but with a high-IOPS node root volume so
# stateful workloads (Langfuse PostgreSQL/Redis, Tempo, ...) are not starved
# by EBS IOPS throttling on the shared node disk.
resource "kubectl_manifest" "karpenter_nodeclass_default_perf" {
  yaml_body = <<-YAML
apiVersion: eks.amazonaws.com/v1
kind: NodeClass
metadata:
  name: default-perf
spec:
  role: ${module.eks.node_iam_role_name}
  subnetSelectorTerms:
%{for subnet_id in var.subnet_ids~}
    - id: ${subnet_id}
%{endfor~}
  securityGroupSelectorTerms:
    - id: ${module.eks.cluster_primary_security_group_id}
  snatPolicy: Random
  networkPolicy: DefaultAllow
  ephemeralStorage:
    size: 80Gi
    iops: 16000
    throughput: 1000
  YAML

  depends_on = [module.eks]
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
        group: eks.amazonaws.com
        kind: NodeClass
        name: default-perf
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
        # Minimum node size: >= 4 vCPU and >= 16 GiB so shared stateful
        # workloads are not bin-packed onto 2 vCPU / 4 GiB instances.
        - key: eks.amazonaws.com/instance-cpu
          operator: Gt
          values: ["3"]
        - key: eks.amazonaws.com/instance-memory
          operator: Gt
          values: ["15359"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64", "arm64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
  YAML

  depends_on = [module.eks, kubectl_manifest.karpenter_nodeclass_default_perf]
}

# Dedicated NodePool for Langfuse ClickHouse. ClickHouse caps its own memory
# at 90% of the cgroup limit and runs 16 background merge threads, so on a
# shared 4 vCPU node it starved the Langfuse worker (CPU 93% requested) and
# was evicted/OOM-killed repeatedly (2026-09-03). One On-Demand 16 vCPU /
# 64 GiB node, tainted so nothing else lands there; the clickhouse chart
# values carry the matching nodeSelector + toleration. On-Demand only: every
# ClickHouse restart archives its system log tables as *_N copies.
# 8 -> 16 vCPU (2026-09-03): the ingestion worker's per-event merge lookups
# pinned an 8 vCPU node at 7.6 vCPU and Langfuse fell 17.5 h behind. The CPU
# limit is 2x one node so a replacement node can be provisioned while the old
# one is still draining (Drifted budget is 0, so replacement is triggered by
# the pod's larger request, not by drift).
resource "kubectl_manifest" "karpenter_nodepool_clickhouse" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: clickhouse
spec:
  weight: 50
  limits:
    cpu: 32
  disruption:
    budgets:
      - nodes: "0"
        reasons: ["Underutilized", "Drifted"]
      - nodes: "1"
    consolidateAfter: 5m
    consolidationPolicy: WhenEmpty
  template:
    metadata:
      labels:
        workload: clickhouse
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: eks.amazonaws.com
        kind: NodeClass
        name: default-perf
      taints:
        - key: workload
          value: clickhouse
          effect: NoSchedule
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]
        - key: eks.amazonaws.com/instance-category
          operator: In
          values: ["m", "r"]
        - key: eks.amazonaws.com/instance-generation
          operator: Gt
          values: ["5"]
        - key: eks.amazonaws.com/instance-cpu
          operator: In
          values: ["16"]
        - key: eks.amazonaws.com/instance-memory
          operator: Gt
          values: ["61439"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 1h0m0s
  YAML

  depends_on = [module.eks, kubectl_manifest.karpenter_nodeclass_default_perf]
}

# Dedicated NodePool for the synthetic traffic generator. The generator is a
# fan-out of ~300 sh+curl processes that opens a new connection per request
# (and keeps retrying upstreams that are down), so on a shared "default" node
# it competes for CPU, conntrack and ENA pps with the very gateways it is
# load-testing (2026-09-03: it sat next to inference-gateway, ai-gateway,
# bifrost and neuron-lb). One small On-Demand node, tainted so nothing else
# lands there; traffic-generator.yaml carries the matching nodeSelector +
# toleration. On-Demand so a Spot reclaim does not show up in the dashboards
# as a traffic outage. CPU limit is 2x one node so a replacement can be
# provisioned while the old one drains.
resource "kubectl_manifest" "karpenter_nodepool_loadgen" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: loadgen
spec:
  weight: 50
  limits:
    cpu: 8
  disruption:
    budgets:
      - nodes: "1"
    consolidateAfter: 5m
    consolidationPolicy: WhenEmpty
  template:
    metadata:
      labels:
        workload: loadgen
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: eks.amazonaws.com
        kind: NodeClass
        name: default-perf
      taints:
        - key: workload
          value: loadgen
          effect: NoSchedule
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]
        - key: eks.amazonaws.com/instance-category
          operator: In
          values: ["c", "m"]
        - key: eks.amazonaws.com/instance-generation
          operator: Gt
          values: ["5"]
        - key: eks.amazonaws.com/instance-cpu
          operator: In
          values: ["4"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64", "arm64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 30m0s
  YAML

  depends_on = [module.eks, kubectl_manifest.karpenter_nodeclass_default_perf]
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
        name: default
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_capacity_type)}"]
        # - key: node.kubernetes.io/instance-type
        #   operator: In
        #   values: ["g6e.xlarge"]
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

  depends_on = [module.eks]
}

resource "kubectl_manifest" "karpenter_nodepool_neuron" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: neuron
spec:
  limits:
    # 80 cores = 40 inf2.xlarge. Raised from 50 on 2026-09-03 so the two Neuron
    # pools can run 16 replicas each (32 nodes, 64 cores) for 2 rps per gateway.
    aws.amazon.com/neuroncore: 80
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
    aws-efs-csi-driver = {
      most_recent = true
      # The driver ships without requests; the node DaemonSet's efs-plugin peaked
      # at ~170 MiB / 320m and was one of the unaccounted consumers that let
      # Karpenter over-pack 4 GiB spot nodes (2026-09-02).
      configuration_values = jsonencode({
        controller = {
          resources = {
            requests = { cpu = "50m", memory = "128Mi" }
            limits   = { memory = "512Mi" }
          }
        }
        node = {
          resources = {
            requests = { cpu = "50m", memory = "128Mi" }
            limits   = { memory = "512Mi" }
          }
        }
        sidecars = {
          csiProvisioner      = { resources = { requests = { cpu = "10m", memory = "32Mi" }, limits = { memory = "128Mi" } } }
          livenessProbe       = { resources = { requests = { cpu = "10m", memory = "32Mi" }, limits = { memory = "128Mi" } } }
          nodeDriverRegistrar = { resources = { requests = { cpu = "10m", memory = "32Mi" }, limits = { memory = "128Mi" } } }
        }
      })
    }
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
