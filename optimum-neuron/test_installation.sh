#!/bin/bash

# Ref https://huggingface.co/docs/optimum-neuron/guides/vllm_plugin#online-inference-example

# --max-num-seqs 1 or 4 or 8

# MODEL=meta-llama/Meta-Llama-3.1-8B
MODEL=deepseek-ai/DeepSeek-R1-Distill-Llama-8B
# MAX_NUM_SEQS=1
MAX_NUM_SEQS=4
# MAX_NUM_SEQS=8

python -m vllm.entrypoints.openai.api_server \
    --model=${MODEL} \
    --max-num-seqs=${MAX_NUM_SEQS} \
    --max-model-len=4096 \
    --tensor-parallel-size=2 \
    --port=8080 \
    --device neuron

curl 127.0.0.1:8080/v1/completions \
    -H 'Content-Type: application/json' \
    -X POST \
    -d '{"prompt":"One of my fondest memory is", "temperature": 0.8, "max_tokens":128}'
