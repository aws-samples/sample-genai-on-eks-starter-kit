---
title: "LLM Inferencing with LeaderWorkerSet"
weight: 21
duration: "45 minutes"
---

# LLM Inferencing with LeaderWorkerSet

In this section, you'll learn how to deploy and scale LLMs using LeaderWorkerSet (LWS) for efficient parallel inferencing on Amazon EKS.

## What is LeaderWorkerSet?

LeaderWorkerSet (LWS) is a Kubernetes operator that enables you to deploy distributed workloads with a leader-worker pattern. It's particularly useful for LLM inference where you need to coordinate multiple GPU workers.

## Key Benefits

- **Scalability**: Automatically scale inference workers based on demand
- **Fault Tolerance**: Handle worker failures gracefully
- **Resource Efficiency**: Optimal GPU utilization across nodes
- **Load Distribution**: Distribute inference requests across multiple workers

## Setting Up LWS

### 1. Install LeaderWorkerSet Operator

First, install the LWS operator in your EKS cluster:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/lws/releases/latest/download/manifests.yaml
```

### 2. Deploy vLLM with LWS

Create a LeaderWorkerSet configuration for vLLM:

```yaml
apiVersion: leaderworkerset.x-k8s.io/v1
kind: LeaderWorkerSet
metadata:
  name: vllm-llama2-7b
  namespace: default
spec:
  replicas: 2
  leaderWorkerTemplate:
    size: 4
    leaderTemplate:
      spec:
        containers:
        - name: vllm
          image: vllm/vllm-openai:latest
          ports:
          - containerPort: 8000
          env:
          - name: MODEL_NAME
            value: "meta-llama/Llama-2-7b-hf"
          - name: TENSOR_PARALLEL_SIZE
            value: "4"
          resources:
            requests:
              nvidia.com/gpu: 1
            limits:
              nvidia.com/gpu: 1
        nodeSelector:
          nvidia.com/gpu: "true"
```

### 3. Deploy the Configuration

```bash
kubectl apply -f vllm-lws.yaml
```

## Lab Exercise: Deploy Your First LLM

### Step 1: Check GPU Nodes
```bash
kubectl get nodes -l nvidia.com/gpu=true
```

### Step 2: Deploy the LWS Configuration
```bash
kubectl apply -f vllm-lws.yaml
kubectl get lws vllm-llama2-7b -w
```

### Step 3: Test the Deployment
```bash
# Port forward to test
kubectl port-forward svc/vllm-llama2-7b 8000:8000

# Test inference
curl -X POST "http://localhost:8000/v1/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/Llama-2-7b-hf",
    "prompt": "The future of AI is",
    "max_tokens": 50,
    "temperature": 0.7
  }'
```

## Performance Monitoring

Monitor your LWS deployment:

```bash
# Check pod status
kubectl get pods -l leaderworkerset.sigs.k8s.io/name=vllm-llama2-7b

# Check resource usage
kubectl top pods -l leaderworkerset.sigs.k8s.io/name=vllm-llama2-7b

# Check logs
kubectl logs -l leaderworkerset.sigs.k8s.io/name=vllm-llama2-7b
```

## What's Next?

Now that you have basic LLM inferencing working, let's explore optimization techniques:
- [Tensor Parallelism](/module1-llm-optimization/inferencing/tensor-parallelism/)
- [Quantization](/module1-llm-optimization/inferencing/quantization/)
- [KV Cache Optimization](/module1-llm-optimization/inferencing/kv-cache/) 