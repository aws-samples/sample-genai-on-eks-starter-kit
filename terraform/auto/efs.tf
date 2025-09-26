# EFS Security Group
resource "aws_security_group" "efs" {
  name        = "${module.eks.cluster_name}-efs-sg"
  description = "Security group for EFS"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "Allow NFS traffic from private subnets"
    from_port   = 2049
    to_port     = 2049
    protocol    = "tcp"
    cidr_blocks = module.vpc.private_subnets_cidr_blocks
  }

  tags = {
    Name = "${module.eks.cluster_name}-efs-sg"
  }
}

resource "aws_efs_file_system" "this" {
  creation_token  = "${module.eks.cluster_name}-efs"
  encrypted       = true
  throughput_mode = var.efs_throughput_mode

  lifecycle_policy {
    transition_to_ia = "AFTER_7_DAYS"
  }
  lifecycle_policy {
    transition_to_primary_storage_class = "AFTER_1_ACCESS"
  }
  tags = {
    Name = "${module.eks.cluster_name}-efs"
  }
}

resource "aws_efs_mount_target" "this" {
  count = length(module.vpc.private_subnets)

  file_system_id  = aws_efs_file_system.this.id
  subnet_id       = module.vpc.private_subnets[count.index]
  security_groups = [aws_security_group.efs.id]
}

resource "kubectl_manifest" "storageclass_efs" {
  yaml_body = <<-YAML
    apiVersion: storage.k8s.io/v1
    kind: StorageClass
    metadata:
      name: efs
    provisioner: efs.csi.aws.com
    parameters:
      provisioningMode: efs-ap
      fileSystemId: ${aws_efs_file_system.this.id}
      directoryPerms: "700"
  YAML

  ignore_fields = ["metadata.uid", "metadata.resourceVersion"]

  depends_on = [module.eks_blueprints_addons_core]
}
