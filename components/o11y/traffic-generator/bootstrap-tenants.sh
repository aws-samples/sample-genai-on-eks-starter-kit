#!/usr/bin/env bash
# Create the demo tenants (LiteLLM teams + virtual keys) that the traffic
# generator uses, and store the raw keys in the `traffic-tenant-keys` Secret.
#
# Why teams and keys rather than a shared master key: LiteLLM's Prometheus
# counters (litellm_input_tokens_metric, litellm_input_cached_tokens_metric,
# litellm_proxy_total_requests_metric, ...) carry `team_alias` and
# `api_key_alias` labels — that is the tenant axis of the prefix-cache SLI.
#
# Idempotent: existing teams are reused; keys are rotated (LiteLLM only stores
# key hashes, so a lost raw key cannot be read back) and the Secret rewritten.
#
# Usage:
#   AWS_PROFILE=... ./bootstrap-tenants.sh            # port-forwards svc/litellm
#   LITELLM_URL=http://localhost:4000 ./bootstrap-tenants.sh
set -euo pipefail

NS="${LITELLM_NAMESPACE:-litellm}"
MASTER_KEY="${LITELLM_MASTER_KEY:-$(kubectl -n "$NS" get secret litellm-masterkey -o jsonpath='{.data.masterkey}' | base64 -d)}"

PF_PID=""
if [[ -z "${LITELLM_URL:-}" ]]; then
  kubectl -n "$NS" port-forward svc/litellm 14000:4000 >/dev/null 2>&1 &
  PF_PID=$!
  trap '[[ -n "$PF_PID" ]] && kill "$PF_PID" 2>/dev/null || true' EXIT
  LITELLM_URL="http://127.0.0.1:14000"
  for _ in $(seq 1 30); do
    curl -sf -m 2 "$LITELLM_URL/health/liveliness" >/dev/null 2>&1 && break
    sleep 1
  done
fi

api() { # method path [json] — retried: a fresh kubectl port-forward drops the first request now and then
  curl -sS -m 30 --retry 3 --retry-all-errors --retry-delay 1 -X "$1" "$LITELLM_URL$2" \
    -H "Authorization: Bearer $MASTER_KEY" -H "Content-Type: application/json" \
    ${3:+-d "$3"}
}

# tenant|team_alias|description
TENANTS=(
  "support-bot|cs-platform|Customer support assistant: stable long prompt, multi-turn"
  "research-agent|data-science|Research agent: timestamped prompt (prefix-breaking)"
  "code-review|dev-tools|Code review agent: long tool-schema prefix"
  "openwebui|end-users|Open WebUI chat users: every model LiteLLM exposes"
  "agent-runtime|agent-platform|Operations agent: OpenAI tools schemas + tool_choice=auto, mostly GLM-5.2"
)

# macOS ships bash 3.2 (no associative arrays): collect the Secret literals in a plain array.
SECRET_ARGS=()
for entry in "${TENANTS[@]}"; do
  IFS='|' read -r tenant team desc <<<"$entry"

  team_id=$(api GET /team/list | python3 -c '
import json,sys
alias=sys.argv[1]
for t in json.load(sys.stdin):
    if t.get("team_alias")==alias:
        print(t["team_id"]); break' "$team")
  if [[ -z "$team_id" ]]; then
    team_id=$(api POST /team/new "{\"team_alias\":\"$team\",\"metadata\":{\"tenant\":\"$tenant\"}}" \
      | python3 -c 'import json,sys;print(json.load(sys.stdin)["team_id"])')
    echo "created team $team ($team_id)"
  else
    echo "reusing team $team ($team_id)"
  fi

  # Rotate: drop any previous key with this alias, then mint a new one.
  api POST /key/delete "{\"key_aliases\":[\"$tenant\"]}" >/dev/null 2>&1 || true
  # openwebui mirrors what Open WebUI itself can reach (every model, incl.
  # Bedrock-backed ones); the agent tenants stay pinned to the vLLM pools.
  if [[ "$tenant" == "openwebui" ]]; then
    models='[]'
  else
    models='["vllm/gpt-oss-120b","vllm/qwen36-27b-fp8","vllm/glm-52-fp8","vllm/solar-open2-250b","vllm/qwen3-8b-neuron","vllm/deepseek-r1-qwen3-8b-neuron"]'
  fi
  key=$(api POST /key/generate \
    "{\"key_alias\":\"$tenant\",\"team_id\":\"$team_id\",\"metadata\":{\"tenant\":\"$tenant\",\"description\":\"$desc\"},\"models\":$models}" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["key"])')
  SECRET_ARGS+=("--from-literal=$tenant=$key")
  echo "minted key for $tenant (alias=$tenant, team=$team)"
done

kubectl -n "$NS" create secret generic traffic-tenant-keys "${SECRET_ARGS[@]}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Secret traffic-tenant-keys written in namespace $NS. Restart the generator to pick it up:"
echo "  kubectl -n $NS rollout restart deployment/traffic-generator"
