# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Offline tests for the VDB backend abstraction.

These exercise the pure logic that the pgvector -> Vectorize migration hinges
on, without a live database or the Cloudflare SDK:

* record extraction matches the old PostgresVDB write path,
* filter conversion to Vectorize syntax,
* deterministic id derivation,
* the asyncpg SSL translation, and
* Aurora-vs-local connection routing.

Run directly (``python auto_ontology/vdb/tests/test_backend_abstraction.py``)
or under pytest.
"""

from __future__ import annotations

import os
import sys

_REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
sys.path.insert(0, _REPO_ROOT)

from auto_ontology.vdb.base import _extract  # noqa: E402
from auto_ontology.vdb.vectorize import _id_for, _to_filter  # noqa: E402
from auto_ontology.vdb.postgres import _to_async_url  # noqa: E402
from auto_ontology.infra.postgres import get_postgres_connection_string  # noqa: E402


def _record(**overrides):
    base = {
        "document_type": "CustomAnalysis",
        "text": "revenue by region",
        "metadata": {
            "embedding": [0.1, 0.2, 0.3],
            "id": "term-1",
            "database_name": "prod",
            "label": "CustomAnalysis",
            "content": "revenue by region",
        },
    }
    base.update(overrides)
    return base


def test_extract_skips_records_without_embedding():
    assert _extract(_record(metadata={})) is None
    assert _extract(_record(metadata={"embedding": []})) is None


def test_extract_shape_matches_postgres_path():
    text, meta, emb = _extract(_record())
    assert text == "revenue by region"
    assert emb == [0.1, 0.2, 0.3]
    # document_type is promoted; embedding is dropped from stored metadata.
    assert meta["document_type"] == "CustomAnalysis"
    assert "embedding" not in meta
    assert meta["database_name"] == "prod"
    assert meta["id"] == "term-1"


def test_extract_text_falls_back_in_order():
    # No top-level text/content; only metadata.content.
    rec = _record(text=None, content=None, metadata={"embedding": [1.0], "content": "only meta"})
    text, _, _ = _extract(rec)
    assert text == "only meta"


def test_filter_conversion():
    assert _to_filter(None) is None
    assert _to_filter({"database_name": "prod"}) == {"database_name": {"eq": "prod"}}
    assert _to_filter({"label": ["A", "B"]}) == {"label": {"in": ["A", "B"]}}
    # Mixed.
    assert _to_filter({"database_name": "prod", "label": ["A"]}) == {
        "database_name": {"eq": "prod"},
        "label": {"in": ["A"]},
    }


def test_id_is_deterministic_and_stable():
    a = _id_for({"database_name": "prod", "document_type": "x", "content": "c"})
    b = _id_for({"database_name": "prod", "document_type": "x", "content": "c"})
    c = _id_for({"database_name": "dev", "document_type": "x", "content": "c"})
    assert a == b  # same fields -> same id (stable across runs)
    assert a != c  # different database_name -> different id
    assert a.startswith("vz-")


def test_async_url_ssl_translation():
    # sslmode (psycopg2) becomes ssl (asyncpg); sslrootcert is preserved.
    url = "postgresql://u:p@host:5432/db?sslmode=require&sslrootcert=/cert.pem"
    out = _to_async_url(url)
    assert out.startswith("postgresql+asyncpg://")
    assert "ssl=require" in out
    assert "sslrootcert=/cert.pem" in out
    assert "sslmode" not in out
    # A non-asyncpg URL without ssl passes through cleanly.
    assert _to_async_url("postgresql://u:p@host:5432/db") == "postgresql+asyncpg://u:p@host:5432/db"


def test_connection_string_prefers_aurora():
    # Local path unchanged when AURORA_HOST is unset.
    os.environ.pop("AURORA_HOST", None)
    local = get_postgres_connection_string()
    assert local == "postgresql://u:p@localhost:5432/auto_ontology"
    assert "sslmode" not in local

    # Aurora path rolls in TLS and the Aurora host.
    os.environ["AURORA_HOST"] = "cluster-abc.us-east-1.rds.amazonaws.com"
    aurora = get_postgres_connection_string()
    assert aurora.startswith("postgresql://u:p@cluster-abc.us-east-1.rds.amazonaws.com:5432/auto_ontology?")
    assert "sslmode=require" in aurora


def _install_env():
    saved = {}
    for k in (
        "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER",
        "POSTGRES_PASSWORD", "POSTGRES_DATABASE", "AURORA_HOST",
    ):
        saved[k] = os.environ.get(k)
    os.environ["POSTGRES_HOST"] = "localhost"
    os.environ["POSTGRES_PORT"] = "5432"
    os.environ["POSTGRES_USER"] = "u"
    os.environ["POSTGRES_PASSWORD"] = "p"
    os.environ["POSTGRES_DATABASE"] = "auto_ontology"
    os.environ.pop("AURORA_HOST", None)
    return saved


def _restore_env(saved):
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def _run():
    saved = _install_env()
    try:
        tests = [
            test_extract_skips_records_without_embedding,
            test_extract_shape_matches_postgres_path,
            test_extract_text_falls_back_in_order,
            test_filter_conversion,
            test_id_is_deterministic_and_stable,
            test_async_url_ssl_translation,
            test_connection_string_prefers_aurora,
        ]
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} passed")
    finally:
        _restore_env(saved)


if __name__ == "__main__":
    _run()
