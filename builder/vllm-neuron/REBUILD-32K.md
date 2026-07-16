# Rebuild qwen3-8b-neuron at 32k context

Target artifact: `sequence_length=32768`, `batch_size=2`, `tensor_parallel_size=2`, `bf16` on inf2 (fits inf2.8xlarge, ~24GiB of 32GiB device memory).
Target image: `public.ecr.aws/agentic-ai-platforms-on-k8s/vllm-neuron:qwen3-8b-optimum-neuron-32k`

Note on the ECR alias: `VLLM_NEURON.md` uses `public_ecr_alias=t0h7h1e6`, but the deployed images live under the custom alias `agentic-ai-platforms-on-k8s` (same public registry, friendly alias). Use `agentic-ai-platforms-on-k8s` so the pushed tag matches the serving template.

Prerequisites (already true once the cluster + vllm component are installed):
- Namespace `vllm`, PVCs `huggingface-cache` and `neuron-cache`, and secret `hf-token` exist (created by `components/llm-model/vllm/index.mjs` install).
- Cluster `genai-on-eks` (us-west-2, standard mode with Karpenter).

## 1. Builder nodepool (skip if already applied)

```
kubectl apply -f builder/karpenter_eks_standard_mode.yaml
```

## 2. Builder pods

```
kubectl apply -f builder/vllm-neuron/pod-buildkit.yaml
kubectl apply -f builder/vllm-neuron/pod-optimum-neuron.yaml
kubectl -n vllm wait --for=condition=Ready pod/buildkit pod/optimum-neuron --timeout=15m
```

`optimum-neuron` pins `inf2.8xlarge` (2 neuron cores) via nodeSelector — that is the compile host. `buildkit` lands on `r7i.2xlarge`.

## 3. Download model weights (optimum-neuron pod — it has HUGGING_FACE_HUB_TOKEN and the hf CLI)

```
kubectl -n vllm exec -it optimum-neuron -- hf download Qwen/Qwen3-8B
```

Weights land on the shared `huggingface-cache` PVC.

## 4. Compile at 32k (optimum-neuron pod)

Clear the old 8k artifact first — compile output path is reused and the serving image COPYs whatever is there:

```
kubectl -n vllm exec -it optimum-neuron -- sh -c 'rm -rf /root/.cache/neuron/Qwen/Qwen3-8B'
kubectl -n vllm exec -it optimum-neuron -- optimum-cli export neuron --model Qwen/Qwen3-8B --instance_type inf2 --tensor_parallel_size 2 --batch_size 2 --sequence_length 32768 --auto_cast_type bf16 /root/.cache/neuron/Qwen/Qwen3-8B
```

Expect a long compile (tens of minutes). Sanity-check the result:

```
kubectl -n vllm exec -it optimum-neuron -- sh -c 'grep -o "\"sequence_length\": [0-9]*" /root/.cache/neuron/Qwen/Qwen3-8B/config.json'
```

Must show `32768`.

## 5. Copy Dockerfiles into the buildkit pod

```
kubectl cp ./builder/vllm-neuron/optimum-neuron vllm/buildkit:/root/.cache/optimum-neuron
```

## 6. ECR login (buildkit pod)

Run `kubectl -n vllm exec -it buildkit -- sh`, then inside the pod:

```
cd /root/.cache
apk add aws-cli
export ECR_PASSWORD=$(aws ecr-public get-login-password --region us-east-1)
export AUTH=$(echo -n "AWS:${ECR_PASSWORD}" | base64 -w 0)
mkdir -p ~/.docker
cat << EOF > ~/.docker/config.json
{
  "auths": {
    "public.ecr.aws": {
      "auth": "${AUTH}"
    }
  }
}
EOF
```

(The pod needs AWS credentials with `ecr-public:GetAuthorizationToken` + push rights on the `vllm-neuron` repo — node role or injected creds.)

## 7. Build and push (still inside buildkit pod)

```
public_ecr_alias=agentic-ai-platforms-on-k8s

cat << EOF > /root/.cache/.dockerignore
*
!huggingface/hub/models--Qwen--Qwen3-8B/
!neuron/Qwen/Qwen3-8B/
EOF

buildctl build --frontend dockerfile.v0 \
  --local context=/root/.cache --local dockerfile=/root/.cache/optimum-neuron/qwen3-8b-32k \
  --output type=image,name=public.ecr.aws/$public_ecr_alias/vllm-neuron:qwen3-8b-optimum-neuron-32k,push=true
```

## 8. Deploy the 32k serving config

The template `components/llm-model/vllm/model-qwen3-8b-neuron.template.yaml` already points at the `-32k` tag, `--max-model-len=32768`, and `inf2.8xlarge`. Re-render + apply via the kit CLI (from repo root; requires `qwen3-8b-neuron` marked `deploy: true` in config.local.json):

```
./cli llm-model vllm update-models
```

This regenerates `model-qwen3-8b-neuron.rendered.yaml` from the template and `kubectl apply`s it. Do NOT `kubectl apply` the stale pre-existing rendered yaml — it still contains the old image/args (classic rendered-yaml-revert gotcha).

## 9. Verification

```
kubectl -n vllm logs deploy/qwen3-8b-neuron | grep -i "max_seq_len\|max_model_len"
```

Expect `max_model_len=32768` (and neuron artifact `sequence_length` 32768, `batch_size` 2, `tp_degree` 2). Then a tool-call smoke test:

```
kubectl -n vllm port-forward svc/qwen3-8b-neuron 8000:8000 &
curl -s http://localhost:8000/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"qwen3-8b-neuron","messages":[{"role":"user","content":"What is the weather in Seattle?"}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather for a city","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}]}'
```

Expect `finish_reason":"tool_calls"` with a `get_weather` call. Note: with `--reasoning-parser qwen3`, `choices[0].message.content` may be null with text in `reasoning_content` — check both fields.

Long-context check (the old 8k build crashed with NRT status=1006 past 8192 tokens): send a prompt >8k tokens and confirm a completion returns and the pod stays Running.

## 10. Teardown builder resources

```
kubectl -n vllm delete pod optimum-neuron buildkit
kubectl -n vllm delete serviceaccount buildkit
```

The `builder-bottlerocket` nodepool consolidates empty nodes automatically (budget: 100% on Empty). To remove it entirely:

```
kubectl delete -f builder/karpenter_eks_standard_mode.yaml
```

Keep the PVCs — the compiled 32k artifact on `neuron-cache` is expensive to rebuild.
