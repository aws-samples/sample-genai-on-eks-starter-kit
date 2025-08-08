---
title: "Model Quantization"
weight: 16
duration: "30 minutes"
difficulty: "intermediate"
---

# Model Quantization for Memory Optimization

Learn how to apply quantization techniques to reduce memory usage and improve inference speed while maintaining model quality.

## Overview

Quantization reduces the precision of model weights and activations, significantly decreasing memory requirements and potentially improving inference speed.

## Learning Objectives

By the end of this lab, you will be able to:
- Understand different quantization techniques (GPTQ, AWQ, GGUF)
- Apply quantization to reduce model memory footprint
- Deploy quantized models with vLLM
- Compare performance between quantized and full-precision models

## Prerequisites

- Completed [Tensor Parallelism](/module1-llm-optimization/inferencing/tensor-parallelism/)
- Understanding of model precision concepts
- Access to GPU nodes in your EKS cluster

## Quantization Techniques

### 1. GPTQ (GPT Quantization)
- Post-training quantization method
- 4-bit quantization with minimal quality loss
- Optimized for GPU inference

### 2. AWQ (Activation-aware Weight Quantization)
- Considers activation patterns during quantization
- Better quality preservation than GPTQ
- Efficient GPU implementation

### 3. GGUF (GPT-Generated Unified Format)
- Flexible quantization format
- Supports various bit widths (2-bit to 8-bit)
- CPU and GPU compatible

## Lab: Implementing Model Quantization

### Step 1: Prepare Quantized Models

Create a script to download pre-quantized models:

```python
# download_quantized_models.py
import os
from huggingface_hub import snapshot_download

def download_quantized_models():
    models = {
        "llama2-7b-gptq": "TheBloke/Llama-2-7B-Chat-GPTQ",
        "llama2-7b-awq": "TheBloke/Llama-2-7B-Chat-AWQ",
        "mistral-7b-gptq": "TheBloke/Mistral-7B-Instruct-v0.1-GPTQ"
    }
    
    base_path = "/models/quantized"
    os.makedirs(base_path, exist_ok=True)
    
    for model_name, repo_id in models.items():
        print(f"Downloading {model_name}...")
        model_path = os.path.join(base_path, model_name)
        
        snapshot_download(
            repo_id=repo_id,
            local_dir=model_path,
            local_dir_use_symlinks=False
        )
        print(f"Downloaded {model_name} to {model_path}")

if __name__ == "__main__":
    download_quantized_models()
```

### Step 2: Deploy GPTQ Quantized Model

```yaml
# gptq-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-llama2-gptq
  namespace: genai-models
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vllm-llama2-gptq
  template:
    metadata:
      labels:
        app: vllm-llama2-gptq
    spec:
      containers:
      - name: vllm-server
        image: vllm/vllm-openai:v0.2.7
        command:
        - python
        - -m
        - vllm.entrypoints.openai.api_server
        args:
        - --model=/models/quantized/llama2-7b-gptq
        - --quantization=gptq
        - --gpu-memory-utilization=0.8
        - --max-model-len=4096
        - --port=8000
        resources:
          requests:
            nvidia.com/gpu: 1
            memory: 8Gi  # Reduced memory requirement
            cpu: 2
          limits:
            nvidia.com/gpu: 1
            memory: 16Gi
            cpu: 4
        volumeMounts:
        - name: model-storage
          mountPath: /models
        ports:
        - containerPort: 8000
      volumes:
      - name: model-storage
        persistentVolumeClaim:
          claimName: model-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: vllm-llama2-gptq-service
  namespace: genai-models
spec:
  selector:
    app: vllm-llama2-gptq
  ports:
  - port: 8000
    targetPort: 8000
  type: ClusterIP
```

### Step 3: Deploy AWQ Quantized Model

```yaml
# awq-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-llama2-awq
  namespace: genai-models
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vllm-llama2-awq
  template:
    metadata:
      labels:
        app: vllm-llama2-awq
    spec:
      containers:
      - name: vllm-server
        image: vllm/vllm-openai:v0.2.7
        command:
        - python
        - -m
        - vllm.entrypoints.openai.api_server
        args:
        - --model=/models/quantized/llama2-7b-awq
        - --quantization=awq
        - --gpu-memory-utilization=0.8
        - --max-model-len=4096
        - --port=8000
        resources:
          requests:
            nvidia.com/gpu: 1
            memory: 8Gi
            cpu: 2
          limits:
            nvidia.com/gpu: 1
            memory: 16Gi
            cpu: 4
        volumeMounts:
        - name: model-storage
          mountPath: /models
        ports:
        - containerPort: 8000
      volumes:
      - name: model-storage
        persistentVolumeClaim:
          claimName: model-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: vllm-llama2-awq-service
  namespace: genai-models
spec:
  selector:
    app: vllm-llama2-awq
  ports:
  - port: 8000
    targetPort: 8000
  type: ClusterIP
```

### Step 4: Performance Comparison Script

```python
# quantization_benchmark.py
import asyncio
import aiohttp
import time
import json
from statistics import mean

async def test_model_performance(session, url, model_name, prompts):
    results = []
    
    for prompt in prompts:
        start_time = time.time()
        payload = {
            "model": model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 100,
            "temperature": 0.7
        }
        
        try:
            async with session.post(f"{url}/v1/chat/completions", 
                                   json=payload) as response:
                result = await response.json()
                end_time = time.time()
                
                if response.status == 200:
                    results.append({
                        "latency": end_time - start_time,
                        "tokens": len(result["choices"][0]["message"]["content"].split()),
                        "quality_score": len(result["choices"][0]["message"]["content"])  # Simple quality metric
                    })
        except Exception as e:
            print(f"Error testing {model_name}: {e}")
    
    return results

async def compare_quantization_methods():
    models = {
        "fp16": {"url": "http://vllm-llama2-fp16-service:8000", "name": "llama-2-7b-hf"},
        "gptq": {"url": "http://vllm-llama2-gptq-service:8000", "name": "llama-2-7b-gptq"},
        "awq": {"url": "http://vllm-llama2-awq-service:8000", "name": "llama-2-7b-awq"}
    }
    
    test_prompts = [
        "Explain quantum computing in simple terms.",
        "What are the benefits of renewable energy?",
        "How does machine learning work?",
        "Describe the process of photosynthesis.",
        "What is the importance of data privacy?"
    ]
    
    results = {}
    
    async with aiohttp.ClientSession() as session:
        for quant_type, config in models.items():
            print(f"Testing {quant_type} model...")
            model_results = await test_model_performance(
                session, config["url"], config["name"], test_prompts
            )
            
            if model_results:
                results[quant_type] = {
                    "avg_latency": mean([r["latency"] for r in model_results]),
                    "avg_tokens": mean([r["tokens"] for r in model_results]),
                    "avg_quality": mean([r["quality_score"] for r in model_results]),
                    "memory_usage": "TBD"  # Would need to query metrics
                }
            else:
                results[quant_type] = {"error": "No successful responses"}
    
    return results

async def memory_usage_comparison():
    """Compare memory usage between different quantization methods"""
    # This would typically query Prometheus metrics
    memory_usage = {
        "fp16": "~13GB",
        "gptq": "~4GB", 
        "awq": "~4GB",
        "gguf_q4": "~3.5GB",
        "gguf_q8": "~7GB"
    }
    return memory_usage

if __name__ == "__main__":
    print("Running quantization performance comparison...")
    perf_results = asyncio.run(compare_quantization_methods())
    memory_results = asyncio.run(memory_usage_comparison())
    
    print("\nPerformance Results:")
    print(json.dumps(perf_results, indent=2))
    
    print("\nMemory Usage Comparison:")
    print(json.dumps(memory_results, indent=2))
```

### Step 5: Deploy and Test

```bash
# Deploy quantized models
kubectl apply -f gptq-deployment.yaml
kubectl apply -f awq-deployment.yaml

# Wait for deployments to be ready
kubectl wait --for=condition=available --timeout=300s deployment/vllm-llama2-gptq -n genai-models
kubectl wait --for=condition=available --timeout=300s deployment/vllm-llama2-awq -n genai-models

# Run performance comparison
python quantization_benchmark.py
```

## Performance Analysis

### Expected Results

| Method | Memory Usage | Latency | Quality | Use Case |
|--------|-------------|---------|---------|----------|
| FP16   | ~13GB       | Baseline| Highest | High-quality inference |
| GPTQ   | ~4GB        | +10-20% | 95-98%  | Balanced performance |
| AWQ    | ~4GB        | +5-15%  | 96-99%  | Quality-focused |
| GGUF Q4| ~3.5GB      | +15-25% | 90-95%  | Memory-constrained |

### Quality Assessment

Test model quality with evaluation prompts:

```python
# quality_assessment.py
import asyncio
import aiohttp

async def quality_test():
    test_cases = [
        {
            "prompt": "Solve this math problem: What is 15% of 240?",
            "expected_answer": "36"
        },
        {
            "prompt": "Name the capital of France.",
            "expected_answer": "Paris"
        },
        {
            "prompt": "What is the chemical symbol for gold?",
            "expected_answer": "Au"
        }
    ]
    
    models = ["fp16", "gptq", "awq"]
    
    for model in models:
        print(f"\nTesting {model} model quality:")
        # Implementation would test each model and compare answers
        pass

if __name__ == "__main__":
    asyncio.run(quality_test())
```

## Best Practices

### 1. Choosing Quantization Method

- **GPTQ**: Good balance of speed and quality
- **AWQ**: Better quality preservation, slightly slower
- **GGUF**: Most flexible, good for CPU inference

### 2. Memory Planning

```yaml
# Resource allocation for quantized models
resources:
  requests:
    nvidia.com/gpu: 1
    memory: 8Gi    # Reduced from 16Gi for FP16
    cpu: 2
  limits:
    nvidia.com/gpu: 1
    memory: 12Gi   # Safety margin
    cpu: 4
```

### 3. Quality Validation

Always validate model quality after quantization:

```bash
# Quick quality check
curl -X POST "http://vllm-llama2-gptq-service:8000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-2-7b-gptq",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "max_tokens": 10
  }'
```

## Troubleshooting

### Common Issues

1. **Quantization Loading Errors**: Ensure correct quantization method specified
2. **Quality Degradation**: Try different quantization methods or higher bit-width
3. **Memory Issues**: Even quantized models need sufficient GPU memory

### Monitoring

```bash
# Monitor GPU memory usage
kubectl exec -it deployment/vllm-llama2-gptq -n genai-models -- nvidia-smi

# Check model loading logs
kubectl logs deployment/vllm-llama2-gptq -n genai-models
```

## Next Steps

Continue with [KV Cache Optimization](/module1-llm-optimization/inferencing/kv-cache/) to learn about attention caching techniques.