#!/bin/bash

kubectl apply -f optimum-neuron-builder.yaml

mkdir -p ~/optimum-neuron
cd ~/optimum-neuron

dnf install -y tar gzip 

curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env

dnf install -y libxcrypt-compat
uv venv --python 3.10.12 aws_neuron_venv_pytorch # Same version on vLLM Docker.neuron
source aws_neuron_venv_pytorch/bin/activate
uv pip install pip -U

./install_drivers_and_tools.sh

./install_pytorch_neuron.sh

./install_optimum_neuron.sh

./compile_llama_3.1_8b.sh

# optimum-cli neuron cache lookup unsloth/Llama-3.2-1B-Instruct
# optimum-cli neuron cache lookup meta-llama/Llama-3.1-8B-Instruct

# Optional
./install_vllm.sh

./install_deps.sh

./test_installation.sh

./test_llama_3.1_8b.sh
