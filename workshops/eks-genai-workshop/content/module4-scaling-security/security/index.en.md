---
title: "Modern Security for GenAI on EKS"
weight: 51
duration: "45 minutes"
---

# Modern Security for GenAI on EKS

In this section, you'll implement a comprehensive security model using modern EKS practices, including Pod Identity, ACK controllers, and zero-trust security principles.

## Why Modern Security Matters

### GenAI-Specific Security Challenges

1. **Model Protection**: Proprietary models worth millions in R&D
2. **Data Privacy**: Sensitive training and inference data
3. **Prompt Injection**: Malicious prompts can compromise systems
4. **API Security**: High-value endpoints require strong protection
5. **Compliance**: GDPR, HIPAA, SOC2, and other regulations

### Security Evolution

The security landscape has evolved significantly:

```
Traditional Security (2020)     →    Modern Security (2024)
├── Static credentials          →    Pod Identity
├── Manual resource mgmt        →    ACK Controllers
├── Basic RBAC                  →    Fine-grained policies
├── Simple secrets              →    AWS Secrets Manager
├── Basic network policies      →    Zero-trust networking
└── Limited monitoring          →    Comprehensive observability
```

## Pod Identity Implementation

### Step 1: Enable Pod Identity

```bash
# Enable Pod Identity add-on
aws eks create-addon \
  --cluster-name genai-workshop-cluster \
  --addon-name eks-pod-identity-agent \
  --resolve-conflicts OVERWRITE

# Verify installation
aws eks describe-addon \
  --cluster-name genai-workshop-cluster \
  --addon-name eks-pod-identity-agent
```

### Step 2: Create GenAI-Specific IAM Roles

#### Core Platform Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "pods.eks.amazonaws.com"
      },
      "Action": [
        "sts:AssumeRole",
        "sts:TagSession"
      ]
    }
  ]
}
```

```bash
# Create core platform role
aws iam create-role \
  --role-name GenAI-Platform-Core \
  --assume-role-policy-document file://pod-identity-trust-policy.json

# Attach base policies
aws iam attach-role-policy \
  --role-name GenAI-Platform-Core \
  --policy-arn arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy
```

#### Model Serving Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::genai-models-secure",
        "arn:aws:s3:::genai-models-secure/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "bedrock:inferenceProfile": "genai-approved-models"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:*:*:key/*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "s3.*.amazonaws.com"
        }
      }
    }
  ]
}
```

#### Observability Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/genai-platform/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "cloudwatch:namespace": "GenAI/Platform"
        }
      }
    }
  ]
}
```

### Step 3: Configure Pod Identity Associations

```bash
# Create associations for different roles
aws eks create-pod-identity-association \
  --cluster-name genai-workshop-cluster \
  --namespace genai-platform \
  --service-account model-serving-sa \
  --role-arn arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/GenAI-Model-Serving

aws eks create-pod-identity-association \
  --cluster-name genai-workshop-cluster \
  --namespace genai-platform \
  --service-account observability-sa \
  --role-arn arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/GenAI-Observability
```

## ACK Controllers for AWS Resources

### Step 1: Install Required ACK Controllers

```bash
# Install ACK RDS Controller
helm repo add aws-controllers-k8s https://aws-controllers-k8s.github.io/ec2-charts
helm repo update

helm install ack-rds-controller \
  aws-controllers-k8s/rds-chart \
  --namespace ack-rds \
  --create-namespace \
  --set aws.region=us-west-2

# Install ACK Secrets Manager Controller
helm install ack-secretsmanager-controller \
  aws-controllers-k8s/secretsmanager-chart \
  --namespace ack-secretsmanager \
  --create-namespace \
  --set aws.region=us-west-2

# Install ACK S3 Controller
helm install ack-s3-controller \
  aws-controllers-k8s/s3-chart \
  --namespace ack-s3 \
  --create-namespace \
  --set aws.region=us-west-2
```

### Step 2: Configure ACK with Pod Identity

```yaml
# ack-controllers-rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ack-rds-controller
  namespace: ack-rds
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/ACK-RDS-Controller
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ack-secretsmanager-controller
  namespace: ack-secretsmanager
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/ACK-SecretsManager-Controller
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ack-s3-controller
  namespace: ack-s3
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/ACK-S3-Controller
```

### Step 3: Deploy Secure Database with ACK

```yaml
# secure-postgres-with-ack.yaml
apiVersion: secretsmanager.services.k8s.aws/v1alpha1
kind: Secret
metadata:
  name: genai-db-credentials
  namespace: genai-platform
spec:
  name: genai-platform/db-credentials
  description: "Database credentials for GenAI platform"
  secretString: |
    {
      "username": "genai_admin",
      "password": "$(openssl rand -base64 32)"
    }
  kmsKeyID: arn:aws:kms:us-west-2:ACCOUNT:key/KEY-ID
---
apiVersion: rds.services.k8s.aws/v1alpha1
kind: DBInstance
metadata:
  name: genai-platform-postgres
  namespace: genai-platform
spec:
  dbInstanceIdentifier: genai-platform-postgres
  dbInstanceClass: db.t3.medium
  engine: postgres
  engineVersion: "15.4"
  allocatedStorage: 100
  storageType: gp3
  storageEncrypted: true
  kmsKeyID: arn:aws:kms:us-west-2:ACCOUNT:key/KEY-ID
  dbName: genai_platform
  masterUsername: genai_admin
  masterUserPassword:
    name: genai-db-credentials
    key: password
  vpcSecurityGroupIds:
  - sg-xxxxxxxxx
  dbSubnetGroupName: genai-platform-subnet-group
  backupRetentionPeriod: 30
  deletionProtection: true
  monitoringInterval: 60
  enablePerformanceInsights: true
  performanceInsightsRetentionPeriod: 7
  tags:
    Environment: production
    Application: genai-platform
    SecurityLevel: high
    DataClassification: sensitive
```

## Zero-Trust Network Security

### Step 1: Network Segmentation

```yaml
# network-segmentation.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: model-serving-policy
  namespace: genai-platform
spec:
  podSelector:
    matchLabels:
      tier: model-serving
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: api-gateway
    ports:
    - protocol: TCP
      port: 8080
  egress:
  - to:
    - podSelector:
        matchLabels:
          tier: database
    ports:
    - protocol: TCP
      port: 5432
  - to: []
    ports:
    - protocol: TCP
      port: 443  # HTTPS to AWS services
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: observability-policy
  namespace: genai-platform
spec:
  podSelector:
    matchLabels:
      tier: observability
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: model-serving
    - podSelector:
        matchLabels:
          tier: api-gateway
    ports:
    - protocol: TCP
      port: 3000
  egress:
  - to:
    - podSelector:
        matchLabels:
          tier: database
    ports:
    - protocol: TCP
      port: 5432
  - to: []
    ports:
    - protocol: TCP
      port: 443
```

### Step 2: Pod Security Standards

```yaml
# pod-security-standards.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: genai-platform
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: secure-model-serving
  namespace: genai-platform
spec:
  replicas: 3
  selector:
    matchLabels:
      app: secure-model-serving
      tier: model-serving
  template:
    metadata:
      labels:
        app: secure-model-serving
        tier: model-serving
    spec:
      serviceAccountName: model-serving-sa
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: vllm
        image: vllm/vllm-openai:latest
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
        resources:
          requests:
            cpu: 2000m
            memory: 8Gi
            nvidia.com/gpu: 1
          limits:
            cpu: 4000m
            memory: 16Gi
            nvidia.com/gpu: 1
        env:
        - name: MODEL_NAME
          value: "meta-llama/Llama-2-7b-hf"
        - name: TRUST_REMOTE_CODE
          value: "false"
        - name: DISABLE_LOG_STATS
          value: "false"
        volumeMounts:
        - name: tmp-volume
          mountPath: /tmp
        - name: model-cache
          mountPath: /root/.cache
          readOnly: true
      volumes:
      - name: tmp-volume
        emptyDir:
          sizeLimit: 1Gi
      - name: model-cache
        emptyDir:
          sizeLimit: 10Gi
```

## Secrets Management

### Step 1: AWS Secrets Manager Integration

```yaml
# secrets-manager-integration.yaml
apiVersion: secretsmanager.services.k8s.aws/v1alpha1
kind: Secret
metadata:
  name: llm-api-keys
  namespace: genai-platform
spec:
  name: genai-platform/llm-api-keys
  description: "API keys for external LLM providers"
  secretString: |
    {
      "openai_api_key": "sk-...",
      "anthropic_api_key": "sk-ant-...",
      "cohere_api_key": "..."
    }
  kmsKeyID: arn:aws:kms:us-west-2:ACCOUNT:key/KEY-ID
---
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secrets-manager
  namespace: genai-platform
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-west-2
      auth:
        jwt:
          serviceAccountRef:
            name: observability-sa
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: llm-api-keys-external
  namespace: genai-platform
spec:
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: llm-api-keys
    creationPolicy: Owner
  data:
  - secretKey: openai_api_key
    remoteRef:
      key: genai-platform/llm-api-keys
      property: openai_api_key
  - secretKey: anthropic_api_key
    remoteRef:
      key: genai-platform/llm-api-keys
      property: anthropic_api_key
```

### Step 2: Encryption at Rest and in Transit

```yaml
# encryption-configuration.yaml
apiVersion: v1
kind: Secret
metadata:
  name: tls-certificates
  namespace: genai-platform
type: kubernetes.io/tls
data:
  tls.crt: LS0tLS1CRUdJTi... # Base64 encoded certificate
  tls.key: LS0tLS1CRUdJTi... # Base64 encoded private key
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: genai-platform-ingress
  namespace: genai-platform
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/ssl-redirect: "443"
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-west-2:ACCOUNT:certificate/CERT-ID
    alb.ingress.kubernetes.io/ssl-policy: ELBSecurityPolicy-TLS-1-2-2017-01
spec:
  tls:
  - hosts:
    - genai-platform.example.com
    secretName: tls-certificates
  rules:
  - host: genai-platform.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: genai-platform-service
            port:
              number: 443
```

## Security Monitoring and Alerting

### Step 1: Security Monitoring Setup

```yaml
# security-monitoring.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: security-monitoring-config
  namespace: genai-platform
data:
  fluent-bit.conf: |
    [SERVICE]
        Flush         5
        Log_Level     info
        Daemon        off
        Parsers_File  parsers.conf
        HTTP_Server   On
        HTTP_Listen   0.0.0.0
        HTTP_Port     2020
    
    [INPUT]
        Name              tail
        Path              /var/log/containers/*genai-platform*.log
        multiline.parser  docker, cri
        Tag               kube.*
        Mem_Buf_Limit     50MB
        Skip_Long_Lines   On
    
    [FILTER]
        Name                kubernetes
        Match               kube.*
        Keep_Log            Off
        K8S-Logging.Parser  On
        K8S-Logging.Exclude On
    
    [FILTER]
        Name    grep
        Match   kube.*
        Regex   log (ERROR|WARN|security|authentication|authorization)
    
    [OUTPUT]
        Name                 cloudwatch_logs
        Match                kube.*
        region               us-west-2
        log_group_name       /genai-platform/security-logs
        log_stream_prefix    security-
        auto_create_group    On
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: security-monitoring
  namespace: genai-platform
spec:
  selector:
    matchLabels:
      app: security-monitoring
  template:
    metadata:
      labels:
        app: security-monitoring
    spec:
      serviceAccountName: observability-sa
      containers:
      - name: fluent-bit
        image: fluent/fluent-bit:latest
        volumeMounts:
        - name: config
          mountPath: /fluent-bit/etc/
        - name: varlog
          mountPath: /var/log
        - name: varlibdockercontainers
          mountPath: /var/lib/docker/containers
          readOnly: true
      volumes:
      - name: config
        configMap:
          name: security-monitoring-config
      - name: varlog
        hostPath:
          path: /var/log
      - name: varlibdockercontainers
        hostPath:
          path: /var/lib/docker/containers
```

### Step 2: AlertManager Configuration

```yaml
# alertmanager-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: alertmanager-config
  namespace: genai-platform
data:
  alertmanager.yml: |
    global:
      smtp_smarthost: 'localhost:587'
      smtp_from: 'alerts@genai-platform.com'
    
    route:
      group_by: ['alertname']
      group_wait: 10s
      group_interval: 10s
      repeat_interval: 1h
      receiver: 'web.hook'
      routes:
      - match:
          alertname: SecurityViolation
        receiver: security-team
      - match:
          alertname: HighResourceUsage
        receiver: ops-team
    
    receivers:
    - name: 'web.hook'
      webhook_configs:
      - url: 'http://127.0.0.1:5001/'
    
    - name: 'security-team'
      email_configs:
      - to: 'security@company.com'
        subject: 'Security Alert: {{ .GroupLabels.alertname }}'
        body: |
          Alert: {{ .GroupLabels.alertname }}
          Description: {{ range .Alerts }}{{ .Annotations.description }}{{ end }}
          Details: {{ range .Alerts }}{{ .Annotations.summary }}{{ end }}
    
    - name: 'ops-team'
      slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#genai-ops'
        title: 'GenAI Platform Alert'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
```

## Compliance and Audit

### Step 1: Audit Logging Configuration

```yaml
# audit-logging.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: audit-policy
  namespace: kube-system
data:
  audit-policy.yaml: |
    apiVersion: audit.k8s.io/v1
    kind: Policy
    rules:
    - level: RequestResponse
      namespaces: ["genai-platform"]
      resources:
      - group: ""
        resources: ["secrets", "configmaps"]
      - group: "apps"
        resources: ["deployments", "daemonsets"]
    - level: Request
      namespaces: ["genai-platform"]
      resources:
      - group: ""
        resources: ["pods", "services"]
    - level: Metadata
      omitStages:
      - RequestReceived
      resources:
      - group: ""
        resources: ["events"]
```

### Step 2: Compliance Monitoring

```bash
# compliance-check.sh
#!/bin/bash

echo "Running GenAI Platform Compliance Check..."

# Check Pod Security Standards
echo "Checking Pod Security Standards..."
kubectl get namespaces -o json | jq -r '.items[] | select(.metadata.name=="genai-platform") | .metadata.labels'

# Check Network Policies
echo "Checking Network Policies..."
kubectl get networkpolicies -n genai-platform

# Check RBAC
echo "Checking RBAC Configuration..."
kubectl get rolebindings,clusterrolebindings -n genai-platform

# Check Secrets
echo "Checking Secrets Management..."
kubectl get secrets -n genai-platform -o json | jq -r '.items[] | select(.type=="kubernetes.io/tls") | .metadata.name'

# Check Resource Quotas
echo "Checking Resource Quotas..."
kubectl get resourcequotas -n genai-platform

# Check Pod Security Context
echo "Checking Pod Security Contexts..."
kubectl get pods -n genai-platform -o json | jq -r '.items[] | "\(.metadata.name): \(.spec.securityContext)"'

echo "Compliance check completed."
```

## Lab Exercise: Implementing Zero-Trust Security

### Step 1: Deploy Secure GenAI Application

```bash
# Deploy the complete secure application
kubectl apply -f secure-postgres-with-ack.yaml
kubectl apply -f pod-security-standards.yaml
kubectl apply -f network-segmentation.yaml
kubectl apply -f secrets-manager-integration.yaml
kubectl apply -f security-monitoring.yaml
```

### Step 2: Test Security Controls

```bash
# Test network policies
kubectl run test-pod --image=busybox --rm -it -- wget -qO- http://secure-model-serving:8080/health

# Test Pod Identity
kubectl run test-pod --image=amazon/aws-cli --rm -it --serviceaccount=model-serving-sa -- aws sts get-caller-identity

# Test secrets access
kubectl exec -it deployment/secure-model-serving -- env | grep -E "(OPENAI|ANTHROPIC)"
```

### Step 3: Validate Compliance

```bash
# Run compliance check
./compliance-check.sh

# Check audit logs
aws logs describe-log-groups --log-group-name-prefix="/genai-platform"

# Verify encryption
kubectl get secrets -n genai-platform -o json | jq -r '.items[] | select(.type=="kubernetes.io/tls")'
```

## Best Practices

1. **Least Privilege**: Grant minimum required permissions
2. **Regular Audits**: Continuous security assessments
3. **Encryption Everywhere**: Encrypt data at rest and in transit
4. **Network Segmentation**: Isolate sensitive workloads
5. **Monitoring**: Comprehensive security monitoring
6. **Incident Response**: Prepared response procedures

## Next Steps

With security implemented, let's move on to [Distributed Inference](/module4-scaling-security/distributed-inference/) to learn about scaling your GenAI platform. 