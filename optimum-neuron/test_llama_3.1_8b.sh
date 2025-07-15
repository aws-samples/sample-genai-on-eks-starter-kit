python -m vllm.entrypoints.openai.api_server \
    --model=/root/.cache/neuron/meta-llama/Llama-3.1-8B-Instruct-optimum-neuron/ \
    --max-num-seqs=4 \
    --max-model-len=4096 \
    --tensor-parallel-size=2 \
    --port=8080 \
    --device "neuron"