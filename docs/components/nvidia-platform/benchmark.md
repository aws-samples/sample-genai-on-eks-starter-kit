# AIPerf Benchmark

Comprehensive LLM benchmarking suite for measuring throughput, latency, and efficiency across different concurrency levels and workload patterns. Results are automatically pushed to Prometheus Pushgateway and visualized in Grafana.

| | |
|---|---|
| **Category** | nvidia-platform |
| **Official Docs** | [NVIDIA AIPerf](https://github.com/NVIDIA/AIPerf) |
| **CLI Install** | `./cli nvidia-platform benchmark install` |
| **CLI Uninstall** | `./cli nvidia-platform benchmark uninstall` |
| **Namespace** | `dynamo-system` |

## Overview

AIPerf Benchmark provides automated performance testing for Dynamo vLLM deployments with:
- **Concurrency Sweep**: Throughput vs latency at different load levels
- **Multi-Turn**: Session affinity testing for KV Router cache hits
- **Sequence Distribution**: Mixed workload simulation (QA + summarization)
- **Prefix Cache**: Synthetic shared-prefix workload for KV cache testing

Results are stored in PVC, pushed to Prometheus, and visualized in the **Benchmark Pareto** Grafana dashboard.

## Installation

```bash
./cli nvidia-platform benchmark install
```

### Interactive Prompts

The installer guides you through benchmark configuration:

1. **Select DynamoGraphDeployment**: Choose from deployed models
2. **Choose benchmark mode**: Concurrency Sweep / Multi-Turn / Seq Distribution / Prefix Cache
3. **Set parameters**: ISL, OSL, concurrency levels, request count

### Benchmark Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Concurrency Sweep** | Throughput vs latency at different concurrency levels (1, 8, 16, 32, 64, ...) | Baseline performance comparison |
| **Multi-Turn** | Multi-turn conversations with session affinity | KV Router cache hit effect |
| **Sequence Distribution** | Mixed ISL/OSL workloads (QA + summarization) | Real-world traffic simulation |
| **Prefix Cache** | Synthetic shared-prefix workload (no trace file) | KV cache hit rate testing |

!!! info "Prefix Cache Mode"
    `request_count` is automatically set to **concurrency × 4** per level (aiperf requires `request_count >= concurrency`). No manual prompt for request count.

## Running a Benchmark

```bash
# Start benchmark
./cli nvidia-platform benchmark install

# Follow prompts to configure
# Example: Concurrency Sweep
? Select deployment: qwen3-30b-fp8
? Benchmark mode: Concurrency Sweep
? Input Sequence Length (ISL): 256
? Output Sequence Length (OSL): 256
? Concurrency levels (comma-separated): 1,8,16,32
? Benchmark name: qwen3-sweep-256-256

# Monitor progress
kubectl logs -n dynamo-system -l job-name=aiperf-benchmark-<name> -f

# Check completion
kubectl get jobs -n dynamo-system
```

## Results

After benchmark completion:

1. **PVC Storage**: Results stored in `benchmark-results` PVC under `dynamo-system` namespace
   - Per-benchmark directories: `c1`, `c8`, `c16`, `c32`
   - CSV files with detailed metrics
2. **Local Copy**: Results copied to `components/nvidia-platform/benchmark/results/<benchmark-name>/`
3. **Prometheus Metrics**: Automatically pushed to Pushgateway (scraped by Prometheus)
4. **Grafana Dashboard**: View in **Benchmark Pareto** dashboard

## Grafana Visualization

Open Grafana → **Benchmark Pareto** dashboard:

### Available Charts

| Chart | Description | X-Axis | Y-Axis |
|-------|-------------|--------|--------|
| **TPS/GPU vs Concurrency** | Throughput per GPU | Concurrency | TPS/GPU |
| **TPS/User vs Concurrency** | Per-user throughput | Concurrency | TPS/User |
| **TTFT P50/P99 vs Concurrency** | Time to First Token latency | Concurrency | TTFT (ms) |
| **ITL P50 vs Concurrency** | Inter-Token Latency | Concurrency | ITL (ms) |
| **Request Latency P50 vs Concurrency** | End-to-end latency | Concurrency | Latency (ms) |
| **GPU Efficiency (Pareto)** | TPS/GPU vs TPS/User scatter plot | TPS/User | TPS/GPU |

### Comparing Deployments

Run the same benchmark mode on different configurations to generate Pareto comparison:

```bash
# 1. Deploy agg baseline → run sweep → name: "qwen3-agg"
./cli nvidia-platform dynamo-vllm install
# Configure: mode=agg, TP=2, replicas=2
./cli nvidia-platform benchmark install
# Benchmark name: qwen3-agg

# 2. Deploy agg + KV Router → run sweep → name: "qwen3-kvrouter"
./cli nvidia-platform dynamo-vllm install
# Configure: mode=agg, TP=2, replicas=2, KV Router=Yes
./cli nvidia-platform benchmark install
# Benchmark name: qwen3-kvrouter

# 3. Deploy disagg + KVBM → run sweep → name: "qwen3-disagg"
./cli nvidia-platform dynamo-vllm install
# Configure: mode=disagg, Prefill TP=1, Decode TP=2, KVBM=Yes
./cli nvidia-platform benchmark install
# Benchmark name: qwen3-disagg
```

Then in Grafana, select all three benchmarks in the **Benchmark** dropdown to compare.

### Reading the Pareto Chart

The GPU Efficiency chart shows TPS/GPU (Y) vs TPS/User (X):
- **Top-right**: Optimal (high throughput per GPU, high per-user throughput)
- **Top-left**: High GPU efficiency, low user experience (under-provisioned)
- **Bottom-right**: Low GPU efficiency, high user experience (over-provisioned)

## Verification

```bash
# Check benchmark job
kubectl get jobs -n dynamo-system | grep aiperf

# Check results PVC
kubectl get pvc -n dynamo-system benchmark-results

# View results (mount PVC)
kubectl run -it --rm debug --image=ubuntu --restart=Never \
  --overrides='{"spec":{"volumes":[{"name":"results","persistentVolumeClaim":{"claimName":"benchmark-results"}}],"containers":[{"name":"debug","image":"ubuntu","command":["bash"],"volumeMounts":[{"name":"results","mountPath":"/results"}]}]}}'
# Inside pod: ls /results
```

## Managing Benchmark Data

### Delete Pushgateway Metrics

To reset benchmark data in Grafana (clears all Pushgateway metrics):

```bash
kubectl port-forward svc/pushgateway-prometheus-pushgateway 19091:9091 -n monitoring &
sleep 2
curl -s http://localhost:19091/metrics | grep -oP 'job="[^"]*"' | sort -u | sed 's/job="//;s/"//' | while read job; do
  curl -X DELETE "http://localhost:19091/metrics/job/$job"
done
pkill -f "port-forward.*pushgateway"
```

### Uninstall Benchmark Resources

```bash
# Removes Jobs and PVC
./cli nvidia-platform benchmark uninstall
```

## Configuration

Benchmark parameters are configured interactively. Common settings:

| Parameter | Description | Typical Values |
|-----------|-------------|----------------|
| ISL | Input Sequence Length | 128, 256, 512, 1024 |
| OSL | Output Sequence Length | 128, 256, 512 |
| Concurrency Levels | Concurrent requests | 1,8,16,32,64,128 |
| Request Count | Total requests per level | 100, 500, 1000 |

## Troubleshooting

### Benchmark job fails

```bash
# Check job logs
kubectl logs -n dynamo-system -l job-name=aiperf-benchmark-<name>

# Check PVC mount
kubectl describe pvc benchmark-results -n dynamo-system
```

### Metrics not appearing in Grafana

```bash
# Check Pushgateway has data
kubectl port-forward svc/pushgateway-prometheus-pushgateway 19091:9091 -n monitoring &
curl http://localhost:19091/metrics | grep aiperf

# Check Prometheus is scraping Pushgateway
# Grafana → Explore → Prometheus → Query: {job=~"aiperf.*"}
```

## Learn More

- [NVIDIA AIPerf Documentation](https://github.com/NVIDIA/AIPerf)
- [Benchmark Pareto Dashboard Guide](monitoring.md#benchmark-pareto-dashboard)
- [Prometheus Pushgateway](https://github.com/prometheus/pushgateway)
