# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Aurora (managed Postgres) connection config for the Cloudflare-native path.

The backend, ingestion service, and VDB all reach the semantic catalog on one
managed Postgres. Locally that is a plain ``POSTGRES_*`` host; on Cloudflare it
is an Aurora endpoint reached over TLS. This module builds one TLS-enrolled URL
from ``AURORA_*`` env vars (falling back to ``POSTGRES_*``), so the whole stack
points at Aurora simply by setting ``AURORA_HOST``.

No secrets are assembled here beyond what the caller injects via env: set
``AURORA_USER`` / ``AURORA_PASSWORD`` through Cloudflare Secrets (Containers) or
the runtime env -- never in code.
"""

from __future__ import annotations

import os

#: Aurora/RDS ship a global cert bundle; set this to use verify-ca / verify-full
#: instead of the unverified ``sslmode=require``. e.g. a mounted
#: ``rds-ca-global.pem``.
RDS_CA_BUNDLE_ENV = "AURORA_SSL_ROOT_CERT"


def aurora_connection_string() -> str:
    """Build a TLS-enrolled Aurora URL from ``AURORA_*`` (fallback ``POSTGRES_*``)."""
    host = os.environ.get("AURORA_HOST") or os.environ.get("POSTGRES_HOST", "localhost")
    port = os.environ.get("AURORA_PORT") or os.environ.get("POSTGRES_PORT", "5432")
    user = os.environ.get("AURORA_USER") or os.environ["POSTGRES_USER"]
    password = os.environ.get("AURORA_PASSWORD") or os.environ["POSTGRES_PASSWORD"]
    db = os.environ.get("AURORA_DATABASE") or os.environ.get("POSTGRES_DATABASE", "auto_ontology")

    url = f"postgresql://{user}:{password}@{host}:{port}/{db}"

    # Aurora/RDS require TLS. ``sslmode`` is understood by psycopg2 (the sync
    # driver used by the DAL and the VDB admin ops). The asyncpg read path
    # (PGEngine) takes ``ssl`` instead -- see ``auto_ontology.vdb.postgres``
    # which translates this for that path.
    query = "sslmode=require"
    root_cert = os.environ.get(RDS_CA_BUNDLE_ENV)
    if root_cert:
        query += f"&sslrootcert={root_cert}"

    return f"{url}?{query}"


def is_aurora() -> bool:
    """True when the stack is pointed at managed Postgres (Aurora)."""
    return bool(os.environ.get("AURORA_HOST"))
