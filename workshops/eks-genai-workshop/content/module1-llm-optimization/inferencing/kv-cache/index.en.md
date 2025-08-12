---
title: "KV Cache Optimization"
weight: 17
duration: "25 minutes"
difficulty: "intermediate"
---

# KV Cache Optimization for Reduced Latency

Learn how to optimize Key-Value (KV) cache to reduce inference latency and improve throughput for transformer-based language models.

## Overview

KV cache stores computed key and value tensors from previous tokens, eliminating the need to recompute them for each new token generation. Proper optimization can significantly reduce latency.

## Learning Objectives

By the end of this lab, you will be able to:
- Understand KV cache mechanics in transformer models
- Configure KV cache settings in vLLM
- Optimize cache size and memory allocation
- Monitor cache hit rates and performance improvements

## Prerequisites

- Completed [Model Quantization](/module1-llm-optimization/inferencing/quantization/)
- Understanding of transformer attention mechanisms
- Access to GPU nodes with sufficient memory

## KV Cache Fundamentals

### How KV Cache Works

```python
# Conceptual KV Cache Implementation
class KVCache:
    def __init__(self, max_seq_len, num_heads, head_dim):
        self.max_seq_len = max_seq_len
        self.num_heads = num_heads
        self.head_dim = head_dim
        
        # Pre-allocate cache tensors
        self.key_cache = torch.zeros(max_seq_len, num_heads, head_dim)
        self.value_cache = torch.zeros(max_seq_len, num_heads, head_dim)
        self.cache_len = 0
    
    def update(self, new_keys, new_values):
        # Store new keys and values
        seq_len = new_keys.size(0)
        self.key_cache[self.cache_len:self.cache_len + seq_len] = new_keys
        self.value_cache[self.cache_len:self.cache_len + seq_len] = new_values
        self.cache_len += seq_len
    
    def get_cached_kv(self):
        return (
            self.key_cache[:self.cache_len],
            self.value_cache[:self.cache_len]
        )
```

### Memory Requirements

KV cache memory usage calculation:
```
Memory = 2 * num_layers * num_heads * head_dim * max_seq_len * batch_size * precision_bytes
```

## Lab: Implementing KV Cache Optimization

### Step 1: Configure KV Cache Settings

Create optimized vLLM deployment with KV cache tuning:

```yaml
# kv-cache-optimized.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-kv-optimized
  namespace: genai-models
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vllm-kv-optimized
  template:
    metadata:
      labels:
        app: vllm-kv-optimized
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
        - --gpu-memory-utilization=0.85
        - --max-model-len=4096
        - --max-num-batched-tokens=8192
        - --max-num-seqs=256
        - --block-size=16  # KV cache block size
        - --swap-space=4   # GB of CPU memory for KV cache swapping
        - --port=8000
        env:
        - name: VLLM_ATTENTION_BACKEND
          value: "FLASHINFER"  # Optimized attention backend
        resources:
          requests:
            nvidia.com/gpu: 1
            memory: 16Gi
            cpu: 4
          limits:
            nvidia.com/gpu: 1
            memory: 24Gi
            cpu: 8
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
  name: vllm-kv-optimized-service
  namespace: genai-models
spec:
  selector:
    app: vllm-kv-optimized
  ports:
  - port: 8000
    targetPort: 8000
  type: ClusterIP
```

### Step 2: KV Cache Performance Testing

Create a comprehensive performance test:

```python
# kv_cache_benchmark.py
import asyncio
import aiohttp
import time
import json
from statistics import mean, stdev
import matplotlib.pyplot as plt

class KVCacheBenchmark:
    def __init__(self, base_url):
        self.base_url = base_url
        self.results = []
    
    async def test_sequence_lengths(self, session):
        """Test performance with different sequence lengths"""
        sequence_lengths = [100, 500, 1000, 2000, 4000]
        
        for seq_len in sequence_lengths:
            # Generate prompt of specific length
            prompt = "Explain artificial intelligence. " * (seq_len // 30)
            
            latencies = []
            for _ in range(5):  # 5 runs per sequence length
                start_time = time.time()
                
                payload = {
                    "model": "llama-2-7b-hf",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 100,
                    "temperature": 0.7
                }
                
                try:
                    async with session.post(f"{self.base_url}/v1/chat/completions", 
                                           json=payload) as response:
                        await response.json()
                        end_time = time.time()
                        latencies.append(end_time - start_time)
                except Exception as e:
                    print(f"Error with sequence length {seq_len}: {e}")
            
            if latencies:
                self.results.append({
                    "sequence_length": seq_len,
                    "avg_latency": mean(latencies),
                    "std_latency": stdev(latencies) if len(latencies) > 1 else 0,
                    "min_latency": min(latencies),
                    "max_latency": max(latencies)
                })
                
                print(f"Seq Length {seq_len}: Avg {mean(latencies):.2f}s ± {stdev(latencies) if len(latencies) > 1 else 0:.2f}s")
    
    async def test_concurrent_requests(self, session):
        """Test KV cache efficiency with concurrent requests"""
        concurrent_levels = [1, 5, 10, 20, 50]
        prompt = "What is machine learning and how does it work?"
        
        concurrent_results = []
        
        for concurrency in concurrent_levels:
            print(f"Testing concurrency level: {concurrency}")
            semaphore = asyncio.Semaphore(concurrency)
            
            async def single_request():
                async with semaphore:
                    start_time = time.time()
                    payload = {
                        "model": "llama-2-7b-hf",
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 50,
                        "temperature": 0.7
                    }
                    
                    async with session.post(f"{self.base_url}/v1/chat/completions", 
                                           json=payload) as response:
                        await response.json()
                        return time.time() - start_time
            
            # Run concurrent requests
            tasks = [single_request() for _ in range(concurrency * 2)]
            latencies = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Filter out exceptions
            valid_latencies = [l for l in latencies if isinstance(l, (int, float))]
            
            if valid_latencies:
                concurrent_results.append({
                    "concurrency": concurrency,
                    "avg_latency": mean(valid_latencies),
                    "throughput": len(valid_latencies) / sum(valid_latencies),
                    "success_rate": len(valid_latencies) / len(latencies)
                })
        
        return concurrent_results
    
    async def test_cache_warming(self, session):
        """Test the effect of cache warming on performance"""
        base_prompt = "Explain the concept of"
        topics = ["machine learning", "quantum computing", "blockchain", "artificial intelligence"]
        
        # Cold cache test
        cold_latencies = []
        for topic in topics:
            prompt = f"{base_prompt} {topic} in detail."
            start_time = time.time()
            
            payload = {
                "model": "llama-2-7b-hf",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 100,
                "temperature": 0.7
            }
            
            async with session.post(f"{self.base_url}/v1/chat/completions", 
                                   json=payload) as response:
                await response.json()
                cold_latencies.append(time.time() - start_time)
        
        # Warm cache test (repeat same requests)
        warm_latencies = []
        for topic in topics:
            prompt = f"{base_prompt} {topic} in detail."
            start_time = time.time()
            
            payload = {
                "model": "llama-2-7b-hf",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 100,
                "temperature": 0.7
            }
            
            async with session.post(f"{self.base_url}/v1/chat/completions", 
                                   json=payload) as response:
                await response.json()
                warm_latencies.append(time.time() - start_time)
        
        return {
            "cold_cache_avg": mean(cold_latencies),
            "warm_cache_avg": mean(warm_latencies),
            "improvement": (mean(cold_latencies) - mean(warm_latencies)) / mean(cold_latencies) * 100
        }

async def run_kv_cache_benchmark():
    benchmark = KVCacheBenchmark("http://vllm-kv-optimized-service:8000")
    
    async with aiohttp.ClientSession() as session:
        print("Testing sequence length performance...")
        await benchmark.test_sequence_lengths(session)
        
        print("\nTesting concurrent request performance...")
        concurrent_results = await benchmark.test_concurrent_requests(session)
        
        print("\nTesting cache warming effects...")
        cache_results = await benchmark.test_cache_warming(session)
        
        return {
            "sequence_performance": benchmark.results,
            "concurrent_performance": concurrent_results,
            "cache_warming": cache_results
        }

if __name__ == "__main__":
    results = asyncio.run(run_kv_cache_benchmark())
    print("\nKV Cache Optimization Results:")
    print(json.dumps(results, indent=2))
```

### Step 3: Memory Usage Monitoring

Create a monitoring script for KV cache memory usage:

```python
# kv_cache_monitor.py
import subprocess
import json
import time
import requests

def get_gpu_memory_usage():
    """Get GPU memory usage from nvidia-smi"""
    try:
        result = subprocess.run([
            'nvidia-smi', '--query-gpu=memory.used,memory.total', 
            '--format=csv,noheader,nounits'
        ], capture_output=True, text=True)
        
        lines = result.stdout.strip().split('\n')
        gpu_memory = []
        for line in lines:
            used, total = map(int, line.split(', '))
            gpu_memory.append({
                "used_mb": used,
                "total_mb": total,
                "utilization": used / total * 100
            })
        return gpu_memory
    except Exception as e:
        print(f"Error getting GPU memory: {e}")
        return []

def get_vllm_stats(base_url):
    """Get vLLM internal statistics"""
    try:
        response = requests.get(f"{base_url}/stats")
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        print(f"Error getting vLLM stats: {e}")
    return {}

def monitor_kv_cache_usage(duration_minutes=10):
    """Monitor KV cache usage over time"""
    base_url = "http://vllm-kv-optimized-service:8000"
    monitoring_data = []
    
    end_time = time.time() + (duration_minutes * 60)
    
    while time.time() < end_time:
        timestamp = time.time()
        gpu_memory = get_gpu_memory_usage()
        vllm_stats = get_vllm_stats(base_url)
        
        monitoring_data.append({
            "timestamp": timestamp,
            "gpu_memory": gpu_memory,
            "vllm_stats": vllm_stats
        })
        
        print(f"Time: {time.strftime('%H:%M:%S')}, "
              f"GPU Memory: {gpu_memory[0]['used_mb'] if gpu_memory else 'N/A'}MB")
        
        time.sleep(30)  # Monitor every 30 seconds
    
    return monitoring_data

if __name__ == "__main__":
    print("Starting KV cache monitoring...")
    data = monitor_kv_cache_usage(5)  # Monitor for 5 minutes
    
    with open("kv_cache_monitoring.json", "w") as f:
        json.dump(data, f, indent=2)
    
    print("Monitoring complete. Data saved to kv_cache_monitoring.json")
```

### Step 4: Deploy and Test

```bash
# Deploy KV cache optimized model
kubectl apply -f kv-cache-optimized.yaml

# Wait for deployment
kubectl wait --for=condition=available --timeout=300s deployment/vllm-kv-optimized -n genai-models

# Run benchmarks
python kv_cache_benchmark.py

# Monitor memory usage
python kv_cache_monitor.py
```

## Performance Analysis

### Expected Improvements

1. **Latency Reduction**: 20-40% improvement for longer sequences
2. **Memory Efficiency**: Better GPU memory utilization
3. **Throughput**: Higher requests per second with proper caching

### KV Cache Configuration Guidelines

```yaml
# Optimal settings for different scenarios
args:
  # For high throughput
  - --max-num-seqs=256
  - --max-num-batched-tokens=8192
  - --block-size=16
  
  # For long sequences
  - --max-model-len=8192
  - --swap-space=8
  
  # For memory-constrained environments
  - --gpu-memory-utilization=0.8
  - --block-size=8
```

## Advanced Optimization Techniques

### 1. Dynamic KV Cache Scaling

```python
# Dynamic cache configuration based on workload
def calculate_optimal_cache_size(avg_seq_len, concurrent_requests, gpu_memory_gb):
    # Simplified calculation
    cache_memory_per_seq = avg_seq_len * 0.001  # GB per sequence
    total_cache_memory = cache_memory_per_seq * concurrent_requests
    
    # Reserve 70% of GPU memory for KV cache
    available_memory = gpu_memory_gb * 0.7
    
    if total_cache_memory > available_memory:
        # Reduce sequence length or enable swapping
        return {
            "max_seq_len": int(avg_seq_len * (available_memory / total_cache_memory)),
            "enable_swap": True,
            "swap_space": 4
        }
    else:
        return {
            "max_seq_len": avg_seq_len,
            "enable_swap": False,
            "swap_space": 0
        }
```

### 2. Cache Preloading

```python
# Preload common patterns into KV cache
async def preload_cache(session, base_url, common_prompts):
    """Preload KV cache with common prompt patterns"""
    for prompt in common_prompts:
        payload = {
            "model": "llama-2-7b-hf",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1,  # Minimal generation for cache loading
            "temperature": 0.0
        }
        
        async with session.post(f"{base_url}/v1/chat/completions", 
                               json=payload) as response:
            await response.json()
    
    print("Cache preloading complete")
```

## Troubleshooting

### Common Issues

1. **Out of Memory Errors**: Reduce `max-num-seqs` or `max-model-len`
2. **Cache Misses**: Check if requests are similar enough to benefit from caching
3. **Swap Thrashing**: Increase GPU memory allocation or reduce concurrent requests

### Monitoring Commands

```bash
# Check GPU memory usage
kubectl exec -it deployment/vllm-kv-optimized -n genai-models -- nvidia-smi

# View vLLM logs for cache statistics
kubectl logs deployment/vllm-kv-optimized -n genai-models | grep -i cache

# Monitor pod resource usage
kubectl top pod -n genai-models
```

### Performance Validation

```bash
# Quick performance test
curl -X POST "http://vllm-kv-optimized-service:8000/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-2-7b-hf",
    "messages": [{"role": "user", "content": "Explain KV cache optimization in transformers."}],
    "max_tokens": 100
  }' \
  -w "Time: %{time_total}s\n"
```

## Best Practices

1. **Memory Planning**: Reserve 60-80% of GPU memory for KV cache
2. **Batch Size Optimization**: Balance between throughput and latency
3. **Sequence Length Management**: Set appropriate limits based on use case
4. **Monitoring**: Continuously monitor cache hit rates and memory usage

## Next Steps

Continue with [LLM Evaluation](/module1-llm-optimization/evaluation/) to learn about model performance assessment techniques.