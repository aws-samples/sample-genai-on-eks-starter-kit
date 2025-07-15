#!/bin/bash

# Ref https://awsdocs-neuron.readthedocs-hosted.com/en/latest/general/setup/neuron-setup/pytorch/neuronx/amazon-linux/torch-neuronx-al2023.html

# Configure Linux for Neuron repository updates
tee /etc/yum.repos.d/neuron.repo > /dev/null <<EOF
[neuron]
name=Neuron YUM Repository
baseurl=https://yum.repos.neuron.amazonaws.com
enabled=1
metadata_expire=0
EOF
rpm --import https://yum.repos.neuron.amazonaws.com/GPG-PUB-KEY-AMAZON-AWS-NEURON.PUB

# Update OS packages 
yum update -y

# Install OS headers 
yum install kernel-devel-$(uname -r) kernel-headers-$(uname -r) -y

# Install git 
yum install git -y

# install Neuron Driver
yum install aws-neuronx-dkms-2.* -y

# Install Neuron Runtime 
yum install aws-neuronx-collectives-2.* -y
yum install aws-neuronx-runtime-lib-2.* -y

# Install Neuron Tools 
yum install aws-neuronx-tools-2.* -y

# Add PATH
export PATH=/opt/aws/neuron/bin:$PATH