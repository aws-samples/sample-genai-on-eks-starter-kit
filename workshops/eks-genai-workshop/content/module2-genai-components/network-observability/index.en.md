---
title: "Network Observability with Hubble"
weight: 34
duration: "35 minutes"
difficulty: "intermediate"
---

# Network Observability with Hubble

Learn how to implement comprehensive network observability using Cilium Hubble for monitoring GenAI application traffic, security, and performance at the network level.

## Overview

Hubble is Cilium's network observability platform that provides deep visibility into network traffic, security policies, and service dependencies using eBPF technology.

## Learning Objectives

By the end of this lab, you will be able to:
- Deploy Cilium with Hubble for network observability
- Visualize network topology and service dependencies
- Monitor inter-agent communication patterns
- Analyze network performance and bottlenecks
- Implement network security policies with real-time monitoring

## Prerequisites

- Completed [LangSmith Advanced Debugging](/module2-genai-components/observability/langsmith/)
- EKS cluster with Cilium CNI
- Understanding of Kubernetes networking concepts

## Hubble Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Hubble Architecture                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Hubble UI   │  │ Hubble CLI  │  │ Grafana     │        │
│  │ (Web UI)    │  │ (Command)   │  │ (Metrics)   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│         │                 │                 │              │
│  ┌─────────────────────────────────────────────────────────┤
│  │              Hubble Relay                               │
│  │         (Aggregates data from nodes)                    │
│  └─────────────────────────────────────────────────────────┤
│         │                 │                 │              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Hubble      │  │ Hubble      │  │ Hubble      │        │
│  │ Agent       │  │ Agent       │  │ Agent       │        │
│  │ (Node 1)    │  │ (Node 2)    │  │ (Node 3)    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Lab: Deploying Hubble for GenAI Observability

### Step 1: Enable Hubble in Cilium

First, verify Cilium is installed and enable Hubble:

```bash
# Check current Cilium configuration
kubectl get configmap cilium-config -n kube-system -o yaml

# Enable Hubble if not already enabled
kubectl patch configmap cilium-config -n kube-system --type merge -p '{
  "data": {
    "enable-hubble": "true",
    "hubble-listen-address": ":4244",
    "hubble-metrics-server": ":9965",
    "hubble-metrics": "dns,drop,tcp,flow,port-distribution,icmp,http"
  }
}'

# Restart Cilium pods to apply changes
kubectl rollout restart daemonset/cilium -n kube-system
```

### Step 2: Deploy Hubble Relay and UI

```yaml
# hubble-relay.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hubble-relay
  namespace: kube-system
  labels:
    k8s-app: hubble-relay
spec:
  replicas: 1
  selector:
    matchLabels:
      k8s-app: hubble-relay
  template:
    metadata:
      labels:
        k8s-app: hubble-relay
    spec:
      containers:
      - name: hubble-relay
        image: quay.io/cilium/hubble-relay:v1.14.5
        command:
        - hubble-relay
        args:
        - serve
        - --local-server-address=0.0.0.0:4245
        - --peer-service=hubble-peer.kube-system.svc.cluster.local:443
        - --redact-enabled=false
        - --redact-http-headers-allow=user-agent,x-forwarded-for
        - --redact-kafka-api-key=false
        ports:
        - name: grpc
          containerPort: 4245
          protocol: TCP
        livenessProbe:
          grpc:
            port: 4245
          timeoutSeconds: 3
        readinessProbe:
          grpc:
            port: 4245
          timeoutSeconds: 3
        resources:
          limits:
            cpu: 1000m
            memory: 1024Mi
          requests:
            cpu: 100m
            memory: 64Mi
---
apiVersion: v1
kind: Service
metadata:
  name: hubble-relay
  namespace: kube-system
  labels:
    k8s-app: hubble-relay
spec:
  type: ClusterIP
  ports:
  - port: 80
    protocol: TCP
    targetPort: 4245
  selector:
    k8s-app: hubble-relay
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hubble-ui
  namespace: kube-system
  labels:
    k8s-app: hubble-ui
spec:
  replicas: 1
  selector:
    matchLabels:
      k8s-app: hubble-ui
  template:
    metadata:
      labels:
        k8s-app: hubble-ui
    spec:
      containers:
      - name: frontend
        image: quay.io/cilium/hubble-ui:v0.12.1
        ports:
        - name: http
          containerPort: 8081
        env:
        - name: EVENTS_SERVER_PORT
          value: "8090"
        - name: FLOWS_API_ADDR
          value: "hubble-relay:80"
        resources:
          limits:
            cpu: 1000m
            memory: 1024Mi
          requests:
            cpu: 100m
            memory: 64Mi
      - name: backend
        image: quay.io/cilium/hubble-ui-backend:v0.12.1
        env:
        - name: EVENTS_SERVER_PORT
          value: "8090"
        - name: FLOWS_API_ADDR
          value: "hubble-relay:80"
        ports:
        - name: grpc
          containerPort: 8090
        resources:
          limits:
            cpu: 1000m
            memory: 1024Mi
          requests:
            cpu: 100m
            memory: 64Mi
---
apiVersion: v1
kind: Service
metadata:
  name: hubble-ui
  namespace: kube-system
  labels:
    k8s-app: hubble-ui
spec:
  type: ClusterIP
  selector:
    k8s-app: hubble-ui
  ports:
  - name: http
    port: 80
    protocol: TCP
    targetPort: 8081
```

### Step 3: Create GenAI Application for Network Monitoring

```yaml
# genai-network-demo.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: genai-network-demo
  labels:
    name: genai-network-demo
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-coordinator
  namespace: genai-network-demo
  labels:
    app: agent-coordinator
    tier: orchestration
spec:
  replicas: 1
  selector:
    matchLabels:
      app: agent-coordinator
  template:
    metadata:
      labels:
        app: agent-coordinator
        tier: orchestration
    spec:
      containers:
      - name: coordinator
        image: nginx:alpine
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: document-agent
  namespace: genai-network-demo
  labels:
    app: document-agent
    tier: processing
spec:
  replicas: 2
  selector:
    matchLabels:
      app: document-agent
  template:
    metadata:
      labels:
        app: document-agent
        tier: processing
    spec:
      containers:
      - name: doc-processor
        image: nginx:alpine
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-service
  namespace: genai-network-demo
  labels:
    app: llm-service
    tier: inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: llm-service
  template:
    metadata:
      labels:
        app: llm-service
        tier: inference
    spec:
      containers:
      - name: llm-server
        image: nginx:alpine
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 200m
            memory: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: agent-coordinator-service
  namespace: genai-network-demo
spec:
  selector:
    app: agent-coordinator
  ports:
  - port: 80
    targetPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: document-agent-service
  namespace: genai-network-demo
spec:
  selector:
    app: document-agent
  ports:
  - port: 80
    targetPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: llm-service
  namespace: genai-network-demo
spec:
  selector:
    app: llm-service
  ports:
  - port: 80
    targetPort: 80
```

### Step 4: Generate Network Traffic for Monitoring

```python
# network_traffic_generator.py
import asyncio
import aiohttp
import random
import time
from datetime import datetime

class GenAINetworkTrafficGenerator:
    def __init__(self):
        self.services = {
            "coordinator": "http://agent-coordinator-service.genai-network-demo.svc.cluster.local",
            "document": "http://document-agent-service.genai-network-demo.svc.cluster.local", 
            "llm": "http://llm-service.genai-network-demo.svc.cluster.local"
        }
        
    async def simulate_agent_workflow(self, session):
        """Simulate a typical GenAI agent workflow"""
        
        workflow_steps = [
            ("coordinator", "POST", "/api/v1/tasks", {"task": "process_document"}),
            ("document", "POST", "/api/v1/analyze", {"document_id": "doc_123"}),
            ("llm", "POST", "/api/v1/generate", {"prompt": "Analyze document content"}),
            ("document", "GET", "/api/v1/results/doc_123", {}),
            ("coordinator", "POST", "/api/v1/complete", {"task_id": "task_456"})
        ]
        
        for service, method, endpoint, payload in workflow_steps:
            try:
                url = f"{self.services[service]}{endpoint}"
                
                if method == "GET":
                    async with session.get(url) as response:
                        await response.text()
                else:
                    async with session.post(url, json=payload) as response:
                        await response.text()
                
                # Add realistic delay between steps
                await asyncio.sleep(random.uniform(0.1, 0.5))
                
            except Exception as e:
                print(f"Request to {service} failed: {e}")
    
    async def simulate_concurrent_agents(self, session, num_agents=5):
        """Simulate multiple agents working concurrently"""
        
        tasks = []
        for i in range(num_agents):
            task = asyncio.create_task(self.simulate_agent_workflow(session))
            tasks.append(task)
            
            # Stagger agent starts
            await asyncio.sleep(random.uniform(0.1, 0.3))
        
        await asyncio.gather(*tasks, return_exceptions=True)
    
    async def generate_continuous_traffic(self, duration_minutes=10):
        """Generate continuous network traffic for monitoring"""
        
        end_time = time.time() + (duration_minutes * 60)
        
        async with aiohttp.ClientSession() as session:
            while time.time() < end_time:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Generating traffic batch...")
                
                # Simulate different traffic patterns
                pattern = random.choice(["normal", "burst", "error"])
                
                if pattern == "normal":
                    await self.simulate_concurrent_agents(session, num_agents=3)
                elif pattern == "burst":
                    await self.simulate_concurrent_agents(session, num_agents=10)
                else:  # error pattern
                    await self.simulate_error_scenarios(session)
                
                # Wait before next batch
                await asyncio.sleep(random.uniform(5, 15))
    
    async def simulate_error_scenarios(self, session):
        """Simulate various error scenarios for monitoring"""
        
        error_scenarios = [
            ("coordinator", "POST", "/api/v1/invalid", {}),
            ("document", "GET", "/api/v1/nonexistent", {}),
            ("llm", "POST", "/api/v1/timeout", {"large_payload": "x" * 10000})
        ]
        
        for service, method, endpoint, payload in error_scenarios:
            try:
                url = f"{self.services[service]}{endpoint}"
                
                if method == "GET":
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=1)) as response:
                        await response.text()
                else:
                    async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=1)) as response:
                        await response.text()
                        
            except Exception:
                pass  # Expected errors for monitoring

async def main():
    generator = GenAINetworkTrafficGenerator()
    print("Starting network traffic generation for Hubble monitoring...")
    await generator.generate_continuous_traffic(duration_minutes=5)
    print("Traffic generation completed.")

if __name__ == "__main__":
    asyncio.run(main())
```

### Step 5: Deploy and Monitor

```bash
# Deploy Hubble components
kubectl apply -f hubble-relay.yaml

# Deploy demo applications
kubectl apply -f genai-network-demo.yaml

# Wait for deployments
kubectl wait --for=condition=available --timeout=300s deployment/hubble-relay -n kube-system
kubectl wait --for=condition=available --timeout=300s deployment/hubble-ui -n kube-system
kubectl wait --for=condition=available --timeout=300s deployment/agent-coordinator -n genai-network-demo

# Port forward to access Hubble UI
kubectl port-forward -n kube-system svc/hubble-ui 8080:80 &

# Generate traffic for monitoring
kubectl run traffic-generator --image=python:3.11-slim --rm -it -- /bin/bash
# Inside the pod, run the traffic generator script
```

## Hubble CLI Commands

### Basic Network Flow Monitoring

```bash
# Install Hubble CLI
curl -L --fail --remote-name-all https://github.com/cilium/hubble/releases/latest/download/hubble-linux-amd64.tar.gz
tar xzvfC hubble-linux-amd64.tar.gz /usr/local/bin
rm hubble-linux-amd64.tar.gz

# Port forward to Hubble Relay
kubectl port-forward -n kube-system svc/hubble-relay 4245:80 &

# Basic flow monitoring
hubble observe --server localhost:4245

# Monitor specific namespace
hubble observe --namespace genai-network-demo

# Monitor flows between specific services
hubble observe --from-service genai-network-demo/agent-coordinator-service --to-service genai-network-demo/document-agent-service

# Monitor HTTP traffic
hubble observe --protocol http

# Monitor dropped packets
hubble observe --verdict DROPPED
```

### Advanced Network Analysis

```bash
# Monitor flows with detailed output
hubble observe --output json | jq '.'

# Get network statistics
hubble status

# Monitor specific ports
hubble observe --port 80

# Monitor traffic by labels
hubble observe --from-label "tier=orchestration" --to-label "tier=processing"

# Export flows for analysis
hubble observe --output jsonpb > network_flows.json
```

### Network Policy Monitoring

```yaml
# network-policies.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: genai-network-policy
  namespace: genai-network-demo
spec:
  podSelector:
    matchLabels:
      tier: processing
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          tier: orchestration
    ports:
    - protocol: TCP
      port: 80
  egress:
  - to:
    - podSelector:
        matchLabels:
          tier: inference
    ports:
    - protocol: TCP
      port: 80
  - to: []  # Allow DNS
    ports:
    - protocol: UDP
      port: 53
```

Apply and monitor network policies:

```bash
# Apply network policy
kubectl apply -f network-policies.yaml

# Monitor policy enforcement
hubble observe --verdict DENIED

# Test policy violations
kubectl run test-pod --image=nginx --rm -it -- curl http://document-agent-service.genai-network-demo.svc.cluster.local
```

## Performance Analysis with Hubble

### 1. Latency Monitoring

```python
# hubble_performance_analyzer.py
import subprocess
import json
import time
from collections import defaultdict
from statistics import mean, stdev

class HubblePerformanceAnalyzer:
    def __init__(self):
        self.flows = []
    
    def collect_flows(self, duration_seconds=60):
        """Collect network flows for analysis"""
        
        cmd = [
            "hubble", "observe", 
            "--server", "localhost:4245",
            "--output", "json",
            "--namespace", "genai-network-demo"
        ]
        
        print(f"Collecting flows for {duration_seconds} seconds...")
        
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        
        start_time = time.time()
        while time.time() - start_time < duration_seconds:
            line = process.stdout.readline()
            if line:
                try:
                    flow = json.loads(line.strip())
                    self.flows.append(flow)
                except json.JSONDecodeError:
                    continue
        
        process.terminate()
        print(f"Collected {len(self.flows)} flows")
    
    def analyze_latency(self):
        """Analyze network latency patterns"""
        
        latencies = defaultdict(list)
        
        for flow in self.flows:
            if 'l7' in flow and 'http' in flow['l7']:
                source = flow.get('source', {}).get('labels', [])
                destination = flow.get('destination', {}).get('labels', [])
                
                # Extract service names
                src_service = next((label.split('=')[1] for label in source if label.startswith('k8s:app=')), 'unknown')
                dst_service = next((label.split('=')[1] for label in destination if label.startswith('k8s:app=')), 'unknown')
                
                service_pair = f"{src_service} -> {dst_service}"
                
                # Calculate latency (simplified)
                if 'time' in flow:
                    timestamp = flow['time']
                    # In real implementation, you'd calculate actual latency
                    # This is a placeholder for demonstration
                    latencies[service_pair].append(1.0)  # Mock latency
        
        # Analyze latency statistics
        latency_stats = {}
        for service_pair, values in latencies.items():
            if values:
                latency_stats[service_pair] = {
                    "count": len(values),
                    "mean": mean(values),
                    "std": stdev(values) if len(values) > 1 else 0,
                    "min": min(values),
                    "max": max(values)
                }
        
        return latency_stats
    
    def analyze_traffic_patterns(self):
        """Analyze traffic patterns and volumes"""
        
        traffic_stats = defaultdict(lambda: {"requests": 0, "bytes": 0})
        
        for flow in self.flows:
            source = flow.get('source', {}).get('labels', [])
            destination = flow.get('destination', {}).get('labels', [])
            
            src_service = next((label.split('=')[1] for label in source if label.startswith('k8s:app=')), 'unknown')
            dst_service = next((label.split('=')[1] for label in destination if label.startswith('k8s:app=')), 'unknown')
            
            service_pair = f"{src_service} -> {dst_service}"
            
            traffic_stats[service_pair]["requests"] += 1
            
            # Extract bytes if available
            if 'l7' in flow and 'http' in flow['l7']:
                # Mock byte calculation
                traffic_stats[service_pair]["bytes"] += 1024
        
        return dict(traffic_stats)
    
    def generate_report(self):
        """Generate comprehensive performance report"""
        
        latency_stats = self.analyze_latency()
        traffic_stats = self.analyze_traffic_patterns()
        
        report = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "total_flows": len(self.flows),
            "latency_analysis": latency_stats,
            "traffic_analysis": traffic_stats
        }
        
        return report

# Usage
analyzer = HubblePerformanceAnalyzer()
analyzer.collect_flows(60)
report = analyzer.generate_report()
print(json.dumps(report, indent=2))
```

### 2. Service Dependency Mapping

```bash
# Generate service dependency map
hubble observe --output json | jq -r '
  select(.source.labels and .destination.labels) |
  (.source.labels[] | select(startswith("k8s:app=")) | split("=")[1]) as $src |
  (.destination.labels[] | select(startswith("k8s:app=")) | split("=")[1]) as $dst |
  "\($src) -> \($dst)"
' | sort | uniq -c | sort -nr
```

## Grafana Integration

### 1. Hubble Metrics Dashboard

```yaml
# hubble-grafana-dashboard.json
{
  "dashboard": {
    "title": "GenAI Network Observability",
    "panels": [
      {
        "title": "Network Flow Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(hubble_flows_total[5m])",
            "legendFormat": "Flows/sec"
          }
        ]
      },
      {
        "title": "Dropped Packets",
        "type": "graph", 
        "targets": [
          {
            "expr": "rate(hubble_drop_total[5m])",
            "legendFormat": "Drops/sec"
          }
        ]
      },
      {
        "title": "HTTP Response Codes",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(hubble_http_requests_total[5m])",
            "legendFormat": "{{status_code}}"
          }
        ]
      }
    ]
  }
}
```

### 2. Deploy Grafana with Hubble Metrics

```yaml
# grafana-hubble.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
  namespace: kube-system
data:
  prometheus.yaml: |
    apiVersion: 1
    datasources:
    - name: Prometheus
      type: prometheus
      url: http://prometheus:9090
      access: proxy
      isDefault: true
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grafana
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: grafana
  template:
    metadata:
      labels:
        app: grafana
    spec:
      containers:
      - name: grafana
        image: grafana/grafana:latest
        ports:
        - containerPort: 3000
        env:
        - name: GF_SECURITY_ADMIN_PASSWORD
          value: "admin"
        volumeMounts:
        - name: grafana-datasources
          mountPath: /etc/grafana/provisioning/datasources
      volumes:
      - name: grafana-datasources
        configMap:
          name: grafana-datasources
```

## Security Monitoring

### 1. Threat Detection

```bash
# Monitor suspicious network activity
hubble observe --verdict DENIED --output json | jq -r '
  select(.verdict == "DENIED") |
  "DENIED: \(.source.namespace)/\(.source.pod_name) -> \(.destination.namespace)/\(.destination.pod_name) on port \(.destination.port)"
'

# Monitor unusual traffic patterns
hubble observe --output json | jq -r '
  select(.l7.http.code >= 400) |
  "HTTP Error: \(.l7.http.code) from \(.source.pod_name) to \(.destination.pod_name)"
'
```

### 2. Compliance Monitoring

```python
# compliance_monitor.py
import subprocess
import json
from datetime import datetime, timedelta

class ComplianceMonitor:
    def __init__(self):
        self.violations = []
    
    def check_network_policies(self):
        """Check for network policy violations"""
        
        cmd = ["hubble", "observe", "--verdict", "DENIED", "--output", "json", "--last", "100"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        for line in result.stdout.strip().split('\n'):
            if line:
                try:
                    flow = json.loads(line)
                    self.violations.append({
                        "type": "network_policy_violation",
                        "timestamp": flow.get('time'),
                        "source": flow.get('source', {}),
                        "destination": flow.get('destination', {}),
                        "reason": "Traffic denied by network policy"
                    })
                except json.JSONDecodeError:
                    continue
    
    def generate_compliance_report(self):
        """Generate compliance report"""
        
        self.check_network_policies()
        
        report = {
            "report_date": datetime.now().isoformat(),
            "total_violations": len(self.violations),
            "violations": self.violations,
            "compliance_status": "PASS" if len(self.violations) == 0 else "FAIL"
        }
        
        return report

# Usage
monitor = ComplianceMonitor()
report = monitor.generate_compliance_report()
print(json.dumps(report, indent=2))
```

## Troubleshooting

### Common Issues

1. **Hubble Not Collecting Flows**: Check Cilium configuration and restart pods
2. **UI Not Accessible**: Verify port forwarding and service configurations
3. **Missing Metrics**: Ensure Hubble metrics are enabled in Cilium config
4. **High Memory Usage**: Adjust flow retention settings

### Diagnostic Commands

```bash
# Check Cilium status
kubectl exec -n kube-system ds/cilium -- cilium status

# Check Hubble status
kubectl exec -n kube-system ds/cilium -- cilium hubble status

# View Hubble logs
kubectl logs -n kube-system ds/cilium -c hubble

# Test Hubble connectivity
kubectl exec -n kube-system ds/cilium -- hubble observe --last 10
```

## Best Practices

1. **Flow Retention**: Configure appropriate flow retention based on storage capacity
2. **Metrics Collection**: Enable relevant metrics for your use case
3. **Network Policies**: Use Hubble to validate network policy effectiveness
4. **Performance Impact**: Monitor the performance impact of observability
5. **Security**: Secure Hubble UI access in production environments

## Next Steps

Continue with [AI Gateway with LiteLLM](/module2-genai-components/ai-gateway/) to learn about unified API management for multiple LLM providers.