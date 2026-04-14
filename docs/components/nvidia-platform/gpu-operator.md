# NVIDIA GPU Operator

The NVIDIA GPU Operator manages the lifecycle of NVIDIA GPU drivers, device plugins, and monitoring exporters on Kubernetes. It automates the deployment of all necessary components for running GPU workloads.

| | |
|---|---|
| **Category** | nvidia-platform |
| **Official Docs** | [GPU Operator Documentation](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/) |
| **CLI Install** | `./cli nvidia-platform gpu-operator install` |
| **CLI Uninstall** | `./cli nvidia-platform gpu-operator uninstall` |
| **Namespace** | `gpu-operator` |

## Overview

The GPU Operator simplifies GPU management in Kubernetes by deploying and managing:
- GPU Feature Discovery (GFD) for node labeling
- DCGM Exporter for GPU metrics
- GPU Device Plugin for resource scheduling
- GPU Driver (K8s mode only)
- NVIDIA Container Toolkit (K8s mode only)

## Installation

```bash
./cli nvidia-platform gpu-operator install
```

The installer automatically detects the platform mode (K8s or EKS) and configures components accordingly.

### K8s Mode Configuration

In K8s mode, the GPU Operator assumes drivers and Container Toolkit are pre-installed on worker nodes:

- **Driver**: Disabled (requires NVIDIA Driver 580+ pre-installed)
- **Toolkit**: Disabled (requires NVIDIA Container Toolkit with CDI configured)
- **Device Plugin**: Disabled (CDI-based device management)
- **GFD**: Enabled (GPU feature discovery)
- **DCGM Exporter**: Enabled (GPU metrics for Prometheus)
- **GDS**: Enabled (GPUDirect Storage)

### EKS Mode Configuration

In EKS mode, drivers and toolkit are provided by the EKS GPU AMI:

- **Driver**: Disabled (provided by AMI)
- **Toolkit**: Disabled (provided by AMI)
- **Device Plugin**: Disabled (CDI-based device management)
- **GFD**: Enabled (GPU feature discovery)
- **DCGM Exporter**: Enabled (GPU metrics for Prometheus)
- **GDS**: Enabled (GPUDirect Storage)

## Verification

```bash
# Check GPU Operator pods
kubectl get pods -n gpu-operator

# Verify GPU resources are detected
kubectl get nodes -o json | jq '.items[].status.capacity | select(."nvidia.com/gpu" != null)'

# Check GPU labels
kubectl get nodes --show-labels | grep nvidia.com/gpu

# View DCGM Exporter metrics
kubectl port-forward -n gpu-operator svc/gpu-operator-dcgm-exporter 9400:9400
curl localhost:9400/metrics | grep DCGM
```

Expected output:
```
nvidia-gpu-operator-1234-abcd   1/1     Running   0          2m
nvidia-gpu-operator-5678-efgh   1/1     Running   0          2m
dcgm-exporter-1234              1/1     Running   0          2m
gpu-feature-discovery-5678      1/1     Running   0          2m
```

## Configuration

Configuration is managed through `config.json`:

```json
{
  "platform": {
    "eks": {
      "gpuOperator": {
        "driverEnabled": false,
        "toolkitEnabled": false,
        "devicePluginEnabled": false,
        "gfdEnabled": true,
        "dcgmExporterEnabled": true,
        "gdsEnabled": true
      }
    },
    "k8s": {
      "gpuOperator": {
        "driverEnabled": false,
        "toolkitEnabled": false,
        "devicePluginEnabled": false,
        "gfdEnabled": true,
        "dcgmExporterEnabled": true,
        "gdsEnabled": true
      }
    }
  }
}
```

## Prometheus Integration

If the [Monitoring](monitoring.md) component is installed **before** the GPU Operator, DCGM metrics are automatically scraped by Prometheus:

1. GPU Operator detects `ServiceMonitor` CRD
2. Creates `ServiceMonitor` for DCGM Exporter
3. Prometheus auto-discovers and scrapes GPU metrics
4. Grafana DCGM Dashboard displays GPU utilization, power, temperature

## Troubleshooting

### No GPU resources detected

```bash
# Check if GPUs are visible on the node
kubectl debug node/<node-name> -it --image=ubuntu
nvidia-smi

# Check GPU Operator logs
kubectl logs -n gpu-operator -l app=gpu-operator
```

### DCGM Exporter not running

```bash
# Check ServiceMonitor exists
kubectl get servicemonitor -n gpu-operator

# Check DCGM Exporter pod
kubectl get pods -n gpu-operator -l app=dcgm-exporter
kubectl logs -n gpu-operator -l app=dcgm-exporter
```

## Learn More

- [NVIDIA GPU Operator Documentation](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/)
- [DCGM Exporter Metrics](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/feature-overview.html#field-identifiers)
- [CDI Specification](https://github.com/cncf-tags/container-device-interface/blob/main/SPEC.md)
