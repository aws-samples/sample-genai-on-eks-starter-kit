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

Interactive skill to manage LLM models on the GenAI on EKS starter kit. Handles three scenarios:

## Flow

### Step 1 — What does the user want?

Ask using `AskUserQuestion`:

| Option | Description |
|--------|-------------|
| Add a Bedrock model | Managed by AWS, no infra needed — just register in LiteLLM |
| Deploy a model we already have a template for | Pre-built, ready to deploy on Trainium or GPU |
| Deploy a new model from HuggingFace | May need compilation for Neuron; GPU fallback available |
| Remove a model | Unregister from LiteLLM (and optionally delete the K8s deployment) |

### Step 2a — Bedrock model

1. Check which Bedrock models are already registered: `kubectl exec deploy/litellm -n litellm -- litellm --model_list` OR read the config
2. Ask which model to add (offer common ones not yet registered)
3. Register via LiteLLM `/model/new` API:
   ```bash
   curl -X POST http://<litellm-svc>:4000/model/new \
     -H "Authorization: Bearer $LITELLM_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model_name": "bedrock/<friendly-name>", "litellm_params": {"model": "bedrock/<model-id>"}}'
   ```
4. Verify: `curl http://<litellm-svc>:4000/v1/models` shows the new model

### Step 2b — Deploy an existing template

Available templates (check `components/llm-model/vllm/` for `model-*.template.yaml`):

**Neuron (Trainium) — inf2.xlarge:**
- `qwen3-8b-neuron` — Qwen3 8B compiled for 2 Neuron cores
- `deepseek-r1-qwen3-8b-neuron` — DeepSeek R1 distill (Qwen3 8B) for Neuron

**GPU (g6e family):**
- `qwen3-30b-instruct-fp8` — Qwen3 30B instruct, FP8 quantized
- `qwen3-30b-thinking-fp8` — Qwen3 30B thinking mode
- `qwen3-32b-fp8` — Qwen3 32B FP8
- `qwen3-coder-30b-fp8` — Qwen3 Coder 30B
- `qwen3-coder-480b-fp8` — Qwen3 Coder 480B (multi-GPU)
- `qwen3-next-80b-instruct-fp8` — Qwen3 Next 80B instruct
- `qwen3-next-80b-thinking-fp8` — Qwen3 Next 80B thinking
- `qwen3-omni-30b-instruct` — Qwen3 Omni 30B (multimodal)
- `qwen3-omni-30b-thinking` — Qwen3 Omni 30B thinking
- `qwen3-omni-30b-captioner` — Qwen3 Omni 30B captioner
- `deepseek-r1-qwen3-8b` — DeepSeek R1 distill on GPU
- `gemma3-27b-gptq` — Gemma3 27B GPTQ
- `magistral-24b-fp8` — Magistral 24B FP8
- `llama-4-scout-17b-16e-instruct-fp8` — Llama 4 Scout MoE
- `gpt-oss-20b` — GPT OSS 20B
- `gpt-oss-120b` — GPT OSS 120B (multi-GPU)

Steps:
1. Ask which template to deploy
2. Update `config.local.json` to set `"deploy": true` for that model
3. Run `./cli component llm-model vllm` to deploy it (or give the kubectl command)
4. Verify pod comes up: `kubectl get pods -n vllm -l app=<model-name>`
5. Confirm LiteLLM auto-discovers it (or register manually)

### Step 2c — New model from HuggingFace

1. Ask for the HuggingFace model ID (e.g., `Qwen/Qwen3-14B`)
2. Check Neuron compatibility:
   - Is this model architecture supported by `optimum-neuron`? Check: transformers-neuronx supported architectures (LlamaForCausalLM, MistralForCausalLM, GPTNeoXForCausalLM, Qwen2ForCausalLM, etc.)
   - Does the model size fit in available Neuron cores? (inf2.xlarge = 2 cores, ~32GB; inf2.8xlarge = 8 cores, ~128GB; trn1.2xlarge = 2 cores)
3. If Neuron-compatible:
   - The model needs compilation. Explain that a Kaniko/build job is needed (builder pod in the cluster).
   - Provide the vLLM Neuron deployment template adapted for the model.
   - Estimate instance type needed based on model parameters.
4. If NOT Neuron-compatible, ask:
   - "This model isn't compiled for Neuron. Want to deploy on GPU instead? (g6e instances with NVIDIA GPUs)"
   - If yes: generate a GPU deployment template (vLLM with `--dtype auto` or `--quantization fp8`)
   - If no: search for alternatives — similar models that ARE Neuron-compatible. Use web search to check `optimum-neuron` model hub and AWS Neuron documentation.
5. Generate the deployment YAML, apply it, register in LiteLLM.

### Step 2d — Remove a model

1. Ask which model to remove
2. If self-hosted: `kubectl delete -f` the deployment + service
3. Remove from LiteLLM: `DELETE /model/delete` with the model ID
4. Optionally update config to set `"deploy": false`

## Important notes

- LiteLLM endpoint inside the cluster: `http://litellm.litellm:4000`
- LiteLLM API key: from `.env.local` or `$LITELLM_API_KEY`
- vLLM namespace: `vllm`
- Neuron models require pre-compiled images in ECR — raw HuggingFace weights won't work directly
- GPU models can pull weights at startup from HuggingFace (slower cold start but no pre-build needed)
- Always verify the model responds after deployment: `curl http://<model-svc>.vllm:8000/v1/models`
