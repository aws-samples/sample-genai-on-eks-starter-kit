# Dynamo Platform

NVIDIA Dynamo Platform provides orchestration, scheduling, and lifecycle management for LLM serving workloads. It includes CRDs, Operator, etcd, NATS, Grove KV Router, and KAI Scheduler.

| | |
|---|---|
| **Category** | nvidia-platform |
| **Official Docs** | [NVIDIA Dynamo Platform](https://docs.nvidia.com/dynamo/) |
| **CLI Install** | `./cli nvidia-platform dynamo-platform install` |
| **CLI Uninstall** | `./cli nvidia-platform dynamo-platform uninstall` |
| **Namespace** | `dynamo-system` |

## Overview

The Dynamo Platform is the control plane for NVIDIA's LLM serving infrastructure. It manages:
- **DynamoGraphDeployment (DGD)**: Declarative model deployment with aggregated/disaggregated modes
- **DynamoGraphDeploymentRequest (DGDR)**: SLA-driven auto-configuration and deployment
- **DynamoWorkerMetadata**: Worker state tracking and discovery
- **Grove**: KV-aware request routing
- **KAI Scheduler**: Intelligent GPU scheduling
- **etcd**: Service discovery and state storage
- **NATS**: Internal messaging bus

## Installation

```bash
./cli nvidia-platform dynamo-platform install
```

### Auto-Configuration

The installer automatically detects and configures:

| Component | Detection | Action |
|-----------|-----------|--------|
| Prometheus | `monitoring` installed | Auto-configure `prometheusEndpoint` |
| GPU Operator | Detected | Status check only |
| StorageClass (K8s) | `local-path` not found | Auto-install local-path-provisioner |
| Ingress (K8s) | Not found | Prompt to install |
| EFS (EKS) | Not found | Auto-install EFS CSI Driver + StorageClass |

### Platform-Specific Configuration

**K8s Mode**:
- Uses `nfs` StorageClass for model cache PVC (ReadWriteMany)
- Uses `local-path` for etcd/NATS persistence (ReadWriteOnce)
- Prompts to install `ingress-nginx` if not found

**EKS Mode**:
- Uses `efs` StorageClass for model cache PVC (ReadWriteMany)
- Auto-installs EFS CSI Driver if not found
- ALB Ingress annotations auto-added

## Verification

```bash
# Check Dynamo Platform pods
kubectl get pods -n dynamo-system

# Check CRDs
kubectl get crds | grep nvidia.com

# Check etcd cluster
kubectl get pods -n dynamo-system -l app.kubernetes.io/name=etcd

# Check NATS
kubectl get pods -n dynamo-system -l app.kubernetes.io/name=nats

# Check Dynamo Operator
kubectl logs -n dynamo-system -l app=dynamo-operator
```

Expected CRDs:
- `dynamographdeployments.nvidia.com`
- `dynamographdeploymentrequests.nvidia.com`
- `dynamoworkermetadatas.nvidia.com`

## Configuration

Configuration is managed through `config.json`:

```json
{
  "platform": {
    "k8s": {
      "storageClass": "nfs",
      "dynamoPlatform": {
        "releaseVersion": "0.9.0-post1",
        "namespace": "dynamo-system",
        "groveEnabled": true,
        "kaiSchedulerEnabled": true
      }
    },
    "eks": {
      "storageClass": "efs",
      "dynamoPlatform": {
        "releaseVersion": "0.9.1",
        "namespace": "dynamo-system",
        "groveEnabled": true,
        "kaiSchedulerEnabled": true
      }
    }
  }
}
```

## Storage Architecture

The Dynamo Platform uses two different StorageClasses:

| StorageClass | Purpose | Access Mode | Used By |
|--------------|---------|-------------|---------|
| `nfs` / `efs` | Model cache PVC | ReadWriteMany | Dynamo vLLM (model download) |
| `local-path` | etcd, NATS persistence | ReadWriteOnce | etcd, NATS StatefulSets |

## Components

### Dynamo Operator

The Operator reconciles `DynamoGraphDeployment` and `DynamoGraphDeploymentRequest` resources:
- Creates Frontend + Worker Deployments/StatefulSets
- Configures Prometheus PodMonitors
- Sets worker environment variables (DYN_SYSTEM_PORT, structured logging)
- Manages service discovery (etcd or kubernetes)

### etcd Cluster

Distributed key-value store for:
- Service discovery (preferred over kubernetes-native for KVBM stability)
- Worker metadata and health state
- Configuration coordination

### NATS

Lightweight messaging system for:
- Internal component communication
- Event-driven orchestration
- Worker state updates

### Grove KV Router

KV-aware request routing:
- Routes requests to workers with cached KV blocks
- Improves Time to First Token (TTFT)
- Configurable temperature and overlap scoring

### KAI Scheduler

Intelligent GPU scheduling for:
- Multi-instance GPU (MIG) workloads
- Fractional GPU allocation
- Resource optimization

## Discovery Backends

Dynamo Platform supports two discovery backends:

| Backend | Description | Use Case |
|---------|-------------|----------|
| `etcd` | External etcd cluster | **Recommended** for KVBM stability in multi-replica disaggregated mode |
| `kubernetes` | K8s-native discovery | Simpler setup, but may cause KVBM handshake failures |

The CLI defaults to `etcd` for all deployments. DGDR templates include `nvidia.com/dynamo-discovery-backend: etcd` annotation.

## Integration with Monitoring

When [Monitoring](monitoring.md) is installed before Dynamo Platform:
1. Installer detects Prometheus Service
2. Sets `--set prometheusEndpoint=http://prometheus-kube-prometheus-prometheus.monitoring:9090`
3. Dynamo Operator auto-creates PodMonitors
4. Worker metrics endpoint auto-configured at `:9090/metrics`

## Known Issues

### CRD Chart Version Mismatch (v0.9.0)

| Issue | Workaround |
|-------|-----------|
| CRD chart is `v0.9.0`, Platform chart is `v0.9.0-post1` | CLI strips `-postN` suffix when fetching CRD chart |
| `DynamoWorkerMetadata` CRD missing from `v0.9.0` chart | CLI applies bundled CRD after Helm install |

### Discovery Backend + KVBM (v0.9.0)

| Issue | Workaround |
|-------|-----------|
| `discoveryBackend: kubernetes` causes KVBM handshake failures | Platform defaults to `discoveryBackend: etcd` |

## Learn More

- [NVIDIA Dynamo Platform Documentation](https://docs.nvidia.com/dynamo/)
- [etcd Documentation](https://etcd.io/docs/)
- [NATS Documentation](https://docs.nats.io/)
