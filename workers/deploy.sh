#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Deploy the Auto-Ontology agent gateway Worker + Container.
#
# The Container image is the repo-root Dockerfile (the existing agent image,
# unchanged). `wrangler deploy` builds and publishes both the Worker and the
# Container in one step.
#
# Before running:
#   1. Install wrangler if needed:  npm i -g wrangler
#   2. Authenticate:                wrangler login
#   3. Set the shared secret:       wrangler secret put CLOUDFLARE_AGENT_SECRET
#   4. (Tier 2 only) Configure the agent Container's runtime env — DB + LLM
#      keys — so the agent can actually serve /chat/completions. See the NOTE
#      in README.md ("Container runtime env").

set -uo pipefail

cd "$(dirname "$0")"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "ERROR: wrangler not found. Install with: npm i -g wrangler" >&2
  exit 2
fi

if ! wrangler whoami >/dev/null 2>&1; then
  echo "ERROR: not logged in. Run: wrangler login" >&2
  exit 2
fi

# Warn if the shared secret is still the placeholder.
if wrangler secret list 2>/dev/null | grep -q '^CLOUDFLARE_AGENT_SECRET$'; then
  echo "CLOUDFLARE_AGENT_SECRET is set."
else
  echo "NOTE: set the shared secret first:"
  echo "      wrangler secret put CLOUDFLARE_AGENT_SECRET"
fi

echo ">> Deploying Worker + Container..."
wrangler deploy "$@"

echo
echo ">> Deployed. Get the URL:"
wrangler deployment url 2>/dev/null || true
echo
echo ">> Then run the smoke test:"
echo "      WORKER_URL=\"$(wrangler deployment url 2>/dev/null || echo '<your-worker-url>')\" \\"
echo "      CLOUDFLARE_AGENT_SECRET='<secret>' ./smoke-test.sh"
