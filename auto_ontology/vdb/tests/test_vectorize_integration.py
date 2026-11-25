# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Offline integration tests for the Cloudflare Vectorize backend.

These exercise the full :class:`~auto_ontology.vdb.vectorize.VectorizeVDB`
lifecycle (write -> retrieval -> delete) against an in-memory fake Cloudflare
client with brute-force cosine k-NN, so the pgvector -> Vectorize migration is
validated without a live index, a live database, or the Cloudflare SDK.

Coverage maps to the Phase 2 tasks that were blocked on Phase 0 task 4:

* Task 11 -- write/retrieval round-trip, stable catalog ids, delete-by-database.
* Task 12 -- ``metadata_filter_format == "dict"`` contract, ``where`` filter
  forwarded to Vectorize ``where`` syntax, and the ``{"text", "metadata",
  "_distance"}`` hit shape.
* Task 13 -- Vectorize retrieval matches an independent brute-force cosine
  oracle on synthetic embeddings (recall preserved).

Run directly (``python auto_ontology/vdb/tests/test_vectorize_integration.py``)
or under pytest.
"""

from __future__ import annotations

import math
import os
import random
import sys
import types
from unittest import mock

_REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
sys.path.insert(0, _REPO_ROOT)

from auto_ontology.utils.embedding import EmbedParams  # noqa: E402
from auto_ontology.utils.retriever import Retriever  # noqa: E402
from auto_ontology.vdb.vectorize import VectorizeVDB  # noqa: E402


# ---------------------------------------------------------------------------
# Fake Cloudflare client: in-memory VectorIndex with brute-force cosine k-NN.
# ---------------------------------------------------------------------------


def _cos_sim(a: list[float], b: list[float]) -> float | None:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return None
    return dot / (na * nb)


def _matches(metadata: dict, filt: dict | None) -> bool:
    """Apply the flat Vectorize filter syntax produced by ``_to_filter``."""
    if not filt:
        return True
    for col, cond in filt.items():
        val = metadata.get(col)
        if "eq" in cond and val != cond["eq"]:
            return False
        if "in" in cond and val not in cond["in"]:
            return False
    return True


class _FakeIndex:
    """In-memory Cloudflare VectorIndex."""

    def __init__(self, index_id: str, name: str) -> None:
        self.index_id = index_id
        self.name = name
        self.rows: dict[str, dict] = {}  # id -> {"vector", "metadata"}
        self.queries: list[dict] = []  # query dicts, for assertions

    def upsert(self, vectors: list[dict]) -> None:
        for v in vectors:
            self.rows[v["id"]] = {
                "vector": [float(x) for x in v["vector"]],
                "metadata": dict(v.get("metadata") or {}),
            }

    def query(self, request_body):
        q = [float(x) for x in request_body["vector"]]
        topK = request_body.get("topK", 10)
        filter = request_body.get("filter")
        self.queries.append({"vector": q, "topK": topK, "filter": filter})
        q_norm = math.sqrt(sum(x * x for x in q))
        scored = []
        for rid, row in self.rows.items():
            if not _matches(row["metadata"], filter):
                continue
            # A zero-norm query (the _query_ids listing probe) has no cosine
            # direction; rank all filtered rows equally rather than skipping them.
            if q_norm == 0:
                score = 0.0
            else:
                s = _cos_sim(q, row["vector"])
                if s is None:
                    continue
                score = s
            scored.append((score, rid, row))
        scored.sort(key=lambda t: t[0], reverse=True)
        matches = [
            {"id": rid, "score": score, "metadata": row["metadata"]}
            for score, rid, row in scored[:topK]
        ]
        return types.SimpleNamespace(matches=matches)

    def delete(self, node_id=None) -> None:
        if node_id is None:
            self.rows.clear()
        else:
            self.rows.pop(node_id, None)

    def delete_by_conditions(self, filter) -> None:
        # CF Vectorize deletes rows matching the filter (keeps the rest).
        self.rows = {
            rid: r for rid, r in self.rows.items() if not _matches(r["metadata"], filter)
        }


class _FakeVectorIndexes:
    def __init__(self) -> None:
        self._by_id: dict[str, _FakeIndex] = {}
        self._by_name: dict[str, _FakeIndex] = {}
        self.created: list[dict] = []

    def get(self, index_id) -> _FakeIndex:
        return self._by_id[index_id]

    def get_by_name(self, name) -> _FakeIndex:
        if name in self._by_name:
            return self._by_name[name]
        raise KeyError(f"index {name} not found")

    def create(self, body: dict) -> _FakeIndex:
        idx = _FakeIndex(index_id=f"id-{body['name']}", name=body["name"])
        self._by_id[idx.index_id] = idx
        self._by_name[body["name"]] = idx
        self.created.append(body)
        return idx


class _FakeCloudflare:
    def __init__(self) -> None:
        self.vector_indexes = _FakeVectorIndexes()


def _vdb(client: _FakeCloudflare, **kwargs) -> VectorizeVDB:
    return VectorizeVDB(
        reset=False,
        collection_name="semantic_layer",
        dimension=kwargs.pop("dimension", 1024),
        metric="cosine",
    )


def _embedding(dim: int, seed: int) -> list[float]:
    rng = random.Random(seed)
    return [rng.gauss(0, 1) for _ in range(dim)]


def _record(dim: int, *, database_name, document_type, content, label, seed) -> dict:
    return {
        "document_type": document_type,
        "text": content,
        "metadata": {
            "embedding": _embedding(dim, seed),
            "database_name": database_name,
            "label": label,
            "content": content,
        },
    }


def _patch_client(client: _FakeCloudflare):
    return mock.patch.object(VectorizeVDB, "_client", return_value=client)


# ---------------------------------------------------------------------------
# Task 11 -- write/retrieval round-trip, stable catalog ids, delete-by-database
# ---------------------------------------------------------------------------


def test_write_retrieval_roundtrip():
    cf = _FakeCloudflare()
    with _patch_client(cf):
        vdb = _vdb(cf)
        vdb.create_index()
        written = vdb.write_to_index(
            [
                _record(1024, database_name="prod", document_type="Term",
                        content="revenue by region", label="Term", seed=1),
                _record(1024, database_name="prod", document_type="Term",
                        content="weather forecast", label="Term", seed=2),
            ]
        )
        assert written == 2

        hits = vdb.retrieval([_embedding(1024, 1)], top_k=2)[0]
        assert len(hits) == 2
        assert hits[0]["text"] == "revenue by region"  # self match ranks first
        assert hits[0]["_distance"] < 1e-6  # identical vector -> distance ~0
        assert hits[1]["_distance"] > hits[0]["_distance"]  # lower is closer


def test_catalog_id_is_stable_across_reembeds():
    cf = _FakeCloudflare()
    with _patch_client(cf):
        vdb = _vdb(cf)
        vdb.create_index()
        vdb.write_to_index(
            [_record(1024, database_name="prod", document_type="Term",
                     content="revenue by region", label="Term", seed=1)]
        )
        # Re-embed the same catalog entry with a fresh embedding vector: the id
        # derives from stable metadata (database_name/document_type/content),
        # not the embedding, so it must overwrite, not duplicate.
        vdb.write_to_index(
            [_record(1024, database_name="prod", document_type="Term",
                     content="revenue by region", label="Term", seed=99)]
        )
        idx = cf.vector_indexes._by_name["semantic_layer"]
        assert len(idx.rows) == 1


def test_delete_by_database_removes_only_that_database():
    cf = _FakeCloudflare()
    with _patch_client(cf):
        vdb = _vdb(cf)
        vdb.create_index()
        vdb.write_to_index(
            [
                _record(1024, database_name="prod", document_type="Term",
                        content="revenue by region", label="Term", seed=1),
                _record(1024, database_name="dev", document_type="Term",
                        content="weather forecast", label="Term", seed=2),
            ]
        )
        deleted = vdb.delete_by_database("prod")
        assert len(deleted) == 1
        idx = cf.vector_indexes._by_name["semantic_layer"]
        assert len(idx.rows) == 1  # dev remains

        hits = vdb.retrieval([_embedding(1024, 2)], top_k=5)[0]
        assert all(h["metadata"]["database_name"] == "dev" for h in hits)


# ---------------------------------------------------------------------------
# Task 12 -- filter contract, where forwarding, hit shape
# ---------------------------------------------------------------------------


def test_metadata_filter_format_is_dict():
    cf = _FakeCloudflare()
    with _patch_client(cf):
        vdb = _vdb(cf)
    assert vdb.metadata_filter_format == "dict"


def test_where_is_forwarded_as_vectorize_filter():
    cf = _FakeCloudflare()
    with _patch_client(cf):
        vdb = _vdb(cf)
        vdb.create_index()
        vdb.write_to_index(
            [
                _record(1024, database_name="prod", document_type="Term",
                        content="revenue by region", label="Term", seed=1),
                _record(1024, database_name="dev", document_type="Term",
                        content="weather forecast", label="Term", seed=2),
            ]
        )
        vdb.retrieval([_embedding(1024, 1)], top_k=5, where={"database_name": "prod"})
        sent = cf.vector_indexes._by_name["semantic_layer"].queries[-1]["filter"]
        assert sent == {"database_name": {"eq": "prod"}}


def test_list_where_becomes_vectorize_in():
    cf = _FakeCloudflare()
    with _patch_client(cf):
        vdb = _vdb(cf)
        vdb.create_index()
        vdb.write_to_index(
            [_record(1024, database_name="prod", document_type="Term",
                     content="revenue by region", label="Term", seed=1)]
        )
        vdb.retrieval([_embedding(1024, 1)], top_k=5, where={"label": ["Term", "Column"]})
        sent = cf.vector_indexes._by_name["semantic_layer"].queries[-1]["filter"]
        assert sent == {"label": {"in": ["Term", "Column"]}}


def test_hit_shape_matches_pgvector_contract():
    cf = _FakeCloudflare()
    with _patch_client(cf):
        vdb = _vdb(cf)
        vdb.create_index()
        vdb.write_to_index(
            [_record(1024, database_name="prod", document_type="Term",
                     content="revenue by region", label="Term", seed=1)]
        )
        hits = vdb.retrieval([_embedding(1024, 1)], top_k=1)[0]
        assert len(hits) == 1
        hit = hits[0]
        assert set(hit.keys()) == {"text", "metadata", "_distance"}
        assert hit["text"] == "revenue by region"
        assert isinstance(hit["_distance"], float)


def test_retriever_forwards_where_to_vectorize():
    # Retriever embeds the query then forwards vdb_kwargs["where"] to the store.
    cf = _FakeCloudflare()
    fixed_vector = _embedding(1024, 7)

    def fake_embed(texts, *args, **kwargs):
        return [fixed_vector for _ in texts]

    with mock.patch("auto_ontology.utils.retriever.embed_texts", fake_embed):
        with _patch_client(cf):
            vdb = _vdb(cf)
            vdb.create_index()
            vdb.write_to_index(
                [_record(1024, database_name="prod", document_type="Term",
                         content="revenue by region", label="Term", seed=1)]
            )
            params = EmbedParams(
                embed_invoke_url="http://unused", model_name="m", api_key="k"
            )
            rev = Retriever(vdb, params)
            hits = rev.query(
                "revenue by region", top_k=1, vdb_kwargs={"where": {"database_name": "prod"}}
            )
            assert len(hits) == 1
            assert hits[0]["text"] == "revenue by region"
            sent = cf.vector_indexes._by_name["semantic_layer"].queries[-1]["filter"]
            assert sent == {"database_name": {"eq": "prod"}}


# ---------------------------------------------------------------------------
# Task 13 -- Vectorize retrieval matches a brute-force cosine oracle
# ---------------------------------------------------------------------------


def _brute_force_top1(docs: list[list[float]], query: list[float]) -> int:
    best_i, best_s = 0, None
    for i, d in enumerate(docs):
        s = _cos_sim(query, d)
        if s is None:
            continue
        if best_s is None or s > best_s:
            best_s, best_i = s, i
    return best_i


def test_recall_matches_brute_force_oracle():
    # Synthetic corpus where each query is a noisy copy of one doc; the true
    # nearest neighbor is known. VectorizeVDB (fake client) must recover the
    # same top-1 as an independent brute-force cosine oracle -> recall
    # preserved through the Vectorize path.
    dim = 256
    n_docs = 12
    rng = random.Random(1234)
    docs = [[rng.gauss(0, 1) for _ in range(dim)] for _ in range(n_docs)]

    cf = _FakeCloudflare()
    with _patch_client(cf):
        vdb = _vdb(cf, dimension=dim)
        vdb.create_index()
        recs = [
            _record(dim, database_name="prod", document_type="Term",
                    content=f"doc {i}", label="Term", seed=1000 + i)
            for i in range(n_docs)
        ]
        for i, rec in enumerate(recs):
            rec["metadata"]["embedding"] = docs[i]  # known corpus vectors
        vdb.write_to_index(recs)

        for i in range(n_docs):
            query = [d + rng.gauss(0, 0.15) for d in docs[i]]
            vz_hits = vdb.retrieval([query], top_k=1)[0]
            assert vz_hits[0]["text"] == f"doc {i}"
            assert _brute_force_top1(docs, query) == i


def _run():
    tests = [
        test_write_retrieval_roundtrip,
        test_catalog_id_is_stable_across_reembeds,
        test_delete_by_database_removes_only_that_database,
        test_metadata_filter_format_is_dict,
        test_where_is_forwarded_as_vectorize_filter,
        test_list_where_becomes_vectorize_in,
        test_hit_shape_matches_pgvector_contract,
        test_retriever_forwards_where_to_vectorize,
        test_recall_matches_brute_force_oracle,
    ]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    _run()
