#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Provision the Cloudflare Vectorize indexes the Auto-Ontology agent retrieves
# against. Two indexes, one per layer, matching the collections the code uses:
#
#   DATA_VDB_COLLECTION  = "data_objects_layer"   (tabular / data layer)
#   SEMANTIC_VDB_COLLECTION = "semantic_layer"    (glossary / semantic layer)
#
# The default embedder emits 2048-dimensional vectors, exceeding Vectorize's
# documented 1536-dimension limit. Override VECTORIZE_DIMENSIONS only after
# implementing a compatible embedding strategy for both writes and queries.
# https://developers.cloudflare.com/vectorize/platform/limits/

set -uo pipefail

cd "$(dirname "$0")"

DIMENSIONS="${VECTORIZE_DIMENSIONS:-2048}"
METRIC="${VECTORIZE_METRIC:-cosine}"   # cosine | euclidean

if ! [[ "$DIMENSIONS" =~ ^[0-9]+$ ]] || (( 10#$DIMENSIONS < 1 || 10#$DIMENSIONS > 1536 )); then
  echo "ERROR: VECTORIZE_DIMENSIONS must be between 1 and 1536; current default embeddings have 2048 dimensions." >&2
  echo "Implement a compatible embedding strategy before provisioning Vectorize." >&2
  exit 1
fi
INDEXES=(data_objects_layer semantic_layer)

if ! command -v wrangler >/dev/null 2>&1; then
  echo "ERROR: wrangler not found. Install with: npm i -g wrangler (>= 3.71.0 for Vectorize V2)" >&2
  exit 2
fi
if ! wrangler whoami >/dev/null 2>&1; then
  echo "ERROR: not logged in. Run: wrangler login" >&2
  exit 2
fi
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -z "${CF_API_TOKEN:-}" ]]; then
  echo "WARN: neither CLOUDFLARE_API_TOKEN nor CF_API_TOKEN is set." >&2
  echo "      Provisioning (create) only needs an authed wrangler session;" >&2
  echo "      the Container still needs CLOUDFLARE_API_TOKEN at runtime." >&2
fi

echo ">> Creating ${#INDEXES[@]} Vectorize indexes (dimensions=${DIMENSIONS}, metric=${METRIC})..."
for name in "${INDEXES[@]}"; do
  if wrangler vectorize get "$name" >/dev/null 2>&1; then
    echo "  exists  $name"
    continue
  fi
  echo "  create  $name"
  if ! wrangler vectorize create "$name" --dimensions="$DIMENSIONS" --metric="$METRIC"; then
    echo "ERROR: failed to create index '$name'." >&2
    exit 1
  fi
done

echo
echo ">> Indexes:"
wrangler vectorize list

echo
echo ">> Next: set CLOUDFLARE_API_TOKEN (Account > Vectorize > Edit permission) and run:"
echo "      AUTO_ONTOLOGY_VDB_BACKEND=vectorize CLOUDFLARE_API_TOKEN=cf_... <agent with a DB>"
echo ">> Then run the recall comparison (Phase 2 task 13) against the pgvector baseline."
