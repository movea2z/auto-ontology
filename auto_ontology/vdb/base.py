# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Abstract VDB backend interface + shared record helpers.

The data layer and semantic layer both need a vector store with the same public
surface (``write_to_index`` / ``retrieval`` / ``delete_*``). Two backends
implement this contract:

* :class:`auto_ontology.vdb.postgres.PostgresVDB` — Postgres + pgvector (current).
* :class:`auto_ontology.vdb.vectorize.VectorizeVDB` — Cloudflare Vectorize.

:func:`auto_ontology.vdb.get_vdb` selects the backend via the
``AUTO_ONTOLOGY_VDB_BACKEND`` env var (``"postgres"`` default, ``"vectorize"``
for the Cloudflare-native path). Keeping both behind one interface means the
migration is a config switch, not a rewrite: every caller keeps using
``get_data_vdb()`` / ``get_semantic_vdb()`` / ``Retriever`` unchanged.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Iterable, Optional

from langchain_core.embeddings import Embeddings


class _UnusableEmbeddings(Embeddings):
    """Placeholder used when no query-side embedder is supplied.

    Only fires if a caller runs :meth:`VDBBackend.retrieval` without passing an
    ``embeddings`` instance. Ingestion bulk-loads pre-made embeddings and never
    calls this.
    """

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError(
            "VDB backend has no embeddings function configured. "
            "Pass `embeddings=<Embeddings>` to enable retrieval."
        )

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]


class VDBBackend(ABC):
    """Common vector-store contract for the data and semantic layers."""

    # Tells :class:`auto_ontology.utils.retriever.Retriever` to build the
    # ``where`` filter as a flat ``{column: value | [values]}`` dict (fed
    # straight into the backend's filter) rather than a SQL ``LIKE`` over a JSON
    # metadata column.
    metadata_filter_format: str = "dict"

    def __init__(self, *, embeddings: Optional[Embeddings] = None, **kwargs: Any) -> None:
        self.embeddings: Embeddings = embeddings or _UnusableEmbeddings()

    # -- lifecycle ---------------------------------------------------------

    @abstractmethod
    def create_index(self, **kwargs: Any) -> str:
        """Ensure the collection/index exists; return its name."""

    # -- read / write ------------------------------------------------------

    @abstractmethod
    def write_to_index(
        self,
        records: list,
        batch_size: int = 500,
        **kwargs: Any,
    ) -> int:
        """Bulk-insert records, returning the number of rows written."""

    @abstractmethod
    def delete_by_database(self, database_name: str) -> list[str]:
        """Delete all rows for ``database_name``; return the deleted ids."""

    @abstractmethod
    def delete_all(self) -> int:
        """Delete every row in the collection; return the count deleted."""

    @abstractmethod
    def delete_by_id(self, node_id: str) -> int:
        """Delete the row with id ``node_id``; return 1 if it existed else 0."""

    @abstractmethod
    def retrieval(
        self,
        queries: list,
        top_k: int = 10,
        **kwargs: Any,
    ) -> list[list[dict]]:
        """k-NN search for each query vector; ``kwargs["where"]`` is a filter."""

    def run(self, records: list) -> int:
        """Create the collection if needed, then write records to it."""
        self.create_index()
        return self.write_to_index(records)

    def close(self) -> None:
        """Release resources. Backends without a persistent pool need no-op."""


def _flatten(records: Iterable) -> Iterable:
    """Yield record dicts from a possibly-nested list of records."""
    for item in records:
        if isinstance(item, dict):
            yield item
        elif isinstance(item, list):
            yield from _flatten(item)
        else:
            yield item


def _extract(record: dict):
    """Return ``(text, doc_metadata, embedding)`` for a record, or ``None``.

    Mirrors :meth:`PostgresVDB.write_to_index` exactly: the embedding is
    ``metadata["embedding"]`` (a missing one means skip), ``text`` is the first
    of ``text`` / ``content`` / ``metadata.content``, and ``doc_metadata`` keeps
    ``document_type`` plus every metadata key except ``embedding``.
    """
    metadata = record.get("metadata") or {}
    embedding = metadata.get("embedding")
    if not embedding:
        return None

    text = record.get("text") or record.get("content") or metadata.get("content")
    doc_metadata = {"document_type": record.get("document_type")}
    doc_metadata.update({k: v for k, v in metadata.items() if k != "embedding"})
    return text, doc_metadata, [float(v) for v in embedding]
