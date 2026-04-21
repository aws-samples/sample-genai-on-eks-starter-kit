# Monitoring (Prometheus + Grafana)

Comprehensive monitoring stack with Prometheus, Grafana, and pre-configured dashboards for NVIDIA Dynamo Platform, DCGM GPU metrics, KV cache benchmarks, and LLM performance analysis.

| | |
|---|---|
| **Category** | nvidia-platform |
| **Official Docs** | [kube-prometheus-stack](https://github.com/prometheus-operator/kube-prometheus) |
| **CLI Install** | `./cli nvidia-platform monitoring install` |
| **CLI Uninstall** | `./cli nvidia-platform monitoring uninstall` |
| **Namespace** | `monitoring` |

## Overview

The monitoring component deploys **kube-prometheus-stack** (Prometheus + Grafana) with specialized dashboards for:
- Dynamo Frontend and Worker metrics
- DCGM GPU utilization, power, temperature
- KV cache usage and offloading (KVBM)
- Benchmark Pareto comparison (TPS/GPU, TTFT, ITL)

When installed before Dynamo Platform, the `prometheusEndpoint` is automatically detected and configured.

## Installation

```bash
./cli nvidia-platform monitoring install
```

### Auto-Configuration

No interactive prompts required. All settings are configured from `config.json`:

| Setting | Default | Configured via |
|---------|---------|---------------|
| Grafana password | `admin` | `config.json` → `grafanaAdminPassword` |
| Retention | `7d` | `config.json` → `retention` |
| Alertmanager | `false` | `config.json` → `alertmanagerEnabled` |
| Ingress | Auto-detect | Enabled if Ingress controller exists |
| ALB annotations (EKS) | Auto-added | When `PLATFORM=eks` and Ingress detected |

## Verification

```bash
# Check monitoring pods
kubectl get pods -n monitoring

# Check services
kubectl get svc -n monitoring

# Check Ingress (if enabled)
kubectl get ingress -n monitoring
```

## Access

### With Ingress (Recommended)

If an Ingress controller is detected during installation, Grafana and Prometheus are accessible via HTTP path routing:

**K8s Mode (on-premises)**:
```bash
# Find the NodePort
kubectl get svc -n ingress-nginx

# Access URLs
http://<node-ip>:<node-port>/grafana
http://<node-ip>:<node-port>/prometheus
```

**EKS Mode (ALB)**:
```bash
# Find the ALB address
kubectl get ingress -n monitoring

# Access URLs
http://<alb-url>/grafana
http://<alb-url>/prometheus
```

**Remote Access (SSH Tunnel)**:
```bash
# From your local machine
ssh -N -L <local-port>:<node-ip>:<node-port> <user>@<remote-host>

# Open in browser
http://localhost:<local-port>/grafana
http://localhost:<local-port>/prometheus
```

### Without Ingress (Port-Forward Fallback)

```bash
# Grafana
kubectl port-forward svc/prometheus-grafana 3000:80 -n monitoring --address 0.0.0.0 &

# Prometheus
kubectl port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090 -n monitoring --address 0.0.0.0 &
```

## Grafana Login

| Field | Value |
|-------|-------|
| User | `admin` |
| Password | Configured during install (default: `admin`) |

To retrieve the current password:

```bash
kubectl get secret prometheus-grafana -n monitoring \
  -o jsonpath="{.data.admin-password}" | base64 --decode; echo
```

## Dashboards

The monitoring stack includes pre-configured dashboards for comprehensive observability:

| Dashboard | Description | Source |
|-----------|-------------|--------|
| **Dynamo Dashboard** | Frontend/Worker metrics, request rates, latencies | `monitoring/dashboards/dynamo-dashboard.json` |
| **DCGM GPU Monitoring** | GPU utilization, memory, temperature, power | `monitoring/dashboards/dcgm-metrics.json` |
| **KVBM KV Cache** | KV cache usage, offloading metrics | `monitoring/dashboards/kvbm.json` |
| **Benchmark Pareto** | Benchmark comparison (TPS/GPU, TTFT, ITL vs concurrency) | `monitoring/dashboards/benchmark-dashboard.json` |

Dashboards are auto-loaded via Grafana sidecar (ConfigMaps with `grafana_dashboard: "1"` label).

### Benchmark Pareto Dashboard

The Benchmark dashboard provides interactive comparison of LLM serving configurations:

- **TPS/GPU vs Concurrency**: Throughput per GPU at different load levels
- **TPS/User vs Concurrency**: Per-user throughput
- **TTFT P50/P99 vs Concurrency**: Time to First Token latency
- **ITL P50 vs Concurrency**: Inter-Token Latency
- **GPU Efficiency**: TPS/GPU vs TPS/User scatter plot (top-right = optimal)

Use the **Benchmark** dropdown to select and compare multiple benchmark runs.

## Configuration

Edit `config.json` to customize monitoring settings:

```json
{
  "platform": {
    "monitoring": {
      "grafanaAdminPassword": "admin",
      "retention": "7d",
      "enablePersistentStorage": false,
      "prometheusStorageSize": "50Gi",
      "alertmanagerEnabled": false
    }
  }
}
```

## Prometheus Pushgateway

Pushgateway is automatically installed for collecting benchmark metrics. After each [AIPerf Benchmark](benchmark.md) run, metrics are pushed to Pushgateway and scraped by Prometheus.

### Managing Benchmark Data

To reset benchmark metrics in Grafana:

```bash
# Delete all Pushgateway data
kubectl port-forward svc/pushgateway-prometheus-pushgateway 19091:9091 -n monitoring &
sleep 2
curl -s http://localhost:19091/metrics | grep -oP 'job="[^"]*"' | sort -u | sed 's/job="//;s/"//' | while read job; do
  curl -X DELETE "http://localhost:19091/metrics/job/$job"
done
pkill -f "port-forward.*pushgateway"
```

## Integration with Dynamo Platform

When monitoring is installed **before** Dynamo Platform:

1. Dynamo Platform installer detects Prometheus endpoint
2. Sets `prometheusEndpoint` in Helm values
3. Dynamo Operator auto-creates PodMonitors for Frontend/Workers
4. Worker metrics endpoint (`DYN_SYSTEM_PORT=9090`) auto-configured
5. GPU metrics from DCGM Exporter auto-scraped via ServiceMonitor

## Learn More

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [kube-prometheus-stack](https://github.com/prometheus-operator/kube-prometheus)
- [DCGM Exporter Metrics](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/feature-overview.html)
