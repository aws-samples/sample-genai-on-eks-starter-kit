#!/bin/bash
set -euo pipefail

# node:22-slim has uid 1000 = 'node' user; K8s runAsUser: 1000 maps here
export HOME="/home/node"

# OpenClaw stores config at ~/.openclaw/openclaw.json (not ~/.config/openclaw/)
OPENCLAW_DIR="${HOME}/.openclaw"
CONFIG_PATH="${OPENCLAW_DIR}/openclaw.json"
AUTH_DIR="${OPENCLAW_DIR}/agents/main/agent"
AUTH_PATH="${AUTH_DIR}/auth-profiles.json"

# Ensure directories exist
mkdir -p "${OPENCLAW_DIR}" "${AUTH_DIR}"

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
