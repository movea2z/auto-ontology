#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Smoke test for the Auto-Ontology agent gateway (Cloudflare Workers + Containers).
#
# Tiers:
#   Tier 1 (Worker-level, no Container needed):
#     T1a  GET  /health                       -> 200 "ok"
#     T1b  POST /chat/completions, no auth    -> 401
#     T1c  POST /chat/completions, bad secret -> 401
#   Tier 2 (end-to-end, Container must be built + agent running):
#     T2   POST /chat/completions, good secret + {"question":...}
#          200 + stream ending "data: [DONE]"  -> FULL PASS
#          409                                 -> PARTIAL PASS (agent reachable + auth OK,
#                                               but semantic layer not compiled)
#          502                                 -> FAIL (Container not ready / build failed)
#
# Prerequisites (run this in an environment that has them):
#   - wrangler installed and logged in (`wrangler login`)
#   - a deployed Worker (run ./deploy.sh or `wrangler deploy` in workers/)
#   - the agent Container built and able to run (see NOTE below about env injection)
#
# Config (all env-overridable):
#   WORKER_URL        (required)   deployed Worker base URL, e.g. https://worker.supersonic-lan.workers.dev
#   CLOUDFLARE_AGENT_SECRET (req for T1b/c, T2)  shared secret the client presents
#   SMOKE_DEPLOY      (default off) set to "true" to deploy before testing
#   SMOKE_E2E         (default on)  set to "false" to skip Tier 2
#   SMOKE_QUESTION    (default "ping")  question sent in the e2e request
#   SMOKE_VERBOSE     (default off) print full response bodies

set -uo pipefail

WORKER_URL="${WORKER_URL:-}"
SECRET="${CLOUDFLARE_AGENT_SECRET:-}"
USER_ID="${SMOKE_USER_ID:-smoke-test}"
SESSION_ID="${SMOKE_SESSION_ID:-smoke-$(date +%s)}"
QUESTION="${SMOKE_QUESTION:-ping}"
DEPLOY="${SMOKE_DEPLOY:-false}"
E2E="${SMOKE_E2E:-true}"
VERBOSE="${SMOKE_VERBOSE:-false}"

pass=0; fail=0; warn=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
warnf(){ echo "  WARN  $1"; warn=$((warn+1)); }

# curl helper: returns HTTP status on stdout, body to $RESP_FILE (or /dev/null).
# Usage: http_code METHOD URL [extra args...]
RESP_FILE="$(mktemp)"
trap 'rm -f "$RESP_FILE"' EXIT
http_code() {
  local method="$1" url="$2"; shift 2
  curl -sS -N -o "$RESP_FILE" -w '%{http_code}' -X "$method" "$url" "$@"
}

echo "============================================================"
echo " Auto-Ontology gateway smoke test"
echo "  WORKER_URL = ${WORKER_URL}"
echo "  SESSION_ID = ${SESSION_ID}"
echo "  e2e        = ${E2E}   deploy=${DEPLOY}"
echo "============================================================"

if [[ -z "$WORKER_URL" ]]; then
  echo "ERROR: set WORKER_URL (deployed Worker base URL)." >&2
  exit 2
fi
if [[ -z "$SECRET" ]]; then
  echo "ERROR: set CLOUDFLARE_AGENT_SECRET." >&2
  exit 2
fi

# --- optional deploy ---------------------------------------------------------
if [[ "$DEPLOY" == "true" ]]; then
  echo
  echo ">> Deploying Worker + Container (wrangler deploy)..."
  ( cd "$(dirname "$0")" && wrangler deploy ) || { echo "ERROR: deploy failed." >&2; exit 2; }
fi

# --- Tier 1 ------------------------------------------------------------------
echo
echo "Tier 1: Worker health + auth"

# T1a: health
code="$(http_code GET "${WORKER_URL}/health")"
if [[ "$code" == "200" ]] && grep -qi "ok" "$RESP_FILE"; then
  ok "GET /health -> 200 ok"
else
  bad "GET /health -> $code (body: $(tr -d '\n' < "$RESP_FILE" | head -c 120))"
fi

# T1b: no auth -> 401
code="$(http_code POST "${WORKER_URL}/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{\"question\":\"$QUESTION\",\"sessionId\":\"$SESSION_ID\"}")"
if [[ "$code" == "401" ]]; then ok "no auth -> 401"; else bad "no auth -> $code (expected 401)"; fi

# T1c: wrong secret -> 401
code="$(http_code POST "${WORKER_URL}/chat/completions" \
  -H 'Authorization: Bearer wrong-secret' \
  -H 'Content-Type: application/json' \
  -d "{\"question\":\"$QUESTION\"}")"
if [[ "$code" == "401" ]]; then ok "bad secret -> 401"; else bad "bad secret -> $code (expected 401)"; fi

# --- Tier 2 ------------------------------------------------------------------
if [[ "$E2E" == "true" ]]; then
  echo
  echo "Tier 2: end-to-end SSE proxy"
  code="$(http_code POST "${WORKER_URL}/chat/completions" \
    -H "Authorization: Bearer $SECRET" \
    -H "x-auto-ontology-user-id: $USER_ID" \
    -H "Content-Type: application/json" \
    --max-time 90 \
    -d "{\"question\":\"$QUESTION\"}")"

  body="$(tr -d '\r' < "$RESP_FILE")"
  if [[ "$VERBOSE" == "true" ]]; then echo "  --- response body ---"; echo "$body" | head -c 2000; echo; echo "  ---------------------"; fi

  if [[ "$code" == "200" ]] && grep -q "data: \[DONE\]" "$RESP_FILE"; then
    ok "good secret -> 200 SSE stream ending in data: [DONE]"
  elif [[ "$code" == "409" ]]; then
    warnf "good secret -> 409: agent reachable + auth OK, but semantic layer not compiled"
    echo "        (expected on a fresh Container; compile the semantic layer for a full 200)"
  elif [[ "$code" == "502" ]]; then
    bad "good secret -> 502: Container not ready / build failed / missing runtime env"
  elif [[ "$code" == "401" ]]; then
    bad "good secret -> 401: auth misconfigured (secret/secret-name mismatch)"
  else
    bad "good secret -> $code (expected 200/409/502/401)"
  fi
fi

# --- summary -----------------------------------------------------------------
echo
echo "============================================================"
echo " Result: $pass passed, $warn warning(s), $fail failed"
echo "============================================================"
[[ "$fail" -eq 0 ]]
