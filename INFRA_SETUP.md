## Infrastructure Setup

Several AWS services and Kubernetes components are being provisioned by the main Terraform code under the `terraform` folder.

### AWS Services

- One VPC with private/public subnets and single NAT gateway
- One EKS Auto Mode cluster
- One EFS file system for caching Hugging Face models and etc
- One ACM wildcard certificate for the provided domin

### Kubenertes Components

- Setup Ingress to provision the shared ALB
- Setup ExternalDNS to manage the DNS records for the public facing services
- Setup Ingress NGINX Controller to use HTTP Basic authentication for some public facing services
- Setup EFS CSI driver
- Setup StorageClass for EBS and EFS
