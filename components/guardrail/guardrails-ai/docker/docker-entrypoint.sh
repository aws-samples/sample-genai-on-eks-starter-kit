#!/bin/bash
set -e

echo "Configuring Guardrails AI..."

# Check if GUARDRAILS_TOKEN is set
if [ -z "$GUARDRAILS_TOKEN" ]; then
    echo "Error: GUARDRAILS_TOKEN environment variable is not set"
    exit 1
fi

# Configure guardrails with token from environment
guardrails configure --disable-metrics --enable-remote-inferencing --token $GUARDRAILS_TOKEN

# Install validators from hub
echo "Installing validators from Guardrails Hub..."
guardrails hub install hub://guardrails/detect_pii

echo "Starting Guardrails API server..."
# Start the application
exec gunicorn --bind 0.0.0.0:8000 --timeout=90 --workers=4 'guardrails_api.app:create_app(None, "config.py")'
