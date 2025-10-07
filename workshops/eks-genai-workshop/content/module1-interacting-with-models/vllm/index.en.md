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

You should see pods like `qwen3-8b-neuron-xxx` and `deepseek-r1-qwen3-8b-neuron-xxx` - these are the exact models you just used in OpenWebUI!

### Step 2: Examine the Real Configuration Files

In your VSC IDE, let's explore the actual deployment files:

:::code{language=bash showCopyAction=true}
# Navigate to vLLM configurations
ls /workshop/components/llm-model/vllm/

# Look at the Qwen 3 deployment you just used
cat /workshop/components/llm-model/vllm/model-qwen3-8b-neuron.rendered.yaml

# Compare with the DeepSeek deployment
cat /workshop/components/llm-model/vllm/model-deepseek-r1-qwen3-8b-neuron.rendered.yaml
:::

### Step 3: Connect Your Chat Experience to Infrastructure

That response you got from Qwen 3 8b? Here's exactly how it happened:

1. **Your message** → Open WebUI → LiteLLM → **This vLLM pod**
2. **The pod** you're looking at processed your request on AWS Neuron hardware
3. **The response** traveled back through the same path to your browser

## What is vLLM?

Now that you've seen it in action, let's understand what makes vLLM special:

[vLLM](https://docs.vllm.ai/en/latest/) is an open-source LLM inference and serving library that provides:

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
# Watch your Deepseek Qwen 3 model logs in real-time
kubectl logs -f --tail=0 -n vllm deployment/deepseek-r1-qwen3-8b-neuron
:::

Now go back to your OpenWebUI tab, change the model to the Deepseek model and send a message to it. Watch the logs - you'll see your request being processed in real-time!

**Try this example question:**

![OpenWebUI Question](/static/images/module-1/flies.png)

As soon as you send the message "why would a fly fly into a fly pant", watch your terminal! You'll see detailed logs showing:

![vLLM Processing Logs](/static/images/module-1/logs.png)

**What you're seeing in the logs:**
- 📨 **Request received**: Your prompt being processed by vLLM
- 🧠 **Model thinking**: Token generation and processing metrics
- ⚡ **Performance stats**: Throughput, latency, and cache usage
- 🔄 **Real-time updates**: Each token being generated live

**Key metrics to notice:**
- **Prompt throughput**: ~1.3 tokens/s (how fast it reads your question - low because not much to read)
- **Generation throughput**: ~24 tokens/s (how fast it generates the response)
- **GPU KV cache usage**: Shows memory utilization
- **Request processing**: Complete request lifecycle from start to finish

This gives you incredible insight into how your AI model actually works under the hood!

**Press Ctrl+C to stop the logs when you're done exploring.**


## AWS Neuron: Purpose-Built for AI

[AWS Neuron](https://aws.amazon.com/ai/machine-learning/neuron/) is the SDK for AWS Inferentia (inf2) and Trainium (trn1) chips:

- **Cost Efficiency**: Up to 50% lower cost per inference vs GPUs
- **Optimized for LLMs**: Native support for transformer architectures
- **Quantization**: INT8 and FP8 support for reduced memory usage
- **Compilation**: Pre-compiled models for optimal performance

::alert[**Workshop Constraint**: We're using inf2.xlarge instances (2 Neuron cores each) due to workshop limitations. Production deployments typically use GPUs or larger Neuron instances for better performance.]{type="warning"}

## 🔍 Technical Deep Dive (Optional)

For those interested in the Kubernetes implementation details:

::alert[**Complete Files Available**: All the YAML manifests shown in these tabs are available in your VSC IDE at `/workshop/components/llm-model/vllm/` if you want to explore the complete configurations in detail.]{type="info"}

:::::tabs

::::tab{label="Namespace"}
**Namespace Isolation**

First, we create a dedicated namespace for vLLM workloads:

:::code{language=yaml showCopyAction=true}
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: vllm
:::
::::

::::tab{label="Storage"}

**Storage Configuration**

We use Amazon EFS to cache downloaded models and compiled Neuron graphs:

Cache Hugging Face Models:
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
:::

Compiled Neuron Models:
:::code{language=yaml showCopyAction=true}
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
- **HuggingFace Cache**: Stores downloaded model weights
- **Neuron Cache**: Stores compiled model graphs
- **Reusability**: Cached data persists across pod restarts
::::

::::tab{label="Secret"}
**Secrets Management**

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
::::

::::tab{label="Deployment"}
**Main Deployment Manifest**

Here's the deployment for Qwen 3 8B with Neuron optimization:

::alert[Shortened the deployment manifest file to only show the key details.]{type="warning"}

:::code{language=yaml showCopyAction=true}
# model-qwen3-8b-neuron.rendered.yaml (key sections)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qwen3-8b-neuron
  namespace: vllm
spec:
  replicas: 1
  selector:
    matchLabels:
      app: qwen3-8b-neuron
  template:
    spec:
      # Node selection for Neuron hardware
      nodeSelector:
        eks.amazonaws.com/instance-family: inf2
        node.kubernetes.io/instance-type: inf2.xlarge
      
      containers:
        - name: vllm
          image: public.ecr.aws/t0h7h1e6/vllm-neuron:qwen3-8b
          command: ["vllm", "serve"]
          args:
            - --served-model-name=qwen3-8b-neuron
            - --trust-remote-code
            - --gpu-memory-utilization=0.90
            - --enable-auto-tool-choice
            - --tool-call-parser=hermes
            - --reasoning-parser=qwen3
            - --tensor-parallel-size=2
            - --max-num-seqs=1
            - --max-model-len=16384
          resources:
            requests:
              cpu: 3
              memory: 12Gi
              aws.amazon.com/neuroncore: 2  # Request 2 Neuron cores
            limits:
              aws.amazon.com/neuroncore: 2
:::

**Key Configuration Details:**
- **Node Selection**: Ensures pods run only on Neuron-equipped instances
- **Neuron Cores**: Requests and limits must match for Neuron cores
- **Tensor Parallelism**: Model split across 2 cores for faster inference
- **Concurrency**: Handle 4 concurrent requests with 8K context window
::::

::::tab{label="Service"}
**Service Configuration**

The Service exposes the vLLM deployment and makes it accessible to other components:

:::code{language=yaml showCopyAction=true}
apiVersion: v1
kind: Service
metadata:
  name: qwen3-8b-neuron
  namespace: vllm
spec:
  selector:
    app: qwen3-8b-neuron
  ports:
    - name: http
      port: 8000
:::

**Service Details:**
- **Selector**: Matches pods with the `app: qwen3-8b-neuron` label
- **Port 8000**: Standard vLLM API port for OpenAI-compatible endpoints
- **ClusterIP**: Internal service accessible only within the cluster
- **Target**: Routes traffic to the vLLM container port 8000
::::
:::::

---

## Key Takeaways

✅ **Kubernetes Native**: vLLM deployed using standard K8s resources (Deployment, Service, PVC)

✅ **Neuron Optimization**: Models pre-compiled and quantized for AWS Inferentia

✅ **Resource Management**: Proper node selection, tolerations, and resource limits

✅ **Production Patterns**: Caching, secrets management, and security contexts

✅ **Performance Trade-offs**: Balance between cost (hardware) and speed (performance)

## What's Next?

You've seen how to self-host models on EKS with vLLM. 

In the next section, we'll explore AWS Bedrock - a fully managed alternative that provides instant access to high-performance models without infrastructure overhead.

---

**[Next: AWS Bedrock - Managed AI Services →](../bedrock)**
