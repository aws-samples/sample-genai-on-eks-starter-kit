#!/bin/bash
set -euo pipefail

# node:22-slim has uid 1000 = 'node' user; K8s runAsUser: 1000 maps here
export HOME="/home/node"

# OpenClaw stores config at ~/.openclaw/openclaw.json (not ~/.config/openclaw/)
OPENCLAW_DIR="${HOME}/.openclaw"
CONFIG_PATH="${OPENCLAW_DIR}/openclaw.json"
DEVICES_DIR="${OPENCLAW_DIR}/devices"

# Ensure directories exist
mkdir -p "${OPENCLAW_DIR}" "${DEVICES_DIR}"

# Create config with gateway settings + agent model override.
# Use "openai" provider so the gateway reads OPENAI_API_KEY / OPENAI_BASE_URL env vars
# to route LLM calls through LiteLLM instead of defaulting to Anthropic.
# Auth uses "env" method — the gateway reads OPENCLAW_GATEWAY_TOKEN from environment directly.
LITELLM_MODEL="${LITELLM_MODEL_NAME:-vllm/default}"

echo "[start] Writing openclaw.json..."
cat > "${CONFIG_PATH}" <<CFGEOF
{
  "gateway": {
    "mode": "local",
    "port": 18789,
    "auth": {
      "mode": "token",
      "token": "${OPENCLAW_GATEWAY_TOKEN:-openclaw-gateway-token}"
    }
  },
  "models": {
    "providers": {
      "openai": {
        "api": "openai-completions",
        "baseUrl": "${OPENAI_BASE_URL:-http://litellm.litellm:4000/v1}",
        "models": [
          {
            "id": "${LITELLM_MODEL}",
            "name": "${LITELLM_MODEL}",
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/${LITELLM_MODEL}"
      }
    }
  }
}
CFGEOF
echo "[start] Config written: $(cat "${CONFIG_PATH}")"

# Create device pairing with operator.write scope for the bridge client
DEVICE_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-openclaw-gateway-token}"
echo "[start] Writing devices/paired.json..."
cat > "${DEVICES_DIR}/paired.json" <<DEVEOF
{
  "devices": [
    {
      "deviceId": "gateway-client",
      "deviceToken": "${DEVICE_TOKEN}",
      "scopes": ["operator.read", "operator.write", "operator.admin"],
      "paired": true,
      "pairedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
DEVEOF
echo "[start] Device pairing written."

# Configure git credential helper if GIT_USERNAME and GIT_TOKEN are provided
if [ -n "${GIT_USERNAME:-}" ] && [ -n "${GIT_TOKEN:-}" ]; then
  echo "[start] Configuring git credential helper..."
  git config --global credential.helper '!f() { echo "username=${GIT_USERNAME}"; echo "password=${GIT_TOKEN}"; }; f'
fi

echo "[start] Starting Bridge server (background)..."
node /app/dist/index.js &
BRIDGE_PID=$!

echo "[start] Starting OpenClaw Gateway (foreground)..."
openclaw gateway --port 18789 --verbose --bind loopback 2>&1 &
GATEWAY_PID=$!

cleanup() {
  echo "[start] Received signal, shutting down..."
  kill ${BRIDGE_PID} ${GATEWAY_PID} 2>/dev/null || true
  wait
  exit 0
}

trap cleanup SIGTERM SIGINT

# Wait for either process to exit
wait -n ${BRIDGE_PID} ${GATEWAY_PID} 2>/dev/null
EXIT_CODE=$?
echo "[start] A process exited with code ${EXIT_CODE}, shutting down..."
kill ${BRIDGE_PID} ${GATEWAY_PID} 2>/dev/null || true
wait
exit ${EXIT_CODE}
