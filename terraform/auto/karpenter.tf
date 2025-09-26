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

resource "kubectl_manifest" "karpenter_nodepool_gpu" {
  yaml_body = <<-YAML
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu
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