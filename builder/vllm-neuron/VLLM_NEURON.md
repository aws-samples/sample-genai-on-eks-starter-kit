# vLLM Neuron

## Setup

- Create a custom Karpenter NodePool/NodeClass/EC2NodeClass using `builder/karpenter_eks_auto_mode.yaml` (adjust IAM role suffix first) or `builder/karpenter_eks_standard_mode.yaml`
- Create a buildkit container using `builder/vllm-neuron/pod-buildkit.yaml`

## Optimum Neuron

- Create a vLLM Optimum Neuron container using `builder/vllm-neuron/pod-optimum-neuron.yaml`
- On the buildkit container (`kubectl -n vllm exec -it buildkit -- sh`), first install Hugging Face CLI and download the model by using the command similar to the one below

```
pip install -U "huggingface_hub"

hf download Qwen/Qwen3-8B
```

- Then, compile and export the model by using the command similar to the one below (Note. model will need to be recompiled when changing any of the parameters)

```
optimum-cli export neuron --model Qwen/Qwen3-8B \
  --instance_type inf2 \
  --tensor_parallel_size 2 \
  --batch_size 2 \
  --sequence_length 8192 \
  /root/.cache/neuron/Qwen/Qwen3-8B
```

- Then, copy the Dockerfile files into the buildkit container using `kubectl cp ./builder/vllm-neuron/optimum-neuron vllm/buildkit:/root/.cache/optimum-neuron`

- On the buildkit container (`kubectl -n vllm exec -it buildkit -- sh`), first install AWS CLI and setup ECR credentials by using the command similar to the one below

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

- Then, build and push the image to ECR by using the command similar to the one below

```
public_ecr_alias=t0h7h1e6

cat << EOF > /root/.cache/.dockerignore
*
!huggingface/hub/models--Qwen--Qwen3-8B/
!neuron/Qwen/Qwen3-8B/
EOF

buildctl build --frontend dockerfile.v0 \
  --local context=/root/.cache --local dockerfile=/root/.cache/optimum-neuron/qwen3-8b \
  --output type=image,name=public.ecr.aws/$public_ecr_alias/vllm-neuron:qwen3-8b-optimum-neuron,push=true
```
