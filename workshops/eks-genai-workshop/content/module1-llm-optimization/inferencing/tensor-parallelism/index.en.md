---
title: "Tensor Parallelism"
weight: 15
duration: "30 minutes"
difficulty: "intermediate"
---

# Tensor Parallelism for Large Language Models

Learn how to implement tensor parallelism to distribute large language models across multiple GPUs for improved performance and memory efficiency.

## Overview

Tensor parallelism is a technique that splits individual model layers across multiple GPUs, allowing you to run models that are too large to fit on a single GPU's memory.

## Learning Objectives

By the end of this lab, you will be able to:
- Understand tensor parallelism concepts and benefits
- Configure vLLM for tensor parallel inference
- Deploy multi-GPU model serving with LeaderWorkerSet
- Monitor and optimize tensor parallel performance

## Prerequisites

- Completed [LWS and Parallel Inferencing](/module1-llm-optimization/inferencing/)
- GPU nodes available in your EKS cluster
- Basic understanding of model sharding concepts

## Lab: Implementing Tensor Parallelism

### Step 1: Configure Tensor Parallel vLLM Deployment

Create a tensor parallel configuration for Llama 2 7B model:

```yaml
# tensor-parallel-llama2.yaml
apiVersion: leaderworkerset.x-k8s.io/v1
kind: LeaderWorkerSet
metadata:
  name: vllm-llama2-tp
  namespace: genai-models
spec:
  replicas: 1
  leaderWorkerTemplate:
    size: 2  # 2 GPUs for tensor parallelism
    leaderTemplate:
      spec:
        containers:
        - name: vllm-server
          image: vllm/vllm-openai:v0.2.7
          command:
          - python
          - -m
          - vllm.entrypoints.openai.api_server
          args:
          - --model=/models/llama-2-7b-hf
          - --tensor-parallel-size=2
          - --gpu-memory-utilization=0.9
          - --max-model-len=4096
          - --port=8000
          resources:
            requests:
              nvidia.com/gpu: 1
              memory: 16Gi
              cpu: 4
            limits:
              nvidia.com/gpu: 1
              memory: 32Gi
              cpu: 8
          volumeMounts:
          - name: model-storage
            mountPath: /models
        volumes:
        - name: model-storage
          persistentVolumeClaim:
            claimName: model-pvc
    workerTemplate:
      spec:
        containers:
        - name: vllm-worker
          image: vllm/vllm-openai:v0.2.7
          command:
          - python
          - -m
          - vllm.entrypoints.openai.api_server
          args:
          - --model=/models/llama-2-7b-hf
          - --tensor-parallel-size=2
          - --gpu-memory-utilization=0.9
          - --max-model-len=4096
          - --port=8000
          resources:
            requests:
              nvidia.com/gpu: 1
              memory: 16Gi
              cpu: 4
            limits:
              nvidia.com/gpu: 1
              memory: 32Gi
              cpu: 8
          volumeMounts:
          - name: model-storage
            mountPath: /models
        volumes:
        - name: model-storage
          persistentVolumeClaim:
            claimName: model-pvc
```

### Step 2: Deploy the Tensor Parallel Configuration

```bash
# Apply the tensor parallel deployment
kubectl apply -f tensor-parallel-llama2.yaml

# Check the deployment status
kubectl get lws -n genai-models
kubectl get pods -n genai-models -l leaderworkerset.sigs.k8s.io/name=vllm-llama2-tp
```

### Step 3: Test Tensor Parallel Performance

Create a performance test script:

```python
# test_tensor_parallel.py
import asyncio
import aiohttp
import time
import json
from statistics import mean, stdev

async def test_inference(session, url, prompt, semaphore):
    async with semaphore:
        start_time = time.time()
        payload = {
            "model": "llama-2-7b-hf",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 100,
            "temperature": 0.7
        }
        
        async with session.post(f"{url}/v1/chat/completions", 
                               json=payload) as response:
            result = await response.json()
            end_time = time.time()
            
            return {
                "latency": end_time - start_time,
                "tokens": len(result.get("choices", [{}])[0].get("message", {}).get("content", "").split()),
                "status": response.status
            }

async def benchmark_tensor_parallel():
    url = "http://vllm-llama2-tp-service:8000"
    prompts = [
        "Explain the concept of tensor parallelism in machine learning.",
        "What are the benefits of distributed model inference?",
        "How does GPU memory affect model performance?",
        "Describe the architecture of a transformer model.",
        "What is the difference between data and model parallelism?"
    ]
    
    # Test with different concurrency levels
    concurrency_levels = [1, 5, 10, 20]
    results = {}
    
    async with aiohttp.ClientSession() as session:
        for concurrency in concurrency_levels:
            print(f"Testing with concurrency: {concurrency}")
            semaphore = asyncio.Semaphore(concurrency)
            
            tasks = []
            for i in range(50):  # 50 requests per concurrency level
                prompt = prompts[i % len(prompts)]
                tasks.append(test_inference(session, url, prompt, semaphore))
            
            test_results = await asyncio.gather(*tasks)
            
            # Calculate statistics
            latencies = [r["latency"] for r in test_results if r["status"] == 200]
            throughput = len(latencies) / sum(latencies) if latencies else 0
            
            results[concurrency] = {
                "avg_latency": mean(latencies) if latencies else 0,
                "std_latency": stdev(latencies) if len(latencies) > 1 else 0,
                "throughput": throughput,
                "success_rate": len(latencies) / len(test_results)
            }
            
            print(f"Concurrency {concurrency}: Avg Latency: {results[concurrency]['avg_latency']:.2f}s, "
                  f"Throughput: {results[concurrency]['throughput']:.2f} req/s")
    
    return results

if __name__ == "__main__":
    results = asyncio.run(benchmark_tensor_parallel())
    print("\nTensor Parallel Performance Results:")
    print(json.dumps(results, indent=2))
```

### Step 4: Monitor GPU Utilization

```bash
# Monitor GPU usage across nodes
kubectl exec -it deployment/nvidia-device-plugin-daemonset -n kube-system -- nvidia-smi

# Check memory usage
kubectl top nodes
kubectl top pods -n genai-models
```

## Performance Analysis

### Expected Results

With tensor parallelism, you should observe:

1. **Memory Distribution**: Model weights split across GPUs
2. **Improved Throughput**: Better utilization of available GPU resources
3. **Reduced Latency**: Parallel computation of model layers
4. **Scalability**: Ability to serve larger models

### Optimization Tips

1. **GPU Memory Utilization**: Adjust `--gpu-memory-utilization` based on your GPU memory
2. **Tensor Parallel Size**: Match the number of GPUs available
3. **Batch Size**: Optimize batch size for your workload
4. **Model Sharding**: Consider pipeline parallelism for very large models

## Troubleshooting

### Common Issues

1. **CUDA Out of Memory**: Reduce `--gpu-memory-utilization` or model size
2. **Communication Errors**: Check network connectivity between GPU nodes
3. **Uneven Load**: Verify GPU resources are properly allocated

### Validation Steps

```bash
# Check if tensor parallelism is working
kubectl logs -n genai-models -l leaderworkerset.sigs.k8s.io/name=vllm-llama2-tp

# Verify model loading
curl -X POST "http://vllm-llama2-tp-service:8000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-2-7b-hf",
    "messages": [{"role": "user", "content": "Hello, how are you?"}],
    "max_tokens": 50
  }'
```

## Next Steps

Continue with [Quantization](/module1-llm-optimization/inferencing/quantization/) to learn about memory optimization techniques.