---
title: "Platform Setup"
weight: 31
duration: "45 minutes"
---

# Platform Setup

In this section, you'll deploy the core infrastructure components for your GenAI platform on Amazon EKS.

## Platform Architecture Components

Our platform consists of several key components:

- **Database Layer**: PostgreSQL for metadata and observability data
- **Caching Layer**: Redis for session management and caching
- **Storage Layer**: EFS for shared model storage
- **Networking**: Load balancers and ingress controllers
- **Security**: RBAC, network policies, and secrets management

## Prerequisites

Before starting, ensure you have:
- EKS cluster with sufficient node capacity
- kubectl configured for your cluster
- Helm installed
- AWS Load Balancer Controller installed

## Step 1: Install Core Dependencies

### Install AWS Load Balancer Controller
```bash
# Add the EKS Helm repository
helm repo add eks https://aws.github.io/eks-charts
helm repo update

# Install AWS Load Balancer Controller
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=<your-cluster-name> \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

### Install Cert-Manager
```bash
# Install cert-manager for TLS certificate management
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version v1.13.0 \
  --set installCRDs=true
```

## Step 2: Deploy Storage Infrastructure

### PostgreSQL Database
```yaml
# postgres-deployment.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: postgres-config
  namespace: genai-platform
data:
  POSTGRES_DB: genai_platform
  POSTGRES_USER: genai_user
  POSTGRES_PASSWORD: genai_password
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: genai-platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15
        ports:
        - containerPort: 5432
        envFrom:
        - configMapRef:
            name: postgres-config
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
      volumes:
      - name: postgres-storage
        persistentVolumeClaim:
          claimName: postgres-pvc
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: genai-platform
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres-service
  namespace: genai-platform
spec:
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
```

### Redis Cache
```yaml
# redis-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: genai-platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
        command:
        - redis-server
        - "--appendonly"
        - "yes"
        volumeMounts:
        - name: redis-storage
          mountPath: /data
      volumes:
      - name: redis-storage
        persistentVolumeClaim:
          claimName: redis-pvc
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: redis-pvc
  namespace: genai-platform
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
apiVersion: v1
kind: Service
metadata:
  name: redis-service
  namespace: genai-platform
spec:
  selector:
    app: redis
  ports:
  - port: 6379
    targetPort: 6379
```

## Step 3: Deploy Platform Components

### Create Namespace
```bash
# Create dedicated namespace for platform components
kubectl create namespace genai-platform
```

### Deploy Core Components
```bash
# Deploy PostgreSQL
kubectl apply -f postgres-deployment.yaml

# Deploy Redis
kubectl apply -f redis-deployment.yaml

# Verify deployments
kubectl get pods -n genai-platform
kubectl get services -n genai-platform
```

## Step 4: Configure Ingress and Load Balancing

### Application Load Balancer
```yaml
# alb-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: genai-platform-ingress
  namespace: genai-platform
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/healthcheck-path: /health
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:region:account:certificate/cert-id
spec:
  rules:
  - host: genai-platform.example.com
    http:
      paths:
      - path: /langfuse
        pathType: Prefix
        backend:
          service:
            name: langfuse-service
            port:
              number: 3000
      - path: /litellm
        pathType: Prefix
        backend:
          service:
            name: litellm-service
            port:
              number: 4000
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend-service
            port:
              number: 3000
```

## Step 5: Modern Security Configuration

### Pod Identity Setup (Recommended Approach)

#### 1. Enable Pod Identity on EKS Cluster
```bash
# Enable Pod Identity add-on
aws eks create-addon \
  --cluster-name <your-cluster-name> \
  --addon-name eks-pod-identity-agent \
  --resolve-conflicts OVERWRITE

# Verify Pod Identity is enabled
aws eks describe-addon \
  --cluster-name <your-cluster-name> \
  --addon-name eks-pod-identity-agent
```

#### 2. Create IAM Role for GenAI Platform
```json
# genai-platform-trust-policy.json
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
# Create IAM role
aws iam create-role \
  --role-name GenAI-Platform-Role \
  --assume-role-policy-document file://genai-platform-trust-policy.json

# Attach policies
aws iam attach-role-policy \
  --role-name GenAI-Platform-Role \
  --policy-arn arn:aws:iam::aws:policy/AmazonRDSDataFullAccess

aws iam attach-role-policy \
  --role-name GenAI-Platform-Role \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
```

#### 3. Create Custom IAM Policy for GenAI Workloads
```json
# genai-platform-policy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:ListFoundationModels",
        "bedrock:GetFoundationModel"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::genai-platform-models",
        "arn:aws:s3:::genai-platform-models/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:CreateSecret",
        "secretsmanager:UpdateSecret"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:genai-platform/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:*:*:key/*"
    },
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
    }
  ]
}
```

```bash
# Create and attach custom policy
aws iam create-policy \
  --policy-name GenAI-Platform-Policy \
  --policy-document file://genai-platform-policy.json

aws iam attach-role-policy \
  --role-name GenAI-Platform-Role \
  --policy-arn arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/GenAI-Platform-Policy
```

#### 4. Configure Pod Identity Association
```bash
# Create Pod Identity association
aws eks create-pod-identity-association \
  --cluster-name <your-cluster-name> \
  --namespace genai-platform \
  --service-account genai-platform-sa \
  --role-arn arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/GenAI-Platform-Role
```

### AWS Controllers for Kubernetes (ACK) Setup

#### 1. Install ACK Controllers
```bash
# Install ACK RDS Controller
helm repo add aws-controllers-k8s https://aws-controllers-k8s.github.io/ec2-charts
helm repo update

# Install RDS Controller
helm install ack-rds-controller \
  aws-controllers-k8s/rds-chart \
  --namespace ack-rds \
  --create-namespace \
  --set aws.region=us-west-2

# Install S3 Controller
helm install ack-s3-controller \
  aws-controllers-k8s/s3-chart \
  --namespace ack-s3 \
  --create-namespace \
  --set aws.region=us-west-2
```

#### 2. Configure ACK Controllers with Pod Identity
```yaml
# ack-rds-service-account.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ack-rds-controller
  namespace: ack-rds
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/ACK-RDS-Controller-Role
---
# Update RDS controller deployment to use service account
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ack-rds-controller
  namespace: ack-rds
spec:
  template:
    spec:
      serviceAccountName: ack-rds-controller
```

### Modern Service Account Configuration

```yaml
# modern-rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: genai-platform-sa
  namespace: genai-platform
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/GenAI-Platform-Role
---
# Kubernetes RBAC (for K8s resources only)
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: genai-platform-role
rules:
- apiGroups: [""]
  resources: ["pods", "services", "configmaps", "secrets"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["rds.services.k8s.aws"]
  resources: ["dbinstances", "dbclusters"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["s3.services.k8s.aws"]
  resources: ["buckets"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: genai-platform-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: genai-platform-role
subjects:
- kind: ServiceAccount
  name: genai-platform-sa
  namespace: genai-platform
```

### ACK-managed PostgreSQL Database

```yaml
# ack-postgres-deployment.yaml
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
  dbName: genai_platform
  masterUsername: genai_admin
  masterUserPassword:
    name: postgres-credentials
    key: password
  vpcSecurityGroupIds:
  - sg-xxxxxxxxx
  dbSubnetGroupName: genai-platform-subnet-group
  backupRetentionPeriod: 7
  deletionProtection: true
  tags:
    Environment: production
    Application: genai-platform
---
apiVersion: v1
kind: Secret
metadata:
  name: postgres-credentials
  namespace: genai-platform
type: Opaque
data:
  password: <base64-encoded-password>
```

### Updated LangFuse Deployment with Pod Identity

```yaml
# langfuse-deployment-modern.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: langfuse-server
  namespace: genai-platform
spec:
  replicas: 2
  selector:
    matchLabels:
      app: langfuse-server
  template:
    metadata:
      labels:
        app: langfuse-server
    spec:
      serviceAccountName: genai-platform-sa
      containers:
      - name: langfuse
        image: langfuse/langfuse:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: langfuse-config
              key: database_url
        - name: NEXTAUTH_SECRET
          valueFrom:
            secretKeyRef:
              name: langfuse-config
              key: nextauth_secret
        # Pod Identity automatically provides AWS credentials
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 1000m
            memory: 2Gi
        securityContext:
          runAsNonRoot: true
          runAsUser: 1000
          allowPrivilegeEscalation: false
          capabilities:
            drop:
            - ALL
          readOnlyRootFilesystem: true
        livenessProbe:
          httpGet:
            path: /api/public/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/public/health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

### Network Security with Network Policies

```yaml
# network-policy-modern.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: genai-platform-network-policy
  namespace: genai-platform
spec:
  podSelector:
    matchLabels:
      app: langfuse-server
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: genai-platform
    - podSelector:
        matchLabels:
          app: litellm-gateway
    ports:
    - protocol: TCP
      port: 3000
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          name: genai-platform
    - podSelector:
        matchLabels:
          app: postgres
    ports:
    - protocol: TCP
      port: 5432
  - to: []
    ports:
    - protocol: TCP
      port: 443  # HTTPS to AWS services
    - protocol: TCP
      port: 53   # DNS
    - protocol: UDP
      port: 53   # DNS
```

## Step 6: Security Validation

### Verify Pod Identity Configuration
```bash
# Check Pod Identity associations
aws eks list-pod-identity-associations --cluster-name <your-cluster-name>

# Verify service account annotations
kubectl get serviceaccount genai-platform-sa -n genai-platform -o yaml

# Test AWS access from pod
kubectl run -it --rm test-pod \
  --image=amazon/aws-cli \
  --serviceaccount=genai-platform-sa \
  --namespace=genai-platform \
  -- aws sts get-caller-identity
```

### Security Monitoring
```bash
# Monitor security events
kubectl get events --field-selector reason=FailedMount -n genai-platform

# Check Pod Security Standards
kubectl get pods -n genai-platform -o jsonpath='{.items[*].spec.securityContext}'

# Validate network policies
kubectl get networkpolicies -n genai-platform
```

## Step 7: Deployment Verification

### Run Deployment Script
```bash
# deploy-platform.sh
#!/bin/bash

echo "Deploying GenAI Platform Infrastructure..."

# Create namespace
kubectl create namespace genai-platform --dry-run=client -o yaml | kubectl apply -f -

# Deploy RBAC
kubectl apply -f rbac.yaml

# Deploy storage components
kubectl apply -f postgres-deployment.yaml
kubectl apply -f redis-deployment.yaml

# Deploy network policies
kubectl apply -f network-policy.yaml

# Deploy health checks
kubectl apply -f health-check.yaml

# Deploy ingress
kubectl apply -f alb-ingress.yaml

echo "Waiting for deployments to be ready..."
kubectl wait --for=condition=ready pod -l app=postgres -n genai-platform --timeout=300s
kubectl wait --for=condition=ready pod -l app=redis -n genai-platform --timeout=300s
kubectl wait --for=condition=ready pod -l app=health-check -n genai-platform --timeout=300s

echo "Platform infrastructure deployed successfully!"
echo "Checking health status..."
kubectl port-forward svc/health-check-service 8080:8080 -n genai-platform &
sleep 5
curl http://localhost:8080/health
```

### Verify Platform Status
```bash
# Check all platform components
kubectl get all -n genai-platform

# Check persistent volumes
kubectl get pvc -n genai-platform

# Check ingress
kubectl get ingress -n genai-platform

# Test connectivity
kubectl exec -it deployment/postgres -n genai-platform -- psql -U genai_user -d genai_platform -c "SELECT 1;"
kubectl exec -it deployment/redis -n genai-platform -- redis-cli ping
```

## Troubleshooting

### Common Issues

1. **Pod Stuck in Pending State**
   ```bash
   kubectl describe pod <pod-name> -n genai-platform
   # Check for resource constraints or node selector issues
   ```

2. **PVC Not Bound**
   ```bash
   kubectl get pvc -n genai-platform
   kubectl describe pvc <pvc-name> -n genai-platform
   # Check storage class and available storage
   ```

3. **Service Not Accessible**
   ```bash
   kubectl get svc -n genai-platform
   kubectl port-forward svc/<service-name> <local-port>:<service-port> -n genai-platform
   ```

## Next Steps

With the platform infrastructure in place, you're ready to add observability capabilities with [LangFuse](/module2-genai-components/observability/). 