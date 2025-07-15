#!/bin/bash

# Ref https://huggingface.co/docs/optimum-neuron/installation

python -m pip config set global.extra-index-url https://pip.repos.neuron.amazonaws.com

python -m pip install --upgrade-strategy eager optimum-neuron[neuronx]
