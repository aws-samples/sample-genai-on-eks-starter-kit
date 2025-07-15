#!/bin/bash

optimum-cli export neuron \
  --model meta-llama/Llama-3.1-8B-Instruct \
  --batch_size 1 \
  --sequence_length 4096 \
  --auto_cast_type fp16 \
  --num_cores 2 \
  /root/.cache/neuron/meta-llama/Llama-3.1-8B-Instruct-optimum-neuron/
