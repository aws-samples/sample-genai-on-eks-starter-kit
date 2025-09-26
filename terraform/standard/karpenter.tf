locals {
  namespace = "karpenter"
  tags = {
    Blueprint  = var.name
  }
}

provider "aws" {
  alias  = "ecr"
  region = "us-east-1"
}

data "aws_ecrpublic_authorization_token" "token" {
  provider = aws.ecr
}

################################################################################
# Controller & Node IAM roles, SQS Queue, Eventbridge Rules
################################################################################

module "karpenter" {
  source  = "terraform-aws-modules/eks/aws//modules/karpenter"
  version = "~> 20.24"

  cluster_name          = module.eks.cluster_name
  enable_v1_permissions = true
  namespace             = local.namespace

  # Name needs to match role name passed to the EC2NodeClass
  node_iam_role_use_name_prefix   = false
  node_iam_role_name              = var.name
  create_pod_identity_association = true

  tags = local.tags
}

################################################################################
# Helm charts
################################################################################

resource "helm_release" "karpenter" {
  name                = "karpenter"
  namespace           = local.namespace
  create_namespace    = true
  repository          = "oci://public.ecr.aws/karpenter"
  repository_username = data.aws_ecrpublic_authorization_token.token.user_name
  repository_password = data.aws_ecrpublic_authorization_token.token.password
  chart               = "karpenter"
  version             = "1.3.3"
  wait                = false

  values = [
    <<-EOT
    nodeSelector:
      karpenter.sh/controller: 'true'
    settings:
      clusterName: ${module.eks.cluster_name}
      clusterEndpoint: ${module.eks.cluster_endpoint}
      interruptionQueue: ${module.karpenter.queue_name}
    tolerations:
      - key: CriticalAddonsOnly
        operator: Exists
      - key: karpenter.sh/controller
        operator: Exists
        effect: NoSchedule
    webhook:
      enabled: false
    EOT
  ]
}

################################################################################
# Karpenter EC2NodeClasses
################################################################################

# Default EC2NodeClass for general purpose workloads (CMR)
resource "kubectl_manifest" "karpenter_ec2nodeclass_default" {
  yaml_body = <<-YAML
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: default
spec:
  amiSelectorTerms:
    - alias: bottlerocket@latest
  role: ${var.name}
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: ${module.eks.cluster_name}
  securityGroupSelectorTerms:
    - tags:
        aws:eks:cluster-name: ${module.eks.cluster_name}
  tags:
    karpenter.sh/discovery: ${module.eks.cluster_name}
  YAML

  depends_on = [helm_release.karpenter]
}

# GPU EC2NodeClass
resource "kubectl_manifest" "karpenter_ec2nodeclass_gpu" {
  yaml_body = <<-YAML
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: gpu
spec:
  amiFamily: Bottlerocket
  amiSelectorTerms:
    - alias: bottlerocket@latest
  role: ${var.name}
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: ${module.eks.cluster_name}
  securityGroupSelectorTerms:
    - tags:
        aws:eks:cluster-name: ${module.eks.cluster_name}
  instanceStorePolicy: RAID0
  blockDeviceMappings:
    # Root Device
    - deviceName: /dev/xvda
      ebs:
        volumeSize: 50Gi
        volumeType: gp3
        encrypted: true
    # Data Device
    - deviceName: /dev/xvdb
      ebs:
        volumeSize: 500Gi
        volumeType: gp3
        encrypted: true
  tags:
    karpenter.sh/discovery: ${module.eks.cluster_name}
  YAML

  depends_on = [helm_release.karpenter]
}

# Neuron EC2NodeClass
resource "kubectl_manifest" "karpenter_ec2nodeclass_neuron" {
  yaml_body = <<-YAML
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: neuron
spec:
  amiFamily: Bottlerocket
  amiSelectorTerms:
    - alias: bottlerocket@latest
  role: ${var.name}
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: ${module.eks.cluster_name}
  securityGroupSelectorTerms:
    - tags:
        aws:eks:cluster-name: ${module.eks.cluster_name}
  instanceStorePolicy: RAID0
  blockDeviceMappings:
    # Root Device
    - deviceName: /dev/xvda
      ebs:
        volumeSize: 50Gi
        volumeType: gp3
        encrypted: true
    # Data Device
    - deviceName: /dev/xvdb
      ebs:
        volumeSize: 500Gi
        volumeType: gp3
        encrypted: true
  tags:
    karpenter.sh/discovery: ${module.eks.cluster_name}
  YAML

  depends_on = [helm_release.karpenter]
}

################################################################################
# Karpenter NodePools
################################################################################

# Default NodePool for general purpose workloads (CMR)
resource "kubectl_manifest" "karpenter_nodepool_default" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  weight: 100
  limits:
    cpu: 1000
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
        - key: karpenter.k8s.aws/instance-hypervisor
          operator: In
          values: ["nitro"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64", "arm64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
  YAML

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_default
  ]
}

# GPU NodePool for g6e instances (NVIDIA L40S)
resource "kubectl_manifest" "karpenter_nodepool_gpu_g6e" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-g6e
  labels:
    type: karpenter
    NodeGroupType: gpu-karpenter
    instance-family: g6e
spec:
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "g6e"
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: gpu
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_capacity_type)}"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["g6e"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
      taints:
        - key: nvidia.com/gpu
          value: "true"
          effect: NoSchedule
  YAML

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_gpu
  ]
}

# GPU NodePool for g6 instances (NVIDIA L4)
resource "kubectl_manifest" "karpenter_nodepool_gpu_g6" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-g6
  labels:
    type: karpenter
    NodeGroupType: gpu-karpenter
    instance-family: g6
spec:
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "g6"
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: gpu
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_capacity_type)}"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["g6"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
      taints:
        - key: nvidia.com/gpu
          value: "true"
          effect: NoSchedule
  YAML

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_gpu
  ]
}

# GPU NodePool for g5 instances (NVIDIA A10G)
resource "kubectl_manifest" "karpenter_nodepool_gpu_g5" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-g5
  labels:
    type: karpenter
    NodeGroupType: gpu-karpenter
    instance-family: g5
spec:
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "g5"
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: gpu
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_capacity_type)}"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["g5"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
      taints:
        - key: nvidia.com/gpu
          value: "true"
          effect: NoSchedule
  YAML

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_gpu
  ]
}

# GPU NodePool for p5en instances (NVIDIA H200 with enhanced networking)
resource "kubectl_manifest" "karpenter_nodepool_gpu_p5en" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-p5en
  labels:
    type: karpenter
    NodeGroupType: gpu-karpenter
    instance-family: p5en
spec:
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "p5en"
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: gpu
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_capacity_type)}"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["p5en"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
      taints:
        - key: nvidia.com/gpu
          value: "true"
          effect: NoSchedule
  YAML

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_gpu
  ]
}

# GPU NodePool for p5e instances (NVIDIA H200)
resource "kubectl_manifest" "karpenter_nodepool_gpu_p5e" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-p5e
  labels:
    type: karpenter
    NodeGroupType: gpu-karpenter
    instance-family: p5e
spec:
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "p5e"
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: gpu
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_capacity_type)}"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["p5e"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
      taints:
        - key: nvidia.com/gpu
          value: "true"
          effect: NoSchedule
  YAML

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_gpu
  ]
}

# GPU NodePool for p5 instances (NVIDIA H100)
resource "kubectl_manifest" "karpenter_nodepool_gpu_p5" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-p5
  labels:
    type: karpenter
    NodeGroupType: gpu-karpenter
    instance-family: p5
spec:
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "p5"
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: gpu
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_capacity_type)}"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["p5"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
      taints:
        - key: nvidia.com/gpu
          value: "true"
          effect: NoSchedule
  YAML

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_gpu
  ]
}

# GPU NodePool for p6-b200 instances (NVIDIA Blackwell B200)
resource "kubectl_manifest" "karpenter_nodepool_gpu_p6_b200" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-p6-b200
  labels:
    type: karpenter
    NodeGroupType: gpu-karpenter
    instance-family: p6-b200
spec:
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "p6-b200"
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: gpu
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["${join("\", \"", var.gpu_nodepool_capacity_type)}"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["p6-b200"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
      taints:
        - key: nvidia.com/gpu
          value: "true"
          effect: NoSchedule
  YAML

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_gpu
  ]
}

# Neuron NodePool for inf2 instances (AWS Inferentia2)
resource "kubectl_manifest" "karpenter_nodepool_neuron_inf2" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: neuron-inf2
  labels:
    type: karpenter
    NodeGroupType: neuron-karpenter
    instance-family: inf2
spec:
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "inf2"
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: neuron
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["inf2"]
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

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_neuron
  ]
}

# Neuron NodePool for trn1 instances (AWS Trainium)
resource "kubectl_manifest" "karpenter_nodepool_neuron_trn1" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: neuron-trn1
  labels:
    type: karpenter
    NodeGroupType: neuron-karpenter
    instance-family: trn1
spec:
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "trn1"
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: neuron
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["trn1"]
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

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_neuron
  ]
}

# Neuron NodePool for trn2 instances (AWS Trainium2)
resource "kubectl_manifest" "karpenter_nodepool_neuron_trn2" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: neuron-trn2
  labels:
    type: karpenter
    NodeGroupType: neuron-karpenter
    instance-family: trn2
spec:
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "trn2"
    spec:
      expireAfter: 336h
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: neuron
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]
        - key: karpenter.k8s.aws/instance-family
          operator: In
          values: ["trn2"]
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

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_neuron
  ]
}

# CPU NodePool for r7i instances (Memory-optimized for embedding models)
resource "kubectl_manifest" "karpenter_nodepool_cpu_r7i" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: cpu-r7i
  labels:
    type: karpenter
    NodeGroupType: cpu-karpenter
    instance-family: r7i
spec:
  limits:
    cpu: 200
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "r7i"
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
          values: ["r7i"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
  YAML

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_default
  ]
}

# CPU NodePool for m7i instances (General purpose for smaller embedding models)
resource "kubectl_manifest" "karpenter_nodepool_cpu_m7i" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: cpu-m7i
  labels:
    type: karpenter
    NodeGroupType: cpu-karpenter
    instance-family: m7i
spec:
  limits:
    cpu: 200
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
    metadata:
      labels:
        eks.amazonaws.com/instance-family: "m7i"
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
          values: ["m7i"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        - key: kubernetes.io/os
          operator: In
          values: ["linux"]
      terminationGracePeriod: 24h0m0s
  YAML

  depends_on = [
    helm_release.karpenter,
    kubectl_manifest.karpenter_ec2nodeclass_default
  ]
}
