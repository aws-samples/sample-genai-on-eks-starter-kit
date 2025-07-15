#!/bin/bash

optimum-cli export neuron \
  --model Qwen/Qwen3-8B \
  --batch_size 1 \
  --sequence_length 4096 \
  --auto_cast_type fp16 \
  --num_cores 2 \
  /root/.cache/neuron/Qwen/Qwen3-8B-optimum-neuron/
