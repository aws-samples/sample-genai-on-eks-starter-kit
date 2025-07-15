#!/bin/bash

# Ref https://docs.vllm.ai/en/latest/getting_started/installation/aws_neuron.html?h=aws+neuron#set-up-using-python

git clone https://github.com/vllm-project/vllm.git
cd vllm
pip install -U -r requirements/neuron.txt
VLLM_TARGET_DEVICE="neuron" pip install -e .