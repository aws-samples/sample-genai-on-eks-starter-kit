#!/bin/bash
set -euo pipefail

CONFIG_PATH="/home/openclaw/.config/openclaw/openclaw.json"

echo "[start] Patching openclaw.json..."
node /app/dist/patch-config.js "${CONFIG_PATH}" 2>&1 || echo "[start] WARNING: patch-config exited with code $?"

echo "[start] Starting Bridge server (background)..."
node /app/dist/index.js &
BRIDGE_PID=$!

echo "[start] Starting OpenClaw Gateway (foreground)..."
openclaw gateway --port 18789 --verbose --allow-unconfigured --bind loopback 2>&1 &
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
