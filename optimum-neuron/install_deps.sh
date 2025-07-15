#!/bin/bash

# Ref https://github.com/vllm-project/vllm/blob/main/docker/Dockerfile.neuron#L47-L51

pip install neuronx-cc==2.* --extra-index-url=https://pip.repos.neuron.amazonaws.com -U

pip uninstall -y transformers-neuronx

pip install transformers-neuronx==0.13.* --extra-index-url=https://pip.repos.neuron.amazonaws.com -U --no-deps
pip install sentencepiece transformers==4.48.0 -U