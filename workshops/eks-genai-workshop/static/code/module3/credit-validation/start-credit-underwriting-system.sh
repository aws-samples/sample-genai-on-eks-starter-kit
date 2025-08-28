#!/bin/bash

# Credit Underwriting System Startup Script
# This script starts all MCP servers and the main credit underwriting agent

echo "Starting Credit Underwriting System with Image ID Support..."

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Activate virtual environment if it exists
if [ -f "$SCRIPT_DIR/bin/activate" ]; then
    echo "Activating virtual environment..."
    source "$SCRIPT_DIR/bin/activate"
    PYTHON_CMD="python"
else
    echo "No virtual environment found, using system python3..."
    PYTHON_CMD="python3"
fi

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; then
        echo "Port $port is already in use. Killing existing process..."
        kill -9 $(lsof -t -i:$port) 2>/dev/null || true
        sleep 2
    fi
}

# Kill any existing processes on our ports
echo "Checking and cleaning up existing processes..."
check_port 5200
check_port 5300
check_port 8400
check_port 8080

# Change to script directory
cd "$SCRIPT_DIR"

# Start Image Processor MCP Server
echo "Starting Image Processor MCP Server on port 8400..."
$PYTHON_CMD mcp-image-processor.py &
IMAGE_PID=$!
echo "Image Processor started with PID: $IMAGE_PID"

# Wait a moment for the server to start
sleep 3

# Start Income and Employment Validation MCP Server
echo "Starting Income and Employment Validation MCP Server on port 5200..."
$PYTHON_CMD mcp-income-employment-validator.py &
INCOME_PID=$!
echo "Income/Employment Validator started with PID: $INCOME_PID"

# Wait a moment for the server to start
sleep 3

# Start Address Validation MCP Server
echo "Starting Address Validation MCP Server on port 5300..."
$PYTHON_CMD mcp-address-validator.py &
ADDRESS_PID=$!
echo "Address Validator started with PID: $ADDRESS_PID"

# Wait a moment for the server to start
sleep 3

# Start the main Credit Underwriting Agent
echo "Starting Credit Underwriting Agent on port 8080..."
$PYTHON_CMD credit-underwriting-agent.py &
AGENT_PID=$!
echo "Credit Underwriting Agent started with PID: $AGENT_PID"

echo ""
echo "=== Credit Underwriting System Started with Image ID Support ==="
echo "Image Processor: http://localhost:8400 (PID: $IMAGE_PID)"
echo "Income/Employment Validator: http://localhost:5200 (PID: $INCOME_PID)"
echo "Address Validator: http://localhost:5300 (PID: $ADDRESS_PID)"
echo "Credit Underwriting Agent: http://localhost:8080 (PID: $AGENT_PID)"
echo ""
echo "API Endpoints:"
echo "- Upload & Process Credit Application: POST http://localhost:8080/api/process_credit_application_with_upload"
echo "- Process by Image ID: POST http://localhost:8080/api/process_credit_application_by_id"
echo "- Extract Data Only: POST http://localhost:8080/api/extract_data_only"
echo "- Process Sample Image: POST http://localhost:8080/api/process_credit_application"
echo "- List Available Tools: GET http://localhost:8080/api/tools"
echo "- Health Check: GET http://localhost:8080/api/health"
echo ""
echo "To test the system with file upload:"
echo "curl -X POST -F 'image_file=@example1.png' http://localhost:8080/api/process_credit_application_with_upload"
echo ""
echo "To test with existing image ID:"
echo "curl -X POST -H 'Content-Type: application/json' -d '{\"image_id\":\"your_image_id\"}' http://localhost:8080/api/process_credit_application_by_id"
echo ""
echo "To stop all services, run: ./stop-credit-underwriting-system.sh"
echo "Or press Ctrl+C to stop this script and all services"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down Credit Underwriting System..."
    kill $IMAGE_PID 2>/dev/null || true
    kill $INCOME_PID 2>/dev/null || true
    kill $ADDRESS_PID 2>/dev/null || true
    kill $AGENT_PID 2>/dev/null || true
    echo "All services stopped."
    exit 0
}

# Set trap to cleanup on script exit
trap cleanup SIGINT SIGTERM

# Wait for all background processes
wait
