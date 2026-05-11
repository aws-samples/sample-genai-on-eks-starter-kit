# Security Considerations

This page documents security considerations for the GenAI on EKS Starter Kit based on Checkov security scans. The project is designed for demonstration and learning purposes, prioritizing ease of experimentation over production-grade security.

!!! warning "Demonstration Purpose"
    This repository is intended for **demonstration and learning purposes only**. It is **not** intended for production use without proper security hardening, testing, and validation.

---

## Checkov Security Scans

Our code is continuously scanned using [Checkov](https://www.checkov.io/5.Policy%20Index/kubernetes.html) to identify security considerations. Below are documented exceptions with explanations and recommendations for production deployments.

---

## Security Checks

### CKV_TF_1: Terraform Module Source Commit Hash

**Check:** Ensure Terraform module sources use a commit hash

**Current Implementation:** We specify module versions instead of commit hashes for ease of experimentation.

**Reasoning:** Version pinning provides a balance between stability and ease of updates during development and learning.

**Production Recommendation:** Use commit hashes for Terraform modules to prevent supply chain attacks:

```hcl
# Development (current)
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"
}

# Production (recommended)
module "vpc" {
  source = "git::https://github.com/terraform-aws-modules/terraform-aws-vpc.git?ref=abc123def456"
}
```

**Why commit hashes matter:** Module registries can be compromised. Commit hashes provide immutable references. [Read more about supply chain vulnerabilities](https://medium.com/boostsecurity/erosion-of-trust-unmasking-supply-chain-vulnerabilities-in-the-terraform-registry-2af48a7eb2).

---

### CKV_SECRET_6: Base64 High Entropy String

**Check:** Detects Base64-encoded, high-entropy strings

**Current Implementation:** Kubernetes secrets contain Base64-encoded values (required by Kubernetes).

**Reasoning:** All values under the `data` field in Kubernetes secrets must be Base64-encoded per Kubernetes specification. This is expected and correct behavior.

**Impact:** This check produces expected false positives for all Kubernetes secret resources.

**Production Recommendation:**
- Store secrets outside version control
- Use AWS Secrets Manager or HashiCorp Vault
- Enable encryption at rest for secrets in etcd
- Rotate secrets regularly

```bash
# Example: Store in AWS Secrets Manager instead of K8s Secret
aws secretsmanager create-secret \
  --name litellm-api-key \
  --secret-string "sk-1234567890abcdef"
```

---

### CKV2_K8S_6: Network Policy

**Check:** Minimize admission of pods which lack an associated NetworkPolicy

**Current Implementation:** All pod-to-pod communication is allowed by default.

**Reasoning:** Simplifies experimentation and debugging by avoiding network connectivity issues during learning.

**Production Recommendation:** Implement NetworkPolicies to segment traffic:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: litellm-netpol
  namespace: litellm
spec:
  podSelector:
    matchLabels:
      app: litellm
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: openwebui
    ports:
    - protocol: TCP
      port: 4000
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          name: vllm
    ports:
    - protocol: TCP
      port: 8000
```

Amazon VPC CNI supports [Kubernetes Network Policies](https://aws.amazon.com/blogs/containers/amazon-vpc-cni-now-supports-kubernetes-network-policies/).

---

### CKV_K8S_8: Liveness Probe

**Check:** Liveness probe should be configured

**Current Implementation:** No liveness probes configured.

**Reasoning:** Simplifies deployment and avoids unnecessary pod restarts during experimentation.

**Production Recommendation:** Implement health checks for automatic recovery:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

[Learn more about liveness probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/).

---

### CKV_K8S_9: Readiness Probe

**Check:** Readiness probe should be configured

**Current Implementation:** No readiness probes configured.

**Reasoning:** Simplifies deployment and allows immediate traffic routing during experimentation.

**Production Recommendation:** Implement readiness probes to prevent traffic to unhealthy pods:

```yaml
readinessProbe:
  httpGet:
    path: /v1/models
    port: 8000
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  successThreshold: 1
  failureThreshold: 3
```

[Learn more about readiness probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/).

---

### CKV_K8S_11: CPU Limits

**Check:** CPU limits should be set

**Current Implementation:** CPU limits not configured on containers.

**Reasoning:** Allows maximum performance during model inference without artificial constraints.

**Production Recommendation:** Set CPU limits to prevent resource exhaustion:

```yaml
resources:
  requests:
    cpu: "1000m"
    memory: "2Gi"
  limits:
    cpu: "4000m"
    memory: "4Gi"
```

**Considerations:**
- GPU workloads are primarily memory-bound
- CPU limits can cause throttling
- Monitor actual usage before setting limits

[Learn more about resource management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/).

---

### CKV_K8S_22: Read-Only Root Filesystem

**Check:** Use read-only filesystem for containers where possible

**Current Implementation:** Containers use read-write root filesystems.

**Reasoning:** Some workloads require write access for model caching, temporary files, and runtime data.

**Production Recommendation:** Enable read-only root filesystem where possible:

```yaml
securityContext:
  readOnlyRootFilesystem: true
volumeMounts:
- name: tmp
  mountPath: /tmp
- name: cache
  mountPath: /root/.cache
volumes:
- name: tmp
  emptyDir: {}
- name: cache
  emptyDir: {}
```

[Configure read-only root filesystem](https://docs.aws.amazon.com/eks/latest/best-practices/pod-security.html#_configure_your_images_with_read_only_root_file_system).

---

### CKV_K8S_23: Non-Root Containers

**Check:** Minimize the admission of root containers

**Current Implementation:** Containers run as root (default).

**Reasoning:** Ensures compatibility with demo images and simplifies troubleshooting during experimentation.

**Production Recommendation:** Run containers as non-root user:

```dockerfile
# In Dockerfile
RUN useradd -m -u 1000 appuser
USER 1000:1000
```

```yaml
# In Kubernetes manifest
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
```

[Learn more about non-root containers](https://docs.docker.com/engine/reference/builder/#user).

---

### CKV_K8S_35: Secrets as Files

**Check:** Prefer using secrets as files over environment variables

**Current Implementation:** Some secrets are passed as environment variables.

**Reasoning:** Simplifies demonstration and reduces configuration complexity.

**Production Recommendation:** Mount secrets as files instead of environment variables:

```yaml
# Instead of:
env:
- name: LITELLM_API_KEY
  valueFrom:
    secretKeyRef:
      name: litellm-secret
      key: api-key

# Use:
volumeMounts:
- name: secrets
  mountPath: /secrets
  readOnly: true
volumes:
- name: secrets
  secret:
    secretName: litellm-secret
```

**Why files are better:**
- Environment variables can leak in logs
- Files have stricter access controls
- Easier to rotate without restarting pods

[Learn more about secret best practices](https://kubernetes.io/docs/concepts/configuration/secret/#best-practices).

---

### CKV_K8S_37: Container Capabilities

**Check:** Minimize the admission of containers with capabilities assigned

**Current Implementation:** Some workloads require added capabilities (e.g., GPU access, network administration).

**Reasoning:** Required for GPU drivers and specialized hardware access.

**Production Recommendation:** Use minimal required capabilities:

```yaml
securityContext:
  capabilities:
    drop:
    - ALL
    add:
    - NET_BIND_SERVICE  # Only if needed
```

[Learn more about Linux capabilities](https://docs.aws.amazon.com/eks/latest/best-practices/pod-security.html#_linux_capabilities).

---

### CKV_K8S_40: High UID

**Check:** Containers should run as a high UID to avoid host conflict

**Current Implementation:** Publicly available container images use default UIDs.

**Reasoning:** Using upstream images as-is for easy access and reduced maintenance.

**Production Recommendation:** Build custom images with high UID:

```dockerfile
RUN useradd -m -u 10000 appuser
USER 10000:10000
```

```yaml
securityContext:
  runAsUser: 10000
  runAsGroup: 10000
```

[Learn more about security contexts](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/#set-the-security-context-for-a-pod).

---

### CKV_AWS_51: ECR Image Tag Immutability

**Check:** Ensure ECR image tags are immutable

**Current Implementation:** ECR repositories use mutable image tags.

**Reasoning:** Allows easy updates and experimentation with container images during development.

**Production Recommendation:** Enable image tag immutability:

```hcl
resource "aws_ecr_repository" "app" {
  name                 = "my-app"
  image_tag_mutability = "IMMUTABLE"
}
```

**Benefits:**
- Prevents accidental overwrites
- Ensures deployment consistency
- Supports rollback to exact previous versions

[Learn more about image tag immutability](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html).

---

### CKV_AWS_184: Customer-Managed KMS Keys

**Check:** Ensure resources are encrypted with customer-managed KMS keys

**Current Implementation:** Uses AWS managed keys for simplicity.

**Reasoning:** Reduces setup complexity and key management overhead for demonstration purposes.

**Production Recommendation:** Use customer-managed KMS keys:

```hcl
resource "aws_kms_key" "app" {
  description             = "Application encryption key"
  deletion_window_in_days = 7
  enable_key_rotation     = true
}

resource "aws_ebs_volume" "app" {
  kms_key_id = aws_kms_key.app.arn
  encrypted  = true
}
```

**Benefits:**
- Enhanced security control
- Audit key usage with CloudTrail
- Meet compliance requirements
- Control key rotation policy

[Learn more about customer-managed keys](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#customer-cmk).

---

### CKV_DOCKER_2: Dockerfile HEALTHCHECK

**Check:** Ensure HEALTHCHECK instructions are added to container images

**Current Implementation:** Container images lack explicit HEALTHCHECK instructions.

**Reasoning:** Relies on Kubernetes liveness/readiness probes instead of Docker-layer health checks.

**Production Recommendation:** Add HEALTHCHECK to Dockerfiles:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1
```

**Benefits:**
- Container-level health monitoring
- Works outside Kubernetes
- Complements Kubernetes probes

[Learn more about HEALTHCHECK](https://docs.docker.com/engine/reference/builder/#healthcheck).

---

### CKV_DOCKER_3: Non-Root Docker User

**Check:** Ensure that a user for the container has been created

**Current Implementation:** Containers run as default root user.

**Reasoning:** Ensures compatibility with demo images and avoids permission issues.

**Production Recommendation:** Create non-root user in Dockerfile:

```dockerfile
FROM python:3.12-slim

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -u 1000 appuser

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Switch to non-root user
USER appuser

COPY app.py .
CMD ["python", "app.py"]
```

[Learn more about non-root Docker users](https://docs.docker.com/engine/reference/builder/#user).

---

## Production Security Checklist

Before deploying to production, implement these security enhancements:

### Infrastructure

- [ ] Enable encryption at rest for EBS volumes with customer-managed KMS keys
- [ ] Enable encryption in transit for all services
- [ ] Use private subnets for worker nodes
- [ ] Implement VPC Flow Logs
- [ ] Enable CloudTrail for API auditing
- [ ] Use AWS Secrets Manager or HashiCorp Vault for secrets
- [ ] Enable ECR image scanning
- [ ] Enable ECR image tag immutability
- [ ] Implement backup and disaster recovery

### Kubernetes

- [ ] Implement NetworkPolicies for all namespaces
- [ ] Enable Pod Security Standards (Restricted)
- [ ] Configure liveness and readiness probes
- [ ] Set resource requests and limits
- [ ] Use read-only root filesystems where possible
- [ ] Run containers as non-root with high UIDs
- [ ] Mount secrets as files, not environment variables
- [ ] Minimize container capabilities
- [ ] Enable Kubernetes audit logging
- [ ] Implement RBAC with principle of least privilege

### Application

- [ ] Build custom images with security hardening
- [ ] Add HEALTHCHECK instructions to Dockerfiles
- [ ] Scan images for vulnerabilities (Trivy, Grype)
- [ ] Use multi-stage builds to reduce image size
- [ ] Pin dependency versions
- [ ] Remove unnecessary packages and files
- [ ] Sign container images
- [ ] Implement authentication and authorization
- [ ] Enable TLS for all internal communication
- [ ] Implement rate limiting and DDoS protection

### Monitoring & Compliance

- [ ] Set up security monitoring and alerting
- [ ] Implement log aggregation and analysis
- [ ] Enable AWS GuardDuty
- [ ] Enable AWS Security Hub
- [ ] Conduct regular security audits
- [ ] Perform penetration testing
- [ ] Document security procedures
- [ ] Create incident response plan
- [ ] Train team on security best practices

---

## Additional Security Resources

- [EKS Best Practices for Security](https://aws.github.io/aws-eks-best-practices/security/docs/)
- [Kubernetes Security Best Practices](https://kubernetes.io/docs/concepts/security/security-checklist/)
- [OWASP Kubernetes Top 10](https://owasp.org/www-project-kubernetes-top-ten/)
- [CIS Kubernetes Benchmark](https://www.cisecurity.org/benchmark/kubernetes)
- [NIST Application Container Security Guide](https://csrc.nist.gov/publications/detail/sp/800-190/final)

---

## Responsible Disclosure

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** create a public GitHub issue
2. Email the maintainers with details
3. Allow time for investigation and patching
4. Follow coordinated disclosure practices

See the repository root `SECURITY.md` for complete reporting guidelines.

---

## Disclaimer

!!! danger "Production Deployment"
    This project prioritizes ease of use for demonstration and learning. Before deploying to production:
    
    - Implement all security recommendations in this document
    - Conduct thorough security assessment
    - Perform penetration testing
    - Establish monitoring and incident response
    - Consult security professionals
    - Review and comply with organizational security policies
    
    **Use at your own risk.** The authors are not responsible for security incidents resulting from production deployment of this demonstration code.

---

## See Also

- [Configuration Guide](configuration.md)
- [CLI Commands Reference](cli-commands.md)
- [FAQ](faq.md)
