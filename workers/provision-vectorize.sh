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
# Why these exact options:
#   * --dimensions=2048  the embedder (nemotron-3.5-embed-1b) emits 2048-dim
#                        vectors; the pgvector store declares vector_size=2048.
#   * --metric=cosine    matches the pgvector halfvec_cosine_ops ranking.
#
# The Python Container authenticates to Vectorize with CLOUDFLARE_API_TOKEN via
# the cloudflare SDK (see auto_ontology/vdb/vectorize.py) — NOT a Workers
# binding — so no [[vectorize]] binding is needed for the agent path. The code
# also auto-creates a missing index (dim=2048, metric=cosine) on first use, so
# this script is best practice (stable IDs, fail-fast on bad token) rather than
# a hard requirement.

set -uo pipefail

cd "$(dirname "$0")"

DIMENSIONS="${VECTORIZE_DIMENSIONS:-2048}"
METRIC="${VECTORIZE_METRIC:-cosine}"   # cosine | euclidean
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
