---
title: "Distributed Inference"
weight: 52
duration: "25 minutes"
difficulty: "advanced"
---

# Distributed Inference with vLLM and LeaderWorkerSet

Learn how to implement distributed inference patterns for scalable model serving using vLLM and LeaderWorkerSet on Amazon EKS.

## Overview

Distributed inference enables serving large language models across multiple nodes and GPUs, providing high throughput and fault tolerance for production GenAI applications.

## Learning Objectives

By the end of this lab, you will be able to:
- Deploy distributed vLLM inference clusters
- Configure auto-scaling for inference workloads
- Implement load balancing and failover strategies
- Monitor distributed inference performance
- Optimize resource utilization across nodes

## Prerequisites

- Completed [Modern EKS Security](/module4-scaling-security/security/)
- Understanding of distributed systems concepts
- Knowledge of Kubernetes scaling mechanisms

## Distributed Inference Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Distributed Inference Architecture            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Load        │  │ Gateway     │  │ Auto        │        │
│  │ Balancer    │  │ API         │  │ Scaler      │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│         │                 │                 │              │
│  ┌─────────────────────────────────────────────────────────┤
│  │              Inference Cluster Manager                 │
│  └─────────────────────────────────────────────────────────┤
│         │                 │                 │              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ LWS Cluster │  │ LWS Cluster │  │ LWS Cluster │        │
│  │ (AZ-1)      │  │ (AZ-2)      │  │ (AZ-3)      │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Lab: Implementing Distributed Inference

### Step 1: Deploy Multi-Zone vLLM Clusters

```yaml
# distributed-vllm-cluster.yaml
apiVersion: leaderworkerset.x-k8s.io/v1
kind: LeaderWorkerSet
metadata:
  name: vllm-distributed-cluster-az1
  namespace: genai-inference
  labels:
    cluster: "distributed-inference"
    zone: "us-west-2a"
spec:
  replicas: 2
  leaderWorkerTemplate:
    size: 4  # 1 leader + 3 workers per replica
    leaderTemplate:
      spec:
        affinity:
          nodeAffinity:
            requiredDuringSchedulingIgnoredDuringExecution:
              nodeSelectorTerms:
              - matchExpressions:
                - key: topology.kubernetes.io/zone
                  operator: In
                  values:
                  - us-west-2a
        containers:
        - name: vllm-leader
          image: vllm/vllm-openai:v0.2.7
          command:
          - python
          - -m
          - vllm.entrypoints.openai.api_server
          args:
          - --model=/models/llama-2-13b-hf
          - --tensor-parallel-size=4
          - --pipeline-parallel-size=1
          - --gpu-memory-utilization=0.9
          - --max-model-len=4096
          - --max-num-batched-tokens=8192
          - --max-num-seqs=256
          - --port=8000
          - --host=0.0.0.0
          - --distributed-executor-backend=ray
          resources:
            requests:
              nvidia.com/gpu: 1
              memory: 24Gi
              cpu: 8
            limits:
              nvidia.com/gpu: 1
              memory: 32Gi
              cpu: 12
          ports:
          - containerPort: 8000
          volumeMounts:
          - name: model-storage
            mountPath: /models
          env:
          - name: CUDA_VISIBLE_DEVICES
            value: "0"
          - name: RAY_DISABLE_IMPORT_WARNING
            value: "1"
        volumes:
        - name: model-storage
          persistentVolumeClaim:
            claimName: model-pvc
    workerTemplate:
      spec:
        affinity:
          nodeAffinity:
            requiredDuringSchedulingIgnoredDuringExecution:
              nodeSelectorTerms:
              - matchExpressions:
                - key: topology.kubernetes.io/zone
                  operator: In
                  values:
                  - us-west-2a
        containers:
        - name: vllm-worker
          image: vllm/vllm-openai:v0.2.7
          command:
          - python
          - -m
          - vllm.entrypoints.openai.api_server
          args:
          - --model=/models/llama-2-13b-hf
          - --tensor-parallel-size=4
          - --pipeline-parallel-size=1
          - --gpu-memory-utilization=0.9
          - --max-model-len=4096
          - --port=8000
          - --host=0.0.0.0
          - --distributed-executor-backend=ray
          resources:
            requests:
              nvidia.com/gpu: 1
              memory: 24Gi
              cpu: 8
            limits:
              nvidia.com/gpu: 1
              memory: 32Gi
              cpu: 12
          volumeMounts:
          - name: model-storage
            mountPath: /models
          env:
          - name: CUDA_VISIBLE_DEVICES
            value: "0"
        volumes:
        - name: model-storage
          persistentVolumeClaim:
            claimName: model-pvc
---
# Repeat for other availability zones (AZ-2, AZ-3)
apiVersion: leaderworkerset.x-k8s.io/v1
kind: LeaderWorkerSet
metadata:
  name: vllm-distributed-cluster-az2
  namespace: genai-inference
  labels:
    cluster: "distributed-inference"
    zone: "us-west-2b"
spec:
  replicas: 2
  leaderWorkerTemplate:
    size: 4
    leaderTemplate:
      spec:
        affinity:
          nodeAffinity:
            requiredDuringSchedulingIgnoredDuringExecution:
              nodeSelectorTerms:
              - matchExpressions:
                - key: topology.kubernetes.io/zone
                  operator: In
                  values:
                  - us-west-2b
        # ... (similar configuration as AZ-1)
```

### Step 2: Configure Auto-Scaling

```yaml
# hpa-distributed-inference.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: vllm-distributed-hpa
  namespace: genai-inference
spec:
  scaleTargetRef:
    apiVersion: leaderworkerset.x-k8s.io/v1
    kind: LeaderWorkerSet
    name: vllm-distributed-cluster-az1
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  - type: Pods
    pods:
      metric:
        name: inference_queue_length
      target:
        type: AverageValue
        averageValue: "10"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 600
      policies:
      - type: Percent
        value: 25
        periodSeconds: 60
---
# Cluster Autoscaler configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: cluster-autoscaler-status
  namespace: kube-system
data:
  nodes.max: "100"
  nodes.min: "3"
  scale-down-delay-after-add: "10m"
  scale-down-unneeded-time: "10m"
  skip-nodes-with-local-storage: "false"
  skip-nodes-with-system-pods: "false"
```

### Step 3: Implement Load Balancing

```yaml
# load-balancer-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: vllm-distributed-service
  namespace: genai-inference
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
    service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
    service.beta.kubernetes.io/aws-load-balancer-backend-protocol: "tcp"
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-interval: "10"
    service.beta.kubernetes.io/aws-load-balancer-healthcheck-timeout: "5"
    service.beta.kubernetes.io/aws-load-balancer-healthy-threshold: "2"
    service.beta.kubernetes.io/aws-load-balancer-unhealthy-threshold: "2"
spec:
  type: LoadBalancer
  selector:
    leaderworkerset.sigs.k8s.io/name: vllm-distributed-cluster-az1
  ports:
  - port: 80
    targetPort: 8000
    protocol: TCP
  sessionAffinity: None
---
# Gateway API configuration for advanced routing
apiVersion: gateway.networking.k8s.io/v1beta1
kind: HTTPRoute
metadata:
  name: vllm-distributed-route
  namespace: genai-inference
spec:
  parentRefs:
  - name: genai-gateway
    namespace: genai-platform
  hostnames:
  - "inference.genai.local"
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /v1/chat/completions
    backendRefs:
    - name: vllm-distributed-service
      port: 80
      weight: 50
    - name: vllm-distributed-service-az2
      port: 80
      weight: 30
    - name: vllm-distributed-service-az3
      port: 80
      weight: 20
    filters:
    - type: RequestHeaderModifier
      requestHeaderModifier:
        add:
        - name: X-Inference-Zone
          value: "distributed"
```

### Step 4: Create Performance Monitoring

```python
# distributed_inference_monitor.py
import asyncio
import aiohttp
import time
import json
import logging
from typing import Dict, List, Any
from dataclasses import dataclass
from datetime import datetime
import numpy as np

@dataclass
class InferenceMetrics:
    endpoint: str
    latency: float
    throughput: float
    error_rate: float
    queue_length: int
    gpu_utilization: float
    memory_usage: float
    timestamp: datetime

class DistributedInferenceMonitor:
    def __init__(self, endpoints: List[str]):
        self.endpoints = endpoints
        self.metrics_history = []
        self.monitoring = False
    
    async def start_monitoring(self, interval_seconds: int = 30):
        """Start monitoring distributed inference endpoints"""
        self.monitoring = True
        
        while self.monitoring:
            try:
                # Collect metrics from all endpoints
                metrics = await self.collect_metrics()
                self.metrics_history.extend(metrics)
                
                # Analyze performance
                analysis = self.analyze_performance(metrics)
                
                # Log analysis
                logging.info(f"Distributed Inference Analysis: {analysis}")
                
                # Check for scaling recommendations
                recommendations = self.get_scaling_recommendations(metrics)
                if recommendations:
                    logging.warning(f"Scaling Recommendations: {recommendations}")
                
                await asyncio.sleep(interval_seconds)
                
            except Exception as e:
                logging.error(f"Error in monitoring: {e}")
                await asyncio.sleep(interval_seconds)
    
    async def collect_metrics(self) -> List[InferenceMetrics]:
        """Collect metrics from all inference endpoints"""
        metrics = []
        
        async with aiohttp.ClientSession() as session:
            tasks = []
            for endpoint in self.endpoints:
                task = asyncio.create_task(
                    self.collect_endpoint_metrics(session, endpoint)
                )
                tasks.append(task)
            
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for result in results:
                if isinstance(result, InferenceMetrics):
                    metrics.append(result)
                elif isinstance(result, Exception):
                    logging.error(f"Error collecting metrics: {result}")
        
        return metrics
    
    async def collect_endpoint_metrics(self, session: aiohttp.ClientSession, 
                                     endpoint: str) -> InferenceMetrics:
        """Collect metrics from a single endpoint"""
        
        # Test inference latency
        latency = await self.measure_latency(session, endpoint)
        
        # Get system metrics (mock implementation)
        system_metrics = await self.get_system_metrics(session, endpoint)
        
        return InferenceMetrics(
            endpoint=endpoint,
            latency=latency,
            throughput=system_metrics.get("throughput", 0.0),
            error_rate=system_metrics.get("error_rate", 0.0),
            queue_length=system_metrics.get("queue_length", 0),
            gpu_utilization=system_metrics.get("gpu_utilization", 0.0),
            memory_usage=system_metrics.get("memory_usage", 0.0),
            timestamp=datetime.now()
        )
    
    async def measure_latency(self, session: aiohttp.ClientSession, 
                            endpoint: str) -> float:
        """Measure inference latency"""
        start_time = time.time()
        
        payload = {
            "model": "llama-2-13b-hf",
            "messages": [{"role": "user", "content": "Hello, how are you?"}],
            "max_tokens": 50,
            "temperature": 0.7
        }
        
        try:
            async with session.post(
                f"{endpoint}/v1/chat/completions",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                await response.json()
                return time.time() - start_time
                
        except Exception as e:
            logging.error(f"Latency measurement failed for {endpoint}: {e}")
            return float('inf')
    
    async def get_system_metrics(self, session: aiohttp.ClientSession, 
                               endpoint: str) -> Dict[str, Any]:
        """Get system metrics from endpoint"""
        try:
            # In real implementation, this would query actual metrics endpoints
            # For demo, return mock metrics
            return {
                "throughput": np.random.uniform(10, 50),
                "error_rate": np.random.uniform(0, 0.05),
                "queue_length": np.random.randint(0, 20),
                "gpu_utilization": np.random.uniform(60, 95),
                "memory_usage": np.random.uniform(70, 90)
            }
        except Exception as e:
            logging.error(f"System metrics collection failed for {endpoint}: {e}")
            return {}
    
    def analyze_performance(self, metrics: List[InferenceMetrics]) -> Dict[str, Any]:
        """Analyze performance across all endpoints"""
        if not metrics:
            return {"status": "no_data"}
        
        latencies = [m.latency for m in metrics if m.latency != float('inf')]
        throughputs = [m.throughput for m in metrics]
        error_rates = [m.error_rate for m in metrics]
        
        analysis = {
            "total_endpoints": len(metrics),
            "healthy_endpoints": len(latencies),
            "avg_latency": np.mean(latencies) if latencies else 0,
            "max_latency": np.max(latencies) if latencies else 0,
            "total_throughput": np.sum(throughputs),
            "avg_error_rate": np.mean(error_rates) if error_rates else 0,
            "load_distribution": self.analyze_load_distribution(metrics)
        }
        
        return analysis
    
    def analyze_load_distribution(self, metrics: List[InferenceMetrics]) -> Dict[str, Any]:
        """Analyze load distribution across endpoints"""
        if not metrics:
            return {}
        
        throughputs = [m.throughput for m in metrics]
        if not throughputs:
            return {}
        
        total_throughput = sum(throughputs)
        if total_throughput == 0:
            return {"status": "no_traffic"}
        
        distribution = {
            m.endpoint: (m.throughput / total_throughput) * 100 
            for m in metrics
        }
        
        # Calculate load balance score (lower is better)
        ideal_distribution = 100 / len(metrics)
        balance_score = np.std([
            abs(dist - ideal_distribution) for dist in distribution.values()
        ])
        
        return {
            "distribution": distribution,
            "balance_score": balance_score,
            "is_balanced": balance_score < 10  # Threshold for "balanced"
        }
    
    def get_scaling_recommendations(self, metrics: List[InferenceMetrics]) -> List[str]:
        """Get scaling recommendations based on metrics"""
        recommendations = []
        
        if not metrics:
            return recommendations
        
        # Check for high latency
        high_latency_endpoints = [
            m.endpoint for m in metrics if m.latency > 5.0
        ]
        if high_latency_endpoints:
            recommendations.append(
                f"High latency detected on endpoints: {high_latency_endpoints}. Consider scaling up."
            )
        
        # Check for high error rates
        high_error_endpoints = [
            m.endpoint for m in metrics if m.error_rate > 0.1
        ]
        if high_error_endpoints:
            recommendations.append(
                f"High error rates on endpoints: {high_error_endpoints}. Check health and consider replacement."
            )
        
        # Check for resource utilization
        high_gpu_util_endpoints = [
            m.endpoint for m in metrics if m.gpu_utilization > 90
        ]
        if high_gpu_util_endpoints:
            recommendations.append(
                f"High GPU utilization on endpoints: {high_gpu_util_endpoints}. Consider horizontal scaling."
            )
        
        # Check queue lengths
        high_queue_endpoints = [
            m.endpoint for m in metrics if m.queue_length > 50
        ]
        if high_queue_endpoints:
            recommendations.append(
                f"High queue lengths on endpoints: {high_queue_endpoints}. Scale up immediately."
            )
        
        return recommendations
    
    def stop_monitoring(self):
        """Stop monitoring"""
        self.monitoring = False
    
    def get_performance_report(self) -> Dict[str, Any]:
        """Generate performance report"""
        if not self.metrics_history:
            return {"status": "no_data"}
        
        recent_metrics = self.metrics_history[-len(self.endpoints):]
        
        return {
            "report_timestamp": datetime.now().isoformat(),
            "monitoring_duration": len(self.metrics_history) // len(self.endpoints),
            "current_analysis": self.analyze_performance(recent_metrics),
            "total_metrics_collected": len(self.metrics_history)
        }

# Load Testing for Distributed Inference
class DistributedLoadTester:
    def __init__(self, endpoints: List[str]):
        self.endpoints = endpoints
    
    async def run_load_test(self, concurrent_requests: int = 50, 
                          duration_minutes: int = 5) -> Dict[str, Any]:
        """Run load test against distributed inference endpoints"""
        
        print(f"Starting load test with {concurrent_requests} concurrent requests for {duration_minutes} minutes")
        
        end_time = time.time() + (duration_minutes * 60)
        results = []
        
        async with aiohttp.ClientSession() as session:
            while time.time() < end_time:
                # Create concurrent requests
                tasks = []
                for _ in range(concurrent_requests):
                    endpoint = np.random.choice(self.endpoints)
                    task = asyncio.create_task(
                        self.send_inference_request(session, endpoint)
                    )
                    tasks.append(task)
                
                # Wait for all requests to complete
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Process results
                for result in batch_results:
                    if isinstance(result, dict):
                        results.append(result)
                
                # Brief pause between batches
                await asyncio.sleep(1)
        
        return self.analyze_load_test_results(results)
    
    async def send_inference_request(self, session: aiohttp.ClientSession, 
                                   endpoint: str) -> Dict[str, Any]:
        """Send a single inference request"""
        start_time = time.time()
        
        payload = {
            "model": "llama-2-13b-hf",
            "messages": [{"role": "user", "content": "Generate a short story about AI."}],
            "max_tokens": 100,
            "temperature": 0.8
        }
        
        try:
            async with session.post(
                f"{endpoint}/v1/chat/completions",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=60)
            ) as response:
                await response.json()
                
                return {
                    "endpoint": endpoint,
                    "latency": time.time() - start_time,
                    "status_code": response.status,
                    "success": response.status == 200,
                    "timestamp": time.time()
                }
                
        except Exception as e:
            return {
                "endpoint": endpoint,
                "latency": time.time() - start_time,
                "status_code": 0,
                "success": False,
                "error": str(e),
                "timestamp": time.time()
            }
    
    def analyze_load_test_results(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze load test results"""
        if not results:
            return {"status": "no_results"}
        
        successful_requests = [r for r in results if r.get("success", False)]
        failed_requests = [r for r in results if not r.get("success", False)]
        
        latencies = [r["latency"] for r in successful_requests]
        
        # Group by endpoint
        endpoint_stats = {}
        for result in results:
            endpoint = result["endpoint"]
            if endpoint not in endpoint_stats:
                endpoint_stats[endpoint] = {"requests": 0, "successes": 0, "latencies": []}
            
            endpoint_stats[endpoint]["requests"] += 1
            if result.get("success", False):
                endpoint_stats[endpoint]["successes"] += 1
                endpoint_stats[endpoint]["latencies"].append(result["latency"])
        
        # Calculate per-endpoint metrics
        for endpoint, stats in endpoint_stats.items():
            if stats["latencies"]:
                stats["avg_latency"] = np.mean(stats["latencies"])
                stats["p95_latency"] = np.percentile(stats["latencies"], 95)
                stats["p99_latency"] = np.percentile(stats["latencies"], 99)
            else:
                stats["avg_latency"] = 0
                stats["p95_latency"] = 0
                stats["p99_latency"] = 0
            
            stats["success_rate"] = stats["successes"] / stats["requests"] if stats["requests"] > 0 else 0
        
        return {
            "total_requests": len(results),
            "successful_requests": len(successful_requests),
            "failed_requests": len(failed_requests),
            "overall_success_rate": len(successful_requests) / len(results),
            "avg_latency": np.mean(latencies) if latencies else 0,
            "p95_latency": np.percentile(latencies, 95) if latencies else 0,
            "p99_latency": np.percentile(latencies, 99) if latencies else 0,
            "throughput": len(successful_requests) / (max([r["timestamp"] for r in results]) - min([r["timestamp"] for r in results])) if results else 0,
            "endpoint_stats": endpoint_stats
        }

# Demo application
async def run_distributed_inference_demo():
    """Run distributed inference monitoring and testing demo"""
    
    # Setup logging
    logging.basicConfig(level=logging.INFO)
    
    print("=== Distributed Inference Demo ===\n")
    
    # Define endpoints (in real deployment, these would be actual service endpoints)
    endpoints = [
        "http://vllm-distributed-service-az1.genai-inference.svc.cluster.local",
        "http://vllm-distributed-service-az2.genai-inference.svc.cluster.local",
        "http://vllm-distributed-service-az3.genai-inference.svc.cluster.local"
    ]
    
    # Start monitoring
    monitor = DistributedInferenceMonitor(endpoints)
    
    # Start monitoring in background
    monitor_task = asyncio.create_task(monitor.start_monitoring(interval_seconds=10))
    
    # Run load test
    load_tester = DistributedLoadTester(endpoints)
    
    print("Running load test...")
    load_test_results = await load_tester.run_load_test(
        concurrent_requests=20,
        duration_minutes=2
    )
    
    print("Load Test Results:")
    print(json.dumps(load_test_results, indent=2))
    
    # Get monitoring report
    await asyncio.sleep(5)  # Let monitoring collect some data
    monitor.stop_monitoring()
    
    report = monitor.get_performance_report()
    print("\nMonitoring Report:")
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    asyncio.run(run_distributed_inference_demo())
```

Continue with [Cost Calculation](/module4-scaling-security/cost-calculation/) to learn about cost optimization and monitoring for GenAI workloads.