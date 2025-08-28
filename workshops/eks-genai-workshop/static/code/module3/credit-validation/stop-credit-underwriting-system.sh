#!/bin/bash

# Credit Underwriting System Stop Script
# This script stops all MCP servers and the main credit underwriting agent

echo "Stopping Credit Underwriting System..."

# Function to kill processes on specific ports
kill_port() {
    local port=$1
    local service_name=$2
    
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; then
        echo "Stopping $service_name on port $port..."
        kill -9 $(lsof -t -i:$port) 2>/dev/null || true
        echo "$service_name stopped."
    else
        echo "$service_name on port $port is not running."
    fi
}

# Stop all services
kill_port 8400 "Image Processor"
kill_port 5200 "Income/Employment Validator"
kill_port 5300 "Address Validator"
kill_port 8080 "Credit Underwriting Agent"

echo ""
echo "Credit Underwriting System stopped successfully."
