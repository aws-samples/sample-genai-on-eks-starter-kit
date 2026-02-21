# Multi-Cluster Support in Same Region

## Overview

This Terraform configuration now supports deploying multiple EKS clusters in the same AWS region without resource naming conflicts.

## Changes Made

### 1. Cluster-Specific Resource Naming

IAM roles now use the cluster name (`var.name`) as a prefix to ensure uniqueness:

- **IAM Roles**: `${cluster_name}-${region}-${service}`
  - EFS CSI Driver: `${cluster_name}-${region}-efs-csi-driver`
  - External DNS: `${cluster_name}-${region}-external-dns`

### 2. Known Limitations

The EKS Terraform module (version 21.3.1) does not support customizing:
- **KMS Alias**: Managed internally by the EKS module
- **CloudWatch Log Group**: Managed internally by the EKS module

These resources will still use the default naming pattern from the EKS module. To deploy multiple clusters in the same region, you must:
1. Use different cluster names (via `var.name`)
2. Manually clean up KMS aliases and CloudWatch log groups between deployments if reusing the same cluster name

### 3. How to Deploy Multiple Clusters

You can now deploy multiple clusters in the same region by using different cluster names:

```bash
# First cluster
cd terraform
terraform workspace new cluster1
terraform apply -var="name=genai-on-eks-cluster1"

# Second cluster
terraform workspace new cluster2
terraform apply -var="name=genai-on-eks-cluster2"
```

Or using different workspace directories:

```bash
# First cluster
cd terraform
export TF_WORKSPACE=ap-northeast-2
terraform apply -var="name=demo-cluster-1"

# Second cluster (in a different terminal or after first completes)
export TF_WORKSPACE=ap-northeast-2-test
terraform apply -var="name=demo-cluster-2"
```

### 3. Resource Naming Pattern

IAM roles follow this pattern:

```
{cluster_name}-{region}-{resource_type}
```

Examples:
- `demo-cluster-1-ap-northeast-2-efs-csi-driver`
- `demo-cluster-2-ap-northeast-2-external-dns`

**Note**: KMS aliases and CloudWatch log groups are managed by the EKS module and may still conflict if you reuse the same cluster name.

### 4. Backward Compatibility

Existing clusters with the default name `genai-on-eks` will continue to work without changes. The resource names will be:
- `genai-on-eks-ap-northeast-2-efs-csi-driver`
- `genai-on-eks-ap-northeast-2-external-dns`
- `/aws/eks/genai-on-eks/cluster`

### 5. Best Practices

1. **Use descriptive cluster names**: Choose names that clearly identify the purpose
   - `genai-on-eks-dev`
   - `genai-on-eks-test`
   - `genai-on-eks-prod`

2. **Use Terraform workspaces**: Separate state files for each cluster
   ```bash
   terraform workspace new dev
   terraform workspace new test
   terraform workspace new prod
   ```

3. **Document your clusters**: Keep track of which clusters are deployed in which regions

4. **Clean up unused clusters**: Remove old clusters to avoid unnecessary AWS costs
   ```bash
   terraform workspace select <workspace-name>
   terraform destroy
   ```

## Migration Guide

If you have an existing cluster and want to deploy a second one:

### Option 1: Keep existing cluster as-is, deploy new with different name

```bash
# Your existing cluster continues to work
# Deploy new cluster with different name
cd terraform
terraform workspace new test-cluster
terraform apply -var="name=genai-on-eks-test"
```

### Option 2: Rename existing cluster (requires recreation)

⚠️ **Warning**: This will destroy and recreate your cluster

```bash
# Destroy existing cluster
terraform destroy

# Clean up state
rm -rf .terraform terraform.tfstate* workspaces/

# Deploy with new name
terraform init
terraform workspace new prod
terraform apply -var="name=genai-on-eks-prod"
```

## Troubleshooting

### Resource Already Exists Error

If you still see "resource already exists" errors:

1. Check if resources from a previous cluster still exist:
   ```bash
   # Check KMS aliases
   aws kms list-aliases --region <region> | grep eks
   
   # Check CloudWatch log groups
   aws logs describe-log-groups --region <region> | grep eks
   
   # Check IAM roles
   aws iam list-roles | grep genai-on-eks
   ```

2. Manually delete conflicting resources:
   ```bash
   # Delete KMS alias (if needed)
   aws kms delete-alias --alias-name alias/eks/<old-cluster-name> --region <region>
   
   # Delete CloudWatch log group
   aws logs delete-log-group --log-group-name /aws/eks/<old-cluster-name>/cluster --region <region>
   
   # Delete IAM roles
   aws iam delete-role --role-name <old-cluster-name>-<region>-efs-csi-driver
   aws iam delete-role --role-name <old-cluster-name>-<region>-external-dns
   ```

3. Clean Terraform state:
   ```bash
   rm -rf .terraform terraform.tfstate* workspaces/
   terraform init
   ```

## Related Issues

- Fixes: https://github.com/aws-samples/sample-genai-on-eks-starter-kit/issues/85
