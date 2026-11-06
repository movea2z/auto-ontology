# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Cloudflare Vectorize backend for the data and semantic layers.

Implements the same :class:`~auto_ontology.vdb.base.VDBBackend` contract as
:class:`auto_ontology.vdb.postgres.PostgresVDB`, so the pgvector -> Vectorize
migration is a config switch (``AUTO_ONTOLOGY_VDB_BACKEND=vectorize``) rather
than a rewrite. Every caller keeps using ``get_data_vdb()`` /
``get_semantic_vdb()`` / :class:`auto_ontology.utils.retriever.Retriever`.

Differences from pgvector that callers must know:

* **No ``halfvec`` / no HNSW to maintain.** Vectorize stores float32 vectors and
  runs its own indexed search. Precision is *higher* than the pgvector halfvec
  path, not lower.
* **``score`` is similarity, not distance.** Vectorize returns a similarity
  score (higher = closer) for cosine. We expose ``_distance = 1 - score`` so the
  ``{"text", "metadata", "_distance"}`` shape and "lower is closer" semantics
  match pgvector. **Validate recall against the pgvector baseline** after cutover.
* **No bulk delete-all.** Vectorize has no "delete every row" call, so
  :meth:`delete_all` recreates the index (delete + create) — authoritative for
  emptiness; the returned count is a best-effort pre-query.
* **Ids must be supplied.** pgvector assigned row ids; Vectorize keys on the id
  we give it. We use ``metadata["id"]`` when present, else a deterministic hash
  of ``(database_name, document_type, text)`` so deletes stay stable.
"""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Any, Optional

from auto_ontology.vdb.base import VDBBackend, _extract, _flatten

logger = logging.getLogger(__name__)

_DATABASE_METADATA_COLUMN = "database_name"
_LABEL_METADATA_COLUMN = "label"
# delete_all's best-effort count query is capped (Vectorize has no listing API).
_COUNT_CAP = 1000


class VectorizeVDB(VDBBackend):
    """Vector store backed by Cloudflare Vectorize."""

    def __init__(
        self,
        *,
        reset: bool = False,
        collection_name: str = "data_objects_layer",
        index_id: Optional[str] = None,
        index_name: Optional[str] = None,
        dimension: int = 2048,
        metric: str = "cosine",
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.collection_name = collection_name
        self.index_id = index_id
        self.index_name = index_name or collection_name
        self.dimension = dimension
        self.metric = metric
        self._index = None  # lazily resolved Cloudflare VectorIndex

        database_name = kwargs.get("database_name")
        if database_name and reset:
            ids = self.delete_by_database(database_name)
            logger.info(
                "VectorizeVDB.delete_by_database: deleted %d rows for database %s",
                len(ids), database_name,
            )

    # ------------------------------------------------------------------
    # Client / index lifecycle
    # ------------------------------------------------------------------

    def _client(self):
        try:
            from cloudflare import Cloudflare
        except ImportError as e:  # pragma: no cover - depends on runtime
            raise RuntimeError(
                "The 'cloudflare' SDK is required for the vectorize backend "
                "(pip install cloudflare). Set AUTO_ONTOLOGY_VDB_BACKEND=postgres "
                "to use the pgvector backend instead."
            ) from e
        token = os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")
        if not token:
            raise RuntimeError(
                "CLOUDFLARE_API_TOKEN (or CF_API_TOKEN) is required for VectorizeVDB."
            )
        return Cloudflare(api_token=token)

    def _resolve_or_create(self, cf) -> Any:
        """Return the VectorIndex for index_id, else name (creating if missing)."""
        if self.index_id:
            return cf.vector_indexes.get(self.index_id)

        name = self.index_name
        try:
            return cf.vector_indexes.get_by_name(name)
        except Exception:
            logger.info(
                "VectorizeVDB: index %r not found; creating (dim=%d, metric=%s)",
                name, self.dimension, self.metric,
            )
            created = cf.vector_indexes.create(
                {"name": name, "dimension": self.dimension, "metric": self.metric}
            )
            # Remember the created id so later calls can resolve by id.
            self.index_id = getattr(created, "id", None)
            return created

    def _ensure_index(self) -> Any:
        if self._index is not None:
            return self._index
        self._index = self._resolve_or_create(self._client())
        return self._index

    def create_index(self, **kwargs: Any) -> str:
        self._ensure_index()
        return self.collection_name

    # ------------------------------------------------------------------
    # Read / write
    # ------------------------------------------------------------------

    def write_to_index(
        self, records: list, batch_size: int = 500, **kwargs: Any
    ) -> int:
        vectors = []
        skipped = 0
        for record in _flatten(records):
            extracted = _extract(record)
            if extracted is None:
                skipped += 1
                continue
            text, doc_metadata, embedding = extracted
            # Guarantee the text is retrievable as hit["text"]. In the real
            # flow records.py already sets metadata["content"], so setdefault
            # leaves it untouched; this only covers synthetic text-less rows.
            doc_metadata.setdefault("content", text)
            vectors.append(
                {
                    "id": doc_metadata.get("id") or _id_for(doc_metadata),
                    "vector": embedding,
                    "metadata": doc_metadata,
                }
            )

        if not vectors:
            logger.info("VectorizeVDB.write_to_index: no rows to insert (skipped %d)", skipped)
            return 0

        index = self._ensure_index()
        inserted = 0
        for start in range(0, len(vectors), batch_size):
            index.upsert(vectors=vectors[start : start + batch_size])
            inserted += len(vectors[start : start + batch_size])

        logger.info(
            "VectorizeVDB.write_to_index: inserted %d rows into %s (skipped %d)",
            inserted, self.collection_name, skipped,
        )
        return inserted

    def delete_by_database(self, database_name: str) -> list[str]:
        index = self._ensure_index()
        ids = self._query_ids({_DATABASE_METADATA_COLUMN: {"eq": database_name}})
        try:
            index.delete_by_conditions({_DATABASE_METADATA_COLUMN: {"eq": database_name}})
        except Exception:
            logger.warning(
                "VectorizeVDB.delete_by_database: delete_by_conditions failed for %s",
                database_name, exc_info=True,
            )
        logger.info(
            "VectorizeVDB.delete_by_database: deleted ~%d rows for database %s",
            len(ids), database_name,
        )
        return ids

    def delete_all(self) -> int:
        # Best-effort count (Vectorize has no listing API), then recreate.
        count = len(self._query_ids(None))
        try:
            cf = self._client()
            index = self._ensure_index()
            cf.vector_indexes.get(index.index_id or self.index_id).delete()
        except Exception:
            logger.warning(
                "VectorizeVDB.delete_all: index deletion failed; "
                "recreating by name", exc_info=True,
            )
            self._resolve_or_create(cf)
        self._index = None
        logger.info(
            "VectorizeVDB.delete_all: recreated %s (~%d rows)",
            self.collection_name, count,
        )
        return count

    def delete_by_id(self, node_id: str) -> int:
        index = self._ensure_index()
        try:
            index.delete(node_id)
            return 1
        except Exception as e:
            status = getattr(e, "status", None)
            if status == 404:
                return 0
            logger.warning("VectorizeVDB.delete_by_id: delete %s failed", node_id, exc_info=True)
            return 0

    def retrieval(
        self, queries: list, top_k: int = 10, **kwargs: Any
    ) -> list[list[dict]]:
        if self._index is None:
            # No index yet (read path before any write) -> empty, like pgvector.
            return [[] for _ in queries]

        results: list[list[dict]] = []
        where = _to_filter(kwargs.get("where"))
        for query in queries:
            try:
                res = self._index.query(
                    {
                        "vector": query,
                        "topK": top_k,
                        "returnMetadata": True,
                        "filter": where,
                    }
                )
                matches = getattr(res, "matches", []) or []
                results.append(
                    [
                        {
                            "text": (m.get("metadata") or {}).get("content", ""),
                            "metadata": m.get("metadata") or {},
                            # Vectorize score is similarity; invert to distance so
                            # "lower is closer" matches pgvector cosine_ops.
                            "_distance": 1.0 - float(m.get("score", 0.0)),
                        }
                        for m in matches
                    ]
                )
            except Exception as e:
                logger.error("VectorizeVDB.retrieval: %s", e)
                return [[] for _ in queries]
        return results

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _query_ids(self, conditions: Optional[dict], top_k: int = _COUNT_CAP) -> list[str]:
        """Best-effort id list for a filter (Vectorize has no listing API)."""
        try:
            res = self._index.query(
                {
                    "vector": [0.0] * self.dimension,
                    "topK": top_k,
                    "returnMetadata": True,
                    "filter": conditions,
                }
            )
            return [m.get("id") for m in (getattr(res, "matches", []) or []) if m.get("id")]
        except Exception:
            logger.debug("VectorizeVDB._query_ids: best-effort listing failed", exc_info=True)
            return []

    def close(self) -> None:
        # The Cloudflare SDK is stateless per call; nothing to dispose.
        self._index = None


def _id_for(metadata: dict) -> str:
    """Deterministic id from stable fields so deletes stay stable across runs."""
    key = "|".join(
        str(metadata.get(k, ""))
        for k in (_DATABASE_METADATA_COLUMN, "document_type", "content")
    )
    return "vz-" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:32]


def _to_filter(where: Optional[dict]) -> Optional[dict]:
    """Flat ``{column: value | [values]}`` -> Vectorize filter syntax."""
    if not where:
        return None
    out = {}
    for col, val in where.items():
        out[col] = {"in": val} if isinstance(val, list) else {"eq": val}
    return out
