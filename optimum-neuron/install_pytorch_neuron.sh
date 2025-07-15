#!/bin/bash

# Ref https://awsdocs-neuron.readthedocs-hosted.com/en/latest/general/setup/neuron-setup/pytorch/neuronx/amazon-linux/torch-neuronx-al2023.html

# Install External Dependency
yum install -y libxcrypt-compat

# Install Python venv 
yum install -y gcc-c++ 

# # Create Python venv
# python3.9 -m venv aws_neuron_venv_pytorch 

# # Activate Python venv 
# source aws_neuron_venv_pytorch/bin/activate 
python -m pip install -U pip 

# Install Jupyter notebook kernel
pip install ipykernel 
python3.9 -m ipykernel install --user --name aws_neuron_venv_pytorch --display-name "Python (torch-neuronx)"
pip install jupyter notebook
pip install environment_kernels

# Set pip repository pointing to the Neuron repository 
python -m pip config set global.extra-index-url https://pip.repos.neuron.amazonaws.com

# Install wget, awscli 
python -m pip install wget 
python -m pip install awscli 

# Install Neuron Compiler and Framework
python -m pip install neuronx-cc==2.* torch-neuronx torchvision