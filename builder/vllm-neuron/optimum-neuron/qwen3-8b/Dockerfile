FROM ghcr.io/huggingface/optimum-neuron-vllm:0.4.1

COPY ./huggingface/hub/models--Qwen--Qwen3-8B /root/.cache/huggingface/hub/models--Qwen--Qwen3-8B

COPY ./neuron/Qwen/Qwen3-8B /root/.cache/neuron/Qwen/Qwen3-8B

# optimum-cli export neuron --model Qwen/Qwen3-8B \
#   --instance_type inf2 \
#   --tensor_parallel_size 2 \
#   --batch_size 2 \
#   --sequence_length 8192 \
#   /root/.cache/neuron/Qwen/Qwen3-8B

# cat << EOF > /root/.cache/.dockerignore
# *
# !huggingface/hub/models--Qwen--Qwen3-8B/
# !neuron/Qwen/Qwen3-8B/
# EOF

# buildctl build --frontend dockerfile.v0 \
#   --local context=/root/.cache --local dockerfile=/root/.cache/optimum-neuron/qwen3-8b \
#   --output type=image,name=public.ecr.aws/$public_ecr_alias/vllm-neuron:qwen3-8b-optimum-neuron,push=true