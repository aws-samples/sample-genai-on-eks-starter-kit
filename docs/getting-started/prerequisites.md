# Prerequisites

Before you begin using the GenAI on EKS Starter Kit, ensure you have the following tools and access configured.

## Required Tools

Install these tools before proceeding with the setup:

### AWS CLI

The AWS Command Line Interface for interacting with AWS services.

[Install AWS CLI :octicons-arrow-right-24:](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html){ .md-button }

### Terraform

Infrastructure as Code tool for provisioning AWS resources.

[Install Terraform :octicons-arrow-right-24:](https://www.terraform.io/downloads){ .md-button }

### Node.js

JavaScript runtime required for the CLI tool and configuration management.

[Install Node.js :octicons-arrow-right-24:](https://nodejs.org/en/download){ .md-button }

### kubectl

Kubernetes command-line tool for cluster management.

[Install kubectl :octicons-arrow-right-24:](https://kubernetes.io/docs/tasks/tools){ .md-button }

### Helm

Package manager for Kubernetes applications.

[Install Helm :octicons-arrow-right-24:](https://helm.sh/docs/intro/install){ .md-button }

### Docker and Buildx

Container platform and multi-architecture build plugin.

- [Install Docker :octicons-arrow-right-24:](https://docs.docker.com/get-started/)
- [Install Buildx :octicons-arrow-right-24:](https://docs.docker.com/build/concepts/overview/#buildx)

!!! note "Multi-Architecture Builds"
    By default, `docker buildx` is used to build multi-arch container images. You can disable this by modifying the `docker` section in `config.json` or `config.local.json`.

## AWS Account Requirements

You'll need an AWS account with appropriate permissions to:

- Create VPC, subnets, and networking resources
- Provision EKS clusters and node groups
- Create EFS file systems
- Manage Route 53 hosted zones and DNS records
- Request and manage ACM certificates
- Create and manage ECR repositories
- Deploy EC2 instances (including GPU instances)

!!! warning "IAM Permissions"
    Ensure your AWS credentials have sufficient permissions to create and manage these resources. Administrator access is recommended for initial setup.

## Optional Components

### Hugging Face Account

Required if you plan to use models that require authentication.

- Create an account at [huggingface.co](https://huggingface.co)
- Generate a user access token at [Hugging Face Security Settings](https://huggingface.co/settings/tokens)

See [User access tokens documentation](https://huggingface.co/docs/hub/en/security-tokens) for more details.

### Route 53 Hosted Zone

A domain name configured with a Route 53 hosted zone is recommended but not required.

**With a domain:**

- Single shared ALB with HTTPS
- Wildcard ACM certificate
- Services exposed at `service.<DOMAIN>` (e.g., `litellm.example.com`)

**Without a domain:**

- Multiple ALBs with HTTP
- Individual ALB per public-facing service
- Limited to one service with Nginx Ingress basic auth

!!! tip "Domain Configuration"
    If you don't have a domain yet but plan to use one, set it up before running the initial configuration to avoid reconfiguration later.

## Verification

After installing all tools, verify they're available:

```bash
aws --version
terraform --version
node --version
kubectl version --client
helm version
docker --version
docker buildx version
```

All commands should return version information without errors.

## Next Steps

Once you have all prerequisites installed, proceed to the [Quick Start](quick-start.md) guide.
