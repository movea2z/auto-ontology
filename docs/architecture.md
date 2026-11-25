<!--
SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Architecture

Auto-Ontology combines source catalog ingestion, semantic modeling, vector retrieval, and a text-to-SQL agent. Production architecture is the Python/PostgreSQL + pgvector + Next.js stack described below. `workers/` contains a Cloudflare gateway/vector-store prototype, not an alternate production deployment; see [Cloudflare rewrite plan](../CLOUDFLARE-REWRITE-PLAN.md) for its unresolved cutover blockers.

For setup and deployment, use [DEPLOYMENT.md](../DEPLOYMENT.md). This guide describes component boundaries, not installation steps or endpoint schemas. See [conversation API](./conversation-api.md), [authentication](./authentication.md), [MCP](./mcp.md), and [OpenAPI specs](./openapi/auto-ontology-api.json) for those details.

## Components

- **Next.js frontend (`frontend/`)** serves UI, Better Auth authentication, authorization, and public `/api/...` routes. Route handlers validate permissions and proxy trusted identity to backend operations.
- **FastAPI backend (`auto_ontology/server/`)** provides catalog, semantic, configuration, and chat operations. Routers delegate to service and data-access layers; chat execution uses a worker subprocess and LangGraph text-to-SQL workflow.
- **Ingestion service (`auto_ontology/ingestion_service/`)** runs source extraction and scheduled/background work separately from request-serving API. Connectors and catalog extraction live in `connectors/` and `catalog/`.
- **Catalog and semantic layers (`auto_ontology/dal/`, `semantic/`)** model database/schema/table/column metadata, relationships, terms, attributes, and access-scoping data in PostgreSQL.
- **Vector retrieval (`auto_ontology/vdb/`, `retrieval/`)** indexes data and semantic-layer text for search. PostgreSQL with pgvector is current default; shared backend interface also has experimental Cloudflare Vectorize implementation.
- **MCP server (`mcp/`)** is separately packaged. It calls the authenticated frontend API over HTTP; it is read-only by design. Use REST surface for writes.

## Data flow

1. Ingestion connects to configured data sources and extracts catalog metadata and, where enabled, query-derived relationships.
2. Catalog writes persist relational graph in PostgreSQL. Semantic compilation links business terms and attributes to catalog entities and produces semantic search records.
3. Embeddings are written to the data and semantic vector indexes. Ingestion and query-time embedding configurations must match; changing embedding model/space requires re-indexing.
4. User asks question through frontend `/api/chat/completions` or MCP `ask_question`. Authenticated frontend calls pass request to FastAPI.
5. LangGraph uses catalog/semantic retrieval to ground question, generates and validates SQL, executes it against configured data source, then streams progress and answer. Conversation lifecycle and event format documented in [conversation API](./conversation-api.md).

## Storage ownership

Vector index stores embeddings for retrieval; PostgreSQL remains source of truth for catalog/semantic relational records. Source database access has an important configuration boundary: ingestion prefers `CONNECTION_STRINGS` whenever set, while query-time execution prefers UI-managed connections whenever any exist. Use one connection source per deployment to avoid catalog/query disagreement; details and credential storage are in [connections guide](./connections.md). Conversation history is scoped to authenticated user; see [authentication](./authentication.md).

- `public` holds backend catalog, semantic graph, and service bookkeeping. SQLAlchemy Core schema in `auto_ontology/dal/schema.py`, migrated by Alembic.
- `frontend` holds Better Auth identity/session/token records and frontend-owned conversations, messages, configuration, and analytics. Defined by `frontend/prisma/schema.prisma`, managed by Prisma.

Keep schema ownership separate: Alembic migrations own `public`; Prisma owns `frontend`. Ingestion may read frontend configuration records for background-job gates, but that does not transfer schema ownership. See [Docker Compose topology and migration ordering](../docker-compose.yml) and [deployment guide](../DEPLOYMENT.md).

Source databases remain external systems accessed by configured connectors.

## Trust boundaries

- Browser, API-token client, and MCP client are untrusted callers. Public API authentication and authorization happen at Next.js gateway.
- Frontend forwards trusted user identity to FastAPI via internal `x-auto-ontology-user-id`. Backend trusts this header; backend and ingestion ports must remain private and unreachable by untrusted clients. Do not expose backend port or call it as public API. MCP targets frontend API, not backend directly.
- Backend and ingestion service hold database/source/model credentials. Protect service network, secrets, and PostgreSQL accordingly. SQL generated by agent is validated before execution; database credentials and source permissions still determine its effective access.
- Model endpoints and configured data sources are external dependencies. Questions, retrieved metadata, and prompts may be sent to configured model providers; assess provider access and data-handling requirements for deployment.

## Streaming and runtime dependencies

Chat response is streamed as server-sent events through Next.js to caller; clients should consume incrementally and preserve connection/cancellation lifecycle rather than buffer full response. Agent execution makes multiple sequential model calls and can take tens of seconds. Conversation locking rejects overlapping turns on same conversation. Exact events and client behavior: [conversation API](./conversation-api.md).

Operational dependencies include PostgreSQL (with pgvector in current vector configuration), reachable source databases, configured chat/embedding/reranking model endpoints and credentials, and frontend-to-backend/ingestion networking. Backend and ingestion services require database migrations before serving work; Docker Compose defines migration jobs and health/readiness dependencies. Deployment-specific configuration, secret handling, probes, and scaling belong in [DEPLOYMENT.md](../DEPLOYMENT.md), not duplicated here.

## Cloudflare prototype is distinct

Cloudflare-related code is experimental and does not replace production topology. In particular, `auto_ontology/vdb/vectorize.py` and `workers/provision-vectorize.sh` cover a Vectorize backend/provisioning path; they do not establish full-stack Cloudflare production deployment. Current embedding vectors are 2,048 dimensions, while Vectorize limit cited by prototype is 1,536. Prototype also lacks live API/deletion validation and retrieval-recall qualification. Keep pgvector as production vector store unless blockers in [rewrite plan](../CLOUDFLARE-REWRITE-PLAN.md) are resolved and cutover validated.