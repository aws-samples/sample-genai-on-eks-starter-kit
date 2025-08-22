---
title: "vLLM - Self-Hosted Model Serving"
weight: 22
---

# vLLM - Self-Hosted Model Serving

vLLM is a high-performance inference engine for Large Language Models, optimized for throughput and latency. In this section, we'll explore how we've deployed Llama 3.1 8B and Qwen3 8B models on Amazon EKS using AWS Neuron hardware for cost-effective inference.

## What is vLLM?

vLLM is an open-source LLM inference and serving library that provides:

- ⚡ **High Throughput**: 24x higher throughput than HuggingFace Transformers
- 🔄 **Continuous Batching**: Dynamic request batching for optimal GPU/NPU utilization
- 📊 **PagedAttention**: Efficient memory management for long contexts
- 🔧 **Tensor Parallelism**: Distribute models across multiple accelerators
- 🎯 **OpenAI Compatible API**: Drop-in replacement for OpenAI API
- 🧠 **Neuron Support**: Optimized for AWS Inferentia and Trainium chips

## AWS Neuron: Purpose-Built for AI

AWS Neuron is the SDK for AWS Inferentia (inf2) and Trainium (trn1) chips:

- **Cost Efficiency**: Up to 50% lower cost per inference vs GPUs
- **Optimized for LLMs**: Native support for transformer architectures
- **Quantization**: INT8 and FP8 support for reduced memory usage
- **Compilation**: Pre-compiled models for optimal performance

::alert[**Workshop Constraint**: We're using inf2.xlarge instances (2 Neuron cores) due to workshop limitations. Production deployments typically use inf2.8xlarge or larger for better performance.]{type="warning"}

## Kubernetes Architecture

Let's examine how vLLM is deployed on EKS by exploring the actual YAML manifests used in your environment.

### 1. Namespace Isolation

First, we create a dedicated namespace for vLLM workloads:

:::code{language=yaml showCopyAction=true}
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: vllm
:::

This provides:
- **Resource Isolation**: Separate from other workloads
- **Security Boundaries**: Network policies and RBAC can be applied
- **Resource Quotas**: Limit resource consumption if needed

### 2. Persistent Storage for Model Caching

We use Amazon EFS to cache downloaded models and compiled Neuron graphs:

:::code{language=yaml showCopyAction=true}
# pvc-huggingface-cache.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: huggingface-cache
  namespace: vllm
spec:
  storageClassName: efs
  accessModes:
    - ReadWriteMany  # Multiple pods can read/write
  resources:
    requests:
      storage: 100Gi

---
# pvc-neuron-cache.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: neuron-cache
  namespace: vllm
spec:
  storageClassName: efs
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 100Gi
:::

**Why Two Caches?**
- **HuggingFace Cache**: Stores downloaded model weights (~15GB per model)
- **Neuron Cache**: Stores compiled model graphs (~10GB per model)
- **Reusability**: Cached data persists across pod restarts

### 3. Secrets Management

The HuggingFace token is stored securely:

:::code{language=yaml showCopyAction=true}
# secret.template.yaml
apiVersion: v1
kind: Secret
metadata:
  name: hf-token
  namespace: vllm
type: Opaque
stringData:
  token: ${HF_TOKEN}  # Injected during deployment
:::

### 4. Model Deployment Manifest

Here's the complete deployment for Llama 3.1 8B with Neuron optimization:

:::code{language=yaml showCopyAction=true}
# model-llama-3-1-8b-int8-neuron.yaml (simplified)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-3-1-8b-int8-neuron
  namespace: vllm
spec:
  replicas: 1
  selector:
    matchLabels:
      app: llama-3-1-8b-int8-neuron
  template:
    metadata:
      labels:
        app: llama-3-1-8b-int8-neuron
    spec:
      # Security context for pod
      securityContext:
        seccompProfile:
          type: RuntimeDefault
      automountServiceAccountToken: false
      
      # Node selection for Neuron hardware
      nodeSelector:
        eks.amazonaws.com/instance-family: inf2
        node.kubernetes.io/instance-type: inf2.xlarge
      
      containers:
        - name: vllm
          image: public.ecr.aws/t0h7h1e6/vllm-neuron:llama-3-1-8b-int8
          imagePullPolicy: IfNotPresent
          
          # Security settings
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - NET_RAW
                
          # vLLM server command
          command: ["vllm", "serve"]
          args:
            # Model configuration
            - /opt/vllm/huggingface-cache/Llama-3.1-8B-Instruct/...
            - --served-model-name=llama-3-1-8b-int8-neuron
            - --trust-remote-code
            
            # Performance settings
            - --gpu-memory-utilization=0.90
            - --max-model-len=8192  # 8K context
            
            # Llama 3.1 specific features
            - --enable-auto-tool-choice
            - --tool-call-parser=llama3_json
            - --chat-template=examples/tool_chat_template_llama3.1_json.jinja
            
            # Neuron optimization
            - --tensor-parallel-size=2  # Use both Neuron cores
            - --max-num-seqs=4  # Concurrent sequences
            - '--override-neuron-config={"quantized": true, ...}'
          
          # Environment variables
          env:
            - name: NEURON_COMPILED_ARTIFACTS
              value: /opt/vllm/neuron-cache/Llama-3.1-8B-Instruct-int8
          
          # Networking
          ports:
            - name: http
              containerPort: 8000
          
          # Resource allocation
          resources:
            requests:
              cpu: 3
              memory: 12Gi
              aws.amazon.com/neuroncore: 2  # Request 2 Neuron cores
            limits:
              aws.amazon.com/neuroncore: 2
      
      # Tolerations for Neuron nodes
      tolerations:
        - key: aws.amazon.com/neuron
          operator: Exists
          effect: NoSchedule

---
# Service to expose the deployment
apiVersion: v1
kind: Service
metadata:
  name: llama-3-1-8b-int8-neuron
  namespace: vllm
spec:
  selector:
    app: llama-3-1-8b-int8-neuron
  ports:
    - name: http
      port: 8000
:::

### Key Configuration Details

#### **Node Selection**
```yaml
nodeSelector:
  eks.amazonaws.com/instance-family: inf2
  node.kubernetes.io/instance-type: inf2.xlarge
```
- Ensures pods run only on Neuron-equipped instances
- inf2.xlarge provides 2 Neuron cores

#### **Neuron Resource Allocation**
```yaml
resources:
  requests:
    aws.amazon.com/neuroncore: 2
  limits:
    aws.amazon.com/neuroncore: 2
```
- Requests and limits must match for Neuron cores
- Each core handles part of the model (tensor parallelism)

#### **vLLM Neuron Configuration**
```yaml
- --tensor-parallel-size=2  # Split model across 2 cores
- --max-num-seqs=4          # Handle 4 concurrent requests
- --max-model-len=8192      # 8K token context window
```
- Optimized for workshop hardware constraints
- Production would use more cores and higher concurrency

## Hands-On: Interacting with vLLM Models

Let's interact with the deployed models through Open WebUI:

### Step 1: Verify Model Deployment

:::code{language=bash showCopyAction=true}
# Check if vLLM pods are running
kubectl get pods -n vllm

# View pod details
kubectl describe pod -n vllm -l app=llama-3-1-8b-int8-neuron

# Check service endpoints
kubectl get svc -n vllm
:::

### Step 2: Test Direct API Access

:::code{language=bash showCopyAction=true}
# Port-forward to access vLLM directly
kubectl port-forward -n vllm svc/llama-3-1-8b-int8-neuron 8000:8000 &

# Test the model endpoint
curl http://localhost:8000/v1/models

# Send a test completion request
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3-1-8b-int8-neuron",
    "messages": [
      {"role": "user", "content": "Explain Kubernetes in one sentence"}
    ],
    "max_tokens": 50
  }'

# Stop port-forward
kill %1
:::

### Step 3: Use Open WebUI

1. Navigate to `https://openwebui.${DOMAIN}`
2. Select **llama-3-1-8b-int8-neuron** from the model dropdown
3. Try these prompts to test different capabilities:

:::code{language=markdown showCopyAction=true}
# Test general knowledge
"What are the benefits of using Kubernetes for container orchestration?"

# Test code generation
"Write a Python function to calculate fibonacci numbers"

# Test reasoning
"If I have 3 apples and give away 40% of them, how many do I have left?"
:::

### Step 4: Compare Models

Switch between models in Open WebUI:
- **llama-3-1-8b-int8-neuron**: Meta's Llama 3.1 8B
- **qwen3-8b-fp8-neuron**: Alibaba's Qwen3 8B

Notice differences in:
- Response speed (first token latency)
- Answer quality and style
- Token generation rate

## Performance Considerations

### Why Responses Might Be Slow

1. **Hardware Limitations**
   - inf2.xlarge has only 2 Neuron cores
   - Limited memory bandwidth compared to larger instances

2. **Model Size vs Hardware**
   - 8B parameter models are large for 2 cores
   - Tensor parallelism overhead

3. **Quantization Trade-offs**
   - INT8 reduces memory but adds computation overhead
   - Some accuracy loss from quantization

### Production Optimizations

In production environments, you would:

```yaml
# Use larger instances
nodeSelector:
  node.kubernetes.io/instance-type: inf2.24xlarge  # 12 Neuron cores

# Increase parallelism
args:
  - --tensor-parallel-size=12
  - --max-num-seqs=32

# Deploy multiple replicas
spec:
  replicas: 3  # For load balancing
```

## Monitoring vLLM

Check model performance and health:

:::code{language=bash showCopyAction=true}
# View pod logs
kubectl logs -n vllm deployment/llama-3-1-8b-int8-neuron --tail=50

# Check resource usage
kubectl top pod -n vllm

# View Neuron metrics (if neuron-monitor is deployed)
kubectl exec -n vllm deployment/llama-3-1-8b-int8-neuron -- \
  neuron-ls
:::

## Troubleshooting Common Issues

::::tabs

:::tab{label="Pod Not Starting"}
```bash
# Check pod events
kubectl describe pod -n vllm -l app=llama-3-1-8b-int8-neuron

# Common issues:
# - No inf2 nodes available
# - Neuron cores already allocated
# - Image pull errors
```
:::

:::tab{label="Slow Responses"}
```bash
# Check if model is loaded
kubectl logs -n vllm deployment/llama-3-1-8b-int8-neuron | grep "ready"

# Monitor request queue
curl http://localhost:8000/metrics | grep vllm_pending_requests
```
:::

:::tab{label="Out of Memory"}
```bash
# Reduce batch size
kubectl edit deployment -n vllm llama-3-1-8b-int8-neuron
# Change: --max-num-seqs=2

# Or reduce context length
# Change: --max-model-len=4096
```
:::

::::

## Key Takeaways

✅ **Kubernetes Native**: vLLM deployed using standard K8s resources (Deployment, Service, PVC)

✅ **Neuron Optimization**: Models pre-compiled and quantized for AWS Inferentia

✅ **Resource Management**: Proper node selection, tolerations, and resource limits

✅ **Production Patterns**: Caching, secrets management, and security contexts

✅ **Performance Trade-offs**: Balance between cost (hardware) and speed (performance)

## What's Next?

You've seen how to self-host models on EKS with vLLM. While powerful, this approach requires managing infrastructure and has performance limitations with small hardware. 

In the next section, we'll explore AWS Bedrock - a fully managed alternative that provides instant access to high-performance models without infrastructure overhead.

---

**[Next: AWS Bedrock - Managed AI Services →](../bedrock)**
