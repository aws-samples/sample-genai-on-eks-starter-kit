---
name: model-manager
description: Add, swap, or remove LLM models on the GenAI starter kit — Bedrock, pre-built Trainium/GPU, or new models from HuggingFace. Interactive flow handles Neuron compatibility and GPU fallback.
triggers:
  - add model
  - new model
  - swap model
  - change model
  - remove model
  - deploy model
  - model manager
---

# Model Manager

Interactive skill to manage LLM models on the GenAI on EKS starter kit.

## Flow

### Step 1 — What does the user want?

Ask using `AskUserQuestion`:

| Option | Description |
|--------|-------------|
| Add a Bedrock model | Managed by AWS, no infra needed — just register in LiteLLM |
| Deploy a model we already have a template for | Pre-built, ready to deploy on Trainium or GPU |
| Deploy a new model from HuggingFace | May need Neuron compilation or GPU fallback |
| Remove a model | Unregister from LiteLLM and/or delete the K8s deployment |

---

### Step 2a — Bedrock model

1. Read `config.local.json` (or `config.json`) `bedrock.llm.models` to see what's already registered
2. Check available Bedrock models: `aws bedrock list-foundation-models --query "modelSummaries[].modelId"`
3. Ask which model to add (offer ones not yet in config)
4. Register via LiteLLM `/model/new` API:
   ```bash
   curl -X POST http://litellm.litellm:4000/model/new \
     -H "Authorization: Bearer $LITELLM_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model_name": "bedrock/<friendly-name>", "litellm_params": {"model": "bedrock/<model-id>"}}'
   ```
5. Verify: `curl http://litellm.litellm:4000/v1/models | jq '.data[].id'`

---

### Step 2b — Deploy an existing template

Templates live at `components/llm-model/vllm/model-{name}.template.yaml` where `{name}` exactly matches the `config.json` entry.

**Neuron (Trainium) — pre-compiled images baked with weights:**
| Template | Model | Instance | Cores |
|----------|-------|----------|-------|
| `qwen3-8b-neuron` | Qwen3 8B | inf2.xlarge | 2 |
| `deepseek-r1-qwen3-8b-neuron` | DeepSeek R1 (Qwen3 8B distill) | inf2.xlarge | 2 |

**GPU (g6e family) — downloads from HuggingFace at runtime:**
| Template | Model | GPUs |
|----------|-------|------|
| `qwen3-30b-instruct-fp8` | Qwen3 30B Instruct FP8 | 1 |
| `qwen3-30b-thinking-fp8` | Qwen3 30B Thinking FP8 | 1 |
| `qwen3-32b-fp8` | Qwen3 32B FP8 | 1 |
| `qwen3-coder-30b-fp8` | Qwen3 Coder 30B FP8 | 1 |
| `qwen3-coder-480b-fp8` | Qwen3 Coder 480B FP8 | multi |
| `qwen3-next-80b-instruct-fp8` | Qwen3 Next 80B Instruct FP8 | multi |
| `qwen3-next-80b-thinking-fp8` | Qwen3 Next 80B Thinking FP8 | multi |
| `qwen3-omni-30b-instruct` | Qwen3 Omni 30B (multimodal) | 1 |
| `qwen3-omni-30b-thinking` | Qwen3 Omni 30B Thinking | 1 |
| `qwen3-omni-30b-captioner` | Qwen3 Omni 30B Captioner | 1 |
| `deepseek-r1-qwen3-8b` | DeepSeek R1 distill (GPU) | 1 |
| `gemma3-27b-gptq` | Gemma3 27B GPTQ | 1 |
| `magistral-24b-fp8` | Magistral 24B FP8 | 1 |
| `llama-4-scout-17b-16e-instruct-fp8` | Llama 4 Scout MoE | 1 |
| `gpt-oss-20b` | GPT OSS 20B | 1 |
| `gpt-oss-120b` | GPT OSS 120B | multi |

**Deploy steps:**
1. Ask which template
2. Update `config.local.json`: set `"deploy": true` for that model in `llm-model.vllm.models`
3. Run: `./cli llm-model vllm install`
4. Verify: `kubectl get pods -n vllm -l app=<model-name> -w`
5. LiteLLM auto-discovers via template rendering; if not, register manually

---

### Step 2c — New model from HuggingFace

#### Step 2c.1 — Get model details

Ask for the HuggingFace model ID (e.g., `Qwen/Qwen3-14B`, `mistralai/Mistral-7B-Instruct-v0.3`).

Read the model card to determine:
- Architecture class (check `config.json` → `architectures` field)
- Parameter count
- Whether quantized variants exist (FP8, GPTQ, AWQ)

#### Step 2c.2 — Check Neuron compatibility

**Supported architectures on Neuron (vLLM + NxD Inference, SDK 2.29):**
- `LlamaForCausalLM` — Llama 2/3/3.1/3.2/3.3/4, Mistral (same arch class)
- `Qwen2ForCausalLM` — Qwen 2.5
- `Qwen3ForCausalLM` — Qwen 3
- `Qwen3MoeForCausalLM` — Qwen 3 MoE (235B-A22B)
- `MixtralForCausalLM` — Mixtral 8x7B/8x22B
- `DbrxForCausalLM` — DBRX
- `LlavaForConditionalGeneration` — Pixtral
- `Qwen2VLForConditionalGeneration` — Qwen2-VL
- `Qwen3VLForConditionalGeneration` — Qwen3-VL

**NOT supported on Neuron (use GPU):** Gemma, Phi, GPT-NeoX, Falcon, StarCoder, Stable Diffusion (use optimum-neuron for non-LLM paths), any architecture not listed above.

**Quantization on Neuron:**
- INT8: Supported (symmetric per-tensor/per-channel)
- FP8 (f8e4m3): Supported (requires `XLA_HANDLE_SPECIAL_SCALAR=1`)
- GPTQ: NOT supported
- AWQ: NOT supported

#### Step 2c.3 — Size the instance

**Memory rule of thumb:**
| Precision | Formula | Example (70B) |
|-----------|---------|---------------|
| BF16/FP16 | params × 2 bytes | 140 GB |
| FP8/INT8 | params × 1 byte | 70 GB |

Add ~20-30% overhead for KV cache and runtime buffers.

**Instance sizing:**
| Instance | Cores | HBM | Good for |
|----------|-------|-----|----------|
| inf2.xlarge | 2 | 32 GB | ≤14B BF16, ≤28B INT8 |
| inf2.8xlarge | 2 | 32 GB | Same (more CPU/net) |
| inf2.24xlarge | 12 | 192 GB | ≤70B BF16 |
| inf2.48xlarge | 24 | 384 GB | ≤150B BF16 |
| trn1.2xlarge | 2 | 32 GB | ≤14B BF16 |
| trn1.32xlarge | 32 | 512 GB | ≤200B BF16 |
| trn2.48xlarge | 32 | 1.5 TB | ≤405B BF16 |

**Tensor-parallel degree** = number of NeuronCores. Must evenly divide the model's attention heads.

#### Step 2c.4 — If Neuron-compatible

Explain to user: "This model needs a compiled Neuron image. Two options:"

**Option A — Use vLLM auto-compilation (simpler, slower first start):**
- Deploy with standard vLLM Neuron image + HF model ID
- First start compiles the model (~15-45 min depending on size)
- Set `NEURON_COMPILED_ARTIFACTS=/cache/neuron` for persistence
- Subsequent starts load cached artifacts instantly
- Limitation: models with `tie_word_embeddings: true` (Qwen3-8B, Qwen2.5-7B) must use a local checkpoint, not HF ID

**Option B — Pre-build image (production, instant cold start):**
The repo's 3-step build process:
1. Compile pod on inf2.8xlarge using `ghcr.io/huggingface/optimum-neuron-vllm:0.4.1`
2. BuildKit pod packages compiled weights into image
3. Push to `public.ecr.aws/agentic-ai-platforms-on-k8s/vllm-neuron:{slug}`

Build artifacts in: `builder/vllm-neuron/optimum-neuron/{slug}/Dockerfile`
Doc: `builder/vllm-neuron/VLLM_NEURON.md`

**Generate deployment YAML** using this skeleton:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {model-slug}
  namespace: vllm
spec:
  replicas: 1
  selector:
    matchLabels:
      app: {model-slug}
  template:
    metadata:
      labels:
        app: {model-slug}
    spec:
      securityContext:
        seccompProfile:
          type: RuntimeDefault
      automountServiceAccountToken: false
      nodeSelector:
        node.kubernetes.io/instance-type: {instance-type}
      containers:
        - name: vllm
          image: public.ecr.aws/agentic-ai-platforms-on-k8s/vllm-neuron:{image-tag}
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - NET_RAW
            seccompProfile:
              type: RuntimeDefault
          command: ["vllm", "serve"]
          args:
            - {model-path-or-hf-id}
            - --served-model-name={model-slug}
            - --trust-remote-code
            - --tensor-parallel-size={tp-degree}
            - --max-num-seqs={batch-size}
            - --max-model-len={sequence-length}
            # Add if model supports tool calling:
            # - --enable-auto-tool-choice
            # - --tool-call-parser=hermes
            # Add if model supports reasoning:
            # - --reasoning-parser=deepseek_r1  (or qwen3)
          env:
            - name: NEURON_RT_NUM_CORES
              value: "{tp-degree}"
            - name: NEURON_RT_VISIBLE_CORES
              value: "0-{tp-degree - 1}"
          ports:
            - name: http
              containerPort: 8000
          resources:
            requests:
              cpu: {75% of instance vCPUs}
              memory: {75% of instance RAM}
              aws.amazon.com/neuroncore: {tp-degree}
            limits:
              aws.amazon.com/neuroncore: {tp-degree}
      tolerations:
        - key: aws.amazon.com/neuron
          operator: Exists
          effect: NoSchedule
---
apiVersion: v1
kind: Service
metadata:
  name: {model-slug}
  namespace: vllm
spec:
  selector:
    app: {model-slug}
  ports:
    - name: http
      port: 8000
```

#### Step 2c.5 — If NOT Neuron-compatible

Ask: "This model's architecture ({arch}) isn't supported on Neuron. Options:"

1. **Deploy on GPU (g6e instances)** — works with any model vLLM supports. Generate GPU template:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {model-slug}
  namespace: vllm
spec:
  replicas: 1
  selector:
    matchLabels:
      app: {model-slug}
  template:
    metadata:
      labels:
        app: {model-slug}
    spec:
      securityContext:
        seccompProfile:
          type: RuntimeDefault
      nodeSelector:
        {{{KARPENTER_PREFIX}}}/instance-family: g6e
      containers:
        - name: vllm
          image: "{{DOCKER_IMAGE_PREFIX}}vllm/vllm-openai:v0.10.2"
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - NET_RAW
            seccompProfile:
              type: RuntimeDefault
          command: ["vllm", "serve"]
          args:
            - {huggingface-model-id}
            - --served-model-name={model-slug}
            - --trust-remote-code
            - --dtype=auto
            # For FP8 quantized models:
            # - --quantization=fp8
            # For GPTQ models:
            # - --quantization=gptq
            # For AWQ models:
            # - --quantization=awq
          env:
            - name: HUGGING_FACE_HUB_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hf-token
                  key: token
            - name: HF_HOME
              value: /root/.cache/huggingface
          ports:
            - name: http
              containerPort: 8000
          resources:
            requests:
              nvidia.com/gpu: {gpu-count}
              memory: {memory}
            limits:
              nvidia.com/gpu: {gpu-count}
          volumeMounts:
            - name: cache
              mountPath: /root/.cache/huggingface
      tolerations:
        - key: nvidia.com/gpu
          operator: Exists
          effect: NoSchedule
      volumes:
        - name: cache
          persistentVolumeClaim:
            claimName: huggingface-cache
---
apiVersion: v1
kind: Service
metadata:
  name: {model-slug}
  namespace: vllm
spec:
  selector:
    app: {model-slug}
  ports:
    - name: http
      port: 8000
```

2. **Find a Neuron-compatible alternative** — search HuggingFace for similar models using a supported architecture. E.g., if user wants Gemma3-27B (not Neuron-compatible), suggest Qwen3-30B (compatible) as alternative.

#### Step 2c.6 — After deployment

1. Save template to `components/llm-model/vllm/model-{slug}.template.yaml`
2. Add to `config.local.json` under `llm-model.vllm.models`: `{"name": "{slug}", "deploy": true}`
3. Register in LiteLLM:
   ```bash
   curl -X POST http://litellm.litellm:4000/model/new \
     -H "Authorization: Bearer $LITELLM_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model_name": "vllm/{slug}", "litellm_params": {"model": "openai/{slug}", "api_base": "http://{slug}.vllm:8000/v1"}}'
   ```
4. Verify:
   ```bash
   kubectl get pods -n vllm -l app={slug} -w
   curl http://{slug}.vllm:8000/v1/models
   curl http://litellm.litellm:4000/v1/chat/completions -H "Authorization: Bearer $LITELLM_API_KEY" -d '{"model":"vllm/{slug}","messages":[{"role":"user","content":"hi"}]}'
   ```

---

### Step 2d — Remove a model

1. Ask which model to remove (list deployed: `kubectl get deployments -n vllm`)
2. Delete K8s resources: `kubectl delete deployment,service {name} -n vllm`
3. Remove from LiteLLM: `curl -X POST http://litellm.litellm:4000/model/delete -H "Authorization: Bearer $LITELLM_API_KEY" -d '{"id": "<model-db-id>"}'`
4. Update config: set `"deploy": false` in `config.local.json`

---

## HuggingFace references

| Resource | URL |
|----------|-----|
| Pre-compiled Neuron models | https://huggingface.co/aws-neuron |
| Neuron compiled cache | https://huggingface.co/aws-neuron/optimum-neuron-cache |
| optimum-neuron docs | https://huggingface.co/docs/optimum-neuron |
| vLLM model support | https://docs.vllm.ai/en/latest/models/supported_models.html |
| Neuron model reference | https://awsdocs-neuron.readthedocs-hosted.com/en/latest/libraries/nxd-inference/developer_guides/model-reference.html |

---

## Important notes

- LiteLLM cluster endpoint: `http://litellm.litellm:4000`
- LiteLLM API key: `$LITELLM_API_KEY` from `.env.local`
- vLLM namespace: `vllm`
- CLI deploy command: `./cli llm-model vllm install` (NOT `./cli deploy`)
- CLI model management: `./cli llm-model vllm configure-models` (interactive)
- Neuron models need pre-compiled images — raw HF weights won't work without compilation step
- GPU models download from HuggingFace at runtime (needs `HF_TOKEN` in `.env.local`, creates K8s secret `hf-token`)
- GPU models use PVC `huggingface-cache` for persistence across restarts
- Template files use Handlebars: `{{DOCKER_IMAGE_PREFIX}}` for image registry, `{{{KARPENTER_PREFIX}}}` for node selector labels
- Verify model health: `curl http://<model-name>.vllm:8000/v1/models`
