# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""VDB initialization — data layer and semantic layer collections."""

from __future__ import annotations

import logging
import os

from auto_ontology.infra.postgres import get_postgres_connection_string
from auto_ontology.vdb.postgres import PostgresVDB

logger = logging.getLogger(__name__)

DATA_VDB_COLLECTION: str = "data_objects_layer"
SEMANTIC_VDB_COLLECTION: str = "semantic_layer"
VDB_SCHEMA: str = "vdb"

# Backend selection for the Cloudflare-native path. "postgres" (default) keeps
# the current pgvector store; "vectorize" swaps in Cloudflare Vectorize without
# touching any caller. Set AUTO_ONTOLOGY_VDB_BACKEND=vectorize to use it.
_VDB_BACKEND = os.environ.get("AUTO_ONTOLOGY_VDB_BACKEND", "postgres").lower()


def _build_vdb(
    *,
    database_name: str | None = None,
    collection_name: str = DATA_VDB_COLLECTION,
    reset: bool = False,
) -> PostgresVDB:
    if _VDB_BACKEND == "vectorize":
        # Imported lazily so the pgvector path never requires the cloudflare SDK.
        from auto_ontology.vdb.vectorize import VectorizeVDB

        return VectorizeVDB(
            reset=reset,
            collection_name=collection_name,
            database_name=database_name,
        )
    if _VDB_BACKEND != "postgres":
        raise ValueError(
            f"Unknown AUTO_ONTOLOGY_VDB_BACKEND={_VDB_BACKEND!r}; "
            "expected 'postgres' or 'vectorize'."
        )

    connection_string = get_postgres_connection_string()
    return PostgresVDB(
        reset=reset,
        connection_string=connection_string,
        collection_name=collection_name,
        schema_name=VDB_SCHEMA,
        database_name=database_name,
    )


def get_vdb(
    *,
    database_name: str | None = None,
    collection_name: str = DATA_VDB_COLLECTION,
    reset: bool = False,
) -> PostgresVDB:
    """Build the VDB for the selected backend (postgres or vectorize)."""
    return _build_vdb(
        database_name=database_name,
        collection_name=collection_name,
        reset=reset,
    )


def get_data_vdb(
    *, database_name: str | None = None, reset: bool = False
) -> PostgresVDB:
    """Backward-compatible alias for :func:`get_vdb` (tabular / data layer)."""
    return get_vdb(database_name=database_name, reset=reset)


def get_semantic_vdb(
    *, database_name: str | None = None, reset: bool = False
) -> PostgresVDB:
    """Build a PostgresVDB for the semantic layer."""
    return get_vdb(
        database_name=database_name,
        collection_name=SEMANTIC_VDB_COLLECTION,
        reset=reset,
    )
