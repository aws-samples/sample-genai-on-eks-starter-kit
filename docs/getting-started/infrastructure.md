# Infrastructure Setup

The GenAI on EKS Starter Kit provisions AWS infrastructure and Kubernetes components using Terraform. All infrastructure code is located in the `terraform/` directory.

## AWS Services

The following AWS services are provisioned:

### VPC and Networking

- **VPC**: One Virtual Private Cloud with private and public subnets
- **NAT Gateway**: Single NAT gateway for outbound internet access from private subnets
- **Subnets**: Public and private subnets across multiple availability zones

### Amazon EKS

- **EKS Cluster**: One EKS cluster in Auto Mode (default) or Standard Mode
- **EKS_MODE**: Configure via environment variable
    - `auto` (default): EKS Auto Mode with managed compute
    - `standard`: Standard EKS with self-managed node groups

!!! info "EKS Auto Mode"
    EKS Auto Mode automatically provisions and manages compute resources, simplifying cluster operations and reducing operational overhead.

### Amazon EFS

- **EFS File System**: Shared file system for:
    - Caching Hugging Face models
    - Persistent storage for AI workloads
    - Compiled Neuron models for AWS Inferentia

The EFS file system is mounted to pods that require persistent storage.

### AWS Certificate Manager (ACM)

- **Wildcard Certificate**: Automatically provisioned for your domain
- **Domain Validation**: Uses DNS validation via Route 53
- **Coverage**: `*.<DOMAIN>` allows all subdomains

!!! note "Domain Requirement"
    ACM certificate is only created when `DOMAIN` is configured. Without a domain, services use HTTP with multiple ALBs.

## Kubernetes Components

The following Kubernetes components are deployed on the EKS cluster:

### Ingress and Load Balancing

**AWS Load Balancer Controller**

- Provisions shared Application Load Balancer (ALB)
- Manages ingress resources
- Integrates with ACM for TLS termination

**Ingress Configuration**

- **With Domain**: Single shared ALB with HTTPS
- **Without Domain**: Multiple ALBs with HTTP per service

### DNS Management

**ExternalDNS**

- Automatically creates Route 53 DNS records for services
- Syncs with Kubernetes ingress resources
- Manages records for public-facing services

!!! example "Automatic DNS Records"
    When you deploy LiteLLM, ExternalDNS automatically creates `litellm.<DOMAIN>` pointing to the ALB.

### Authentication

**Ingress NGINX Controller**

- Provides HTTP Basic authentication for services
- Used for services requiring access control:
    - Qdrant vector database
    - Milvus vector database
    - Monitoring dashboards

!!! warning "Domain Limitation"
    Without a domain, only one service with Nginx Ingress basic auth can be exposed due to multiple ALB limitations.

### Storage

**EFS CSI Driver**

- Enables EFS file system mounting in pods
- Provides persistent storage for AI models
- Supports ReadWriteMany access mode

**Storage Classes**

Two storage classes are configured:

| Storage Class | Type | Use Case |
|--------------|------|----------|
| `ebs-gp3` | EBS GP3 | Block storage for individual pods |
| `efs` | EFS | Shared storage across pods |

```yaml
# Example: Using EFS storage
persistentVolumeClaim:
  storageClass: efs
  size: 100Gi
```

## Infrastructure Management

### Terraform Workspaces

Multiple EKS clusters are supported using Terraform workspaces:

- Workspace name is derived from `REGION` and `EKS_CLUSTER_NAME`
- Each cluster has isolated Terraform state
- Switch clusters by changing environment variables

### Apply Infrastructure Changes

Apply Terraform changes manually:

```bash
./cli terraform apply
```

### View Infrastructure State

Check current Terraform state:

```bash
./cli terraform show
```

### Destroy Infrastructure

Remove all provisioned infrastructure:

```bash
./cli cleanup-infra
```

!!! danger "Destructive Operation"
    This destroys all AWS resources. Ensure you've backed up any data and uninstalled components first.

## GPU Instance Configuration

### Default Configuration

- **Instance Families**: g6e, g6, g5g
- **Purchasing Options**: Spot and On-Demand

### Customization

Modify `terraform/0-common.tf` to change:

- GPU instance families
- Purchasing options (Spot vs On-Demand)
- Instance size and count limits

```hcl
# Example: terraform/0-common.tf
variable "gpu_instance_families" {
  default = ["g6e", "g6", "g5g"]
}
```

After changes, apply the configuration:

```bash
./cli terraform apply
```

!!! note "Node Selectors"
    Model deployment manifests use `nodeSelector` to target specific instance families. Update manifests accordingly when changing instance families.

## AWS Neuron and Inferentia Support

For LLM inference on AWS Inferentia 2 instances:

1. Enable Neuron in configuration:

    ```json
    // config.json or config.local.json
    {
      "enableNeuron": true
    }
    ```

2. Reinstall the component:

    ```bash
    ./cli llm-model vllm install
    ```

    This builds and pushes the vLLM Neuron container image to ECR (20-30 minutes).

3. First deployment compiles the model (20-30 minutes)
4. Compiled models are cached on EFS for subsequent deployments

### INT8 Quantization on inf2.xlarge

Models like Llama-3.1-8B-Instruct support INT8 quantization for single inf2.xlarge, but require inf2.8xlarge for compilation:

1. Deploy with compilation enabled (uses inf2.8xlarge)
2. Change `"compile": true` to `"compile": false` in config
3. Delete and redeploy (uses inf2.xlarge)

## ECR Pull Through Cache

Cache external container images in your private ECR registry.

### Default: Disabled

ECR Pull Through Cache is disabled by default to avoid storage costs.

### When to Enable

- Hitting Docker Hub rate limits
- Require faster, more reliable pulls from within AWS
- Organization policies require private registry storage

### Configuration

1. Get Docker Hub credentials:
    - Create account at [hub.docker.com](https://hub.docker.com)
    - Generate access token at [Security Settings](https://hub.docker.com/settings/security)

2. Get GitHub credentials:
    - Generate Personal Access Token at [GitHub Settings](https://github.com/settings/tokens)
    - Requires `read:packages` scope

3. Configure in `config.local.json`:

    ```json
    {
      "terraform": {
        "vars": {
          "enable_ecr_pull_through_cache": true,
          "dockerhub_username": "your-username",
          "dockerhub_access_token": "your-token",
          "github_username": "your-username",
          "github_token": "your-token"
        }
      }
    }
    ```

4. Apply changes:

    ```bash
    ./cli terraform apply
    ```

### Supported Registries

- `vllm/*` → Docker Hub
- `lmsysorg/*` → Docker Hub
- `ollama/*` → Docker Hub
- `huggingface/*` → GitHub Container Registry

!!! warning "Manual Cleanup Required"
    `terraform destroy` removes cache rules but not cached repositories. Manually delete repositories starting with `vllm/`, `lmsysorg/`, `ollama/`, or `huggingface/` from ECR.

## Multi-Cluster Management

Provision and manage multiple EKS clusters:

1. Change environment variables in `.env.local`:

    ```bash
    REGION=us-east-1
    EKS_CLUSTER_NAME=genai-dev
    DOMAIN=dev.example.com
    ```

2. Run setup:

    ```bash
    ./cli demo-setup
    ```

Terraform workspace and kubectl context automatically use the configured values.

## Next Steps

- Return to [Quick Start](quick-start.md) to deploy components
- Follow the [Demo Walkthrough](demo-walkthrough.md) to explore features
- Check [Security Considerations](../reference/security.md) for best practices
