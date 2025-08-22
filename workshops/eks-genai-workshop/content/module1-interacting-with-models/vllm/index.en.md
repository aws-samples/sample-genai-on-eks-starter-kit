---
title: "vLLM - Self-Hosted Model Serving"
weight: 22
---

Remember those models you just chatted with in OpenWebUI? Let's peek behind the curtain and see how they're actually running on Kubernetes! In this section, we'll explore the vLLM infrastructure that powers your AI conversations.

## 🛠️ Hands-On: Explore Your Running Models

Let's start by discovering what's actually running in your cluster right now:

### Step 1: See Your Models in Action

:::code{language=bash showCopyAction=true}
# Check what vLLM models are running right now
kubectl get pods -n vllm

# See the actual deployments behind your chat experience
kubectl get deployments -n vllm -o wide

# Check which nodes are hosting your models
kubectl get pods -n vllm -o wide
:::

You should see pods like `llama-3-1-8b-int8-neuron-xxx` and `qwen3-8b-fp8-neuron-xxx` - these are the exact models you just used in OpenWebUI!

### Step 2: Examine the Real Configuration Files

In your VSC IDE, let's explore the actual deployment files:

:::code{language=bash showCopyAction=true}
# Navigate to vLLM configurations
ls /workshop/components/llm-model/vllm/

# Look at the Llama deployment you just used
cat /workshop/components/llm-model/vllm/model-llama-3-1-8b-int8-neuron.rendered.yaml

# Compare with the Qwen deployment
cat /workshop/components/llm-model/vllm/model-qwen3-8b-fp8-neuron.rendered.yaml
:::

### Step 3: Connect Your Chat Experience to Infrastructure

That response you got from Llama 3.1? Here's exactly how it happened:

1. **Your message** → Open WebUI → LiteLLM → **This vLLM pod**
2. **The pod** you're looking at processed your request on AWS Neuron hardware
3. **The response** traveled back through the same path to your browser

## What is vLLM?

Now that you've seen it in action, let's understand what makes vLLM special:

vLLM is an open-source LLM inference and serving library that provides:

- ⚡ **High Throughput**: Optimized for serving multiple requests efficiently
- 🔄 **Continuous Batching**: Dynamic request batching for optimal hardware utilization
- 📊 **PagedAttention**: Efficient memory management for long contexts
- 🔧 **Tensor Parallelism**: Distribute models across multiple accelerators
- 🎯 **OpenAI Compatible API**: Drop-in replacement for OpenAI API

## 📊 Monitor Your Models in Real-Time

Let's watch your models work while you use them! This is where the magic happens.

### Step 4: Watch Your Model Process Requests

Open a second terminal in your VSC IDE and run:

:::code{language=bash showCopyAction=true}
# Watch your Llama model logs in real-time
kubectl logs -f --tail=0 -n vllm deployment/llama-3-1-8b-int8-neuron
:::

Now go back to your OpenWebUI tab and send a message to the Llama model. Watch the logs - you'll see your request being processed in real-time!

**Try this example question:**

![OpenWebUI Question](/static/images/module-1/vllm/flies.png)

As soon as you send the message "why would a fly fly into a fly pant", watch your terminal! You'll see detailed logs showing:

![vLLM Processing Logs](/static/images/module-1/vllm/logs.png)

**What you're seeing in the logs:**
- 📨 **Request received**: Your prompt being processed by vLLM
- 🧠 **Model thinking**: Token generation and processing metrics
- ⚡ **Performance stats**: Throughput, latency, and cache usage
- 🔄 **Real-time updates**: Each token being generated live

**Key metrics to notice:**
- **Prompt throughput**: ~4.5 tokens/s (how fast it reads your question)
- **Generation throughput**: ~26.8 tokens/s (how fast it generates the response)
- **GPU KV cache usage**: Shows memory utilization
- **Request processing**: Complete request lifecycle from start to finish

This gives you incredible insight into how your AI model actually works under the hood!

**Press Ctrl+C to stop the logs when you're done exploring.**


## AWS Neuron: Purpose-Built for AI

AWS Neuron is the SDK for AWS Inferentia (inf2) and Trainium (trn1) chips:

- **Cost Efficiency**: Up to 50% lower cost per inference vs GPUs
- **Optimized for LLMs**: Native support for transformer architectures
- **Quantization**: INT8 and FP8 support for reduced memory usage
- **Compilation**: Pre-compiled models for optimal performance

::alert[**Workshop Constraint**: We're using inf2.xlarge instances (2 Neuron cores each) due to workshop limitations. Production deployments typically use GPUs or larger Neuron instances for better performance.]{type="warning"}

## 🔍 Technical Deep Dive (Optional)

<details>
<summary><strong>Click to explore the Kubernetes deployment details</strong></summary>

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

## 🚀 Performance Testing with OpenWebUI

Now let's test the models you just explored and see the performance differences:

### Step 1: Performance Comparison Exercise

1. **Go back to your OpenWebUI tab**
2. **Select llama-3-1-8b-int8-neuron** from the model dropdown
3. **Try these prompts** to test different capabilities:

:::code{language=markdown showCopyAction=true}
# Test general knowledge
"What are the benefits of using Kubernetes for container orchestration?"

# Test code generation
"Write a Python function to calculate fibonacci numbers"

# Test reasoning
"If I have 3 apples and give away 40% of them, how many do I have left?"
:::

### Step 2: Compare Models Side-by-Side

Switch between models in Open WebUI and compare:
- **llama-3-1-8b-int8-neuron**: Meta's Llama 3.1 8B (INT8 quantized)
- **qwen3-8b-fp8-neuron**: Alibaba's Qwen3 8B (FP8 quantized)

**Try the same prompt with both models:**
```
"Explain the difference between Kubernetes Deployments and StatefulSets in 3 bullet points"
```

**While testing, notice:**
- Response speed (first token latency)
- Answer quality and style
- Token generation rate
- Different approaches to the same question

**Pro Tip**: Use the "+" button in OpenWebUI to chat with both models simultaneously!

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

</details>

## 📈 Understanding Performance Metrics

Based on what you saw in the logs, let's understand the key performance indicators:

### **Throughput Metrics**
- **Prompt Throughput**: ~4.5 tokens/s (how fast vLLM processes your input)
- **Generation Throughput**: ~26.8 tokens/s (how fast it generates responses)
- **Total Tokens**: Shows the complete token count for request + response

### **Memory Usage**
- **GPU KV Cache**: Shows how much memory is used for attention mechanisms
- **Model Loading**: Initial memory allocation for the 8B parameter model

### **Hardware Utilization**
- **Neuron Core Usage**: How the 2 cores are being utilized
- **Tensor Parallelism**: Model split across both Neuron cores for faster inference

## 🔧 Advanced Monitoring

For deeper insights into your models:

:::code{language=bash showCopyAction=true}
# View detailed pod resource usage
kubectl top pod -n vllm

# Check Neuron hardware utilization
kubectl exec -n vllm deployment/llama-3-1-8b-int8-neuron -- neuron-ls

# Monitor ongoing requests
kubectl logs -n vllm deployment/llama-3-1-8b-int8-neuron --tail=20
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
