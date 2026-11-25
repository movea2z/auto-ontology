<!--
SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Repository Guidelines

## Project Overview

Auto-Ontology builds a semantic layer over enterprise data for agent-assisted
discovery and text-to-SQL. The Python backend, Next.js frontend, and read-only
MCP server are separate components; see `README.md` for product and setup details.

Repository skills in `skills/` guide installation and use of the ontology layer.
Keep workflow guidance in those skills, not duplicate API catalogs or installers.

## Architecture & Data Flow

Connectors extract source metadata; catalog ingestion stores it in PostgreSQL.
Semantic compilation builds the ontology and search embeddings; retrieval and
the LangGraph text-to-SQL workflow use those layers to answer questions.
The Next.js frontend provides the UI, authentication, and `/api/...` surface;
FastAPI serves backend operations, while the separate MCP server calls the
application over HTTP.

Keep FastAPI and ingestion endpoints private: frontend authentication establishes
identity before forwarding trusted user headers. MCP targets the frontend API,
not the unauthenticated backend port. Use the same embedding model and endpoint
for ingestion and retrieval; changing embedding space requires re-indexing.

## Code Conventions & Common Patterns

- Keep FastAPI routers thin; follow adjacent `router.py` / `service.py` / DAL
  boundaries. Define persistent backend tables in SQLAlchemy Core and migrate
  with Alembic; do not bypass existing transaction and session helpers.
- Frontend route handlers use `withPublic` or `withPermission` from
  `frontend/auth/with-auth.ts`; preserve authorization when changing routes.
- Use typed models and existing async/streaming interfaces where applicable;
  avoid buffering streaming chat responses. Follow nearby error handling and
  return explicit failures instead of inventing successful fallbacks.
- Chat uses a worker subprocess and LangGraph text-to-SQL state; preserve
  existing cancellation and streaming lifecycles. Pass dependencies explicitly,
  following neighboring code.
- Add SPDX headers to new source files, matching adjacent files.

## Key Directories

- `auto_ontology/server/`: FastAPI routes, services, chat, and identity.
- `auto_ontology/connectors/`, `catalog/`, `ingestion_service/`: source
  connectors, catalog extraction, and scheduled ingestion.
- `auto_ontology/dal/`, `semantic/`, `vdb/`, `retrieval/`: persistence,
  semantic compilation, vector search, and text-to-SQL workflows.
- `frontend/`: Next.js App Router, UI, API handlers, authentication, and Prisma.
- `mcp/`: independently packaged HTTP client and MCP server.
- `alembic/`, `dev_tools/`, `helm/`, `docs/`: migrations, development/fixtures,
  Kubernetes deployment, and API documentation.
- `workers/`: Cloudflare gateway prototype; see `CLOUDFLARE-REWRITE-PLAN.md`
  for open migration blockers, rather than assuming production readiness.

## Important Files

- `auto_ontology/server/__main__.py`: FastAPI application factory.
- `auto_ontology/dal/schema.py`, `alembic/versions/`: backend schema and migrations.
- `frontend/prisma/schema.prisma`: frontend schema.
- `frontend/auth/with-auth.ts`: API route authorization wrappers.
- `mcp/auto_ontology_mcp/tools.py`: read-only MCP tool registration.
- `.env.example`, `docker-compose.yml`, `DEPLOYMENT.md`: configuration and setup.

## Development Commands

```bash
uv sync
(cd frontend && pnpm install)
./dev_tools/setup_env.sh --dev               # infrastructure only
# Run each server in a separate terminal:
uv run python -m auto_ontology.server         # backend, port 3001
(cd frontend && pnpm dev)                    # frontend, port 3000; pushes Prisma schema
# Run checks from the repository root:
uv run pytest auto_ontology dev_tools -q
uv run ruff check .
(cd frontend && pnpm lint && pnpm format:check)
(cd mcp && uv run pytest)
```

For reload, use `uv run uvicorn auto_ontology.server.__main__:create_app --factory
--reload --host 127.0.0.1 --port 3001`. See `dev_tools/README.md` for fixture
seeding and Compose modes. `make migrate`, `make migrate-check`, and `make
migrate-revision m="description"` operate on backend Alembic migrations.

## Runtime/Tooling Preferences

- Backend requires Python 3.12–3.13; use `uv` and the root `uv.lock`. MCP is a
  separate project requiring Python 3.11+ and has its own lockfile.
- Frontend uses Node.js and `pnpm@10.34.3`; use `frontend/pnpm-lock.yaml`.
  `pnpm dev` runs `prisma db push`, so point it only at a suitable database.
- Python Ruff uses 88 columns and selected rules in `pyproject.toml`. Frontend
  Prettier uses tabs, single quotes, semicolons, trailing commas, and 100 columns.
  Run `cd frontend && npx prettier --write <changed-files>` after frontend edits.

## Testing & QA

- Root pytest excludes `mcp/`; run MCP tests independently from `mcp/`.
  CI uses pgvector-enabled PostgreSQL, Alembic migrations, and fixture databases;
  follow `dev_tools/README.md` for seeding. MCP tests use mocked HTTP.
- No coverage threshold is configured. Backend CI checks skipped tests; frontend
  CI runs format, lint, and build. Run focused tests for changed behavior.
- Backend and frontend schemas have separate migration paths: Alembic owns
  backend tables in `public`, while Prisma owns tables in `frontend`. Keep schema
  changes and migrations aligned.

## Which skill to read

- [`skills/nvidia-ontology-setup/`](./skills/nvidia-ontology-setup/) — Helm (the official
  install), local Compose, developer `--dev` / `--ds`, MCP against an
  already-running instance, and troubleshooting. Start here when Auto-Ontology is not up yet or something failed
  during bring-up.
- [`skills/nvidia-ontology-management/`](./skills/nvidia-ontology-management/) — inspect, model,
  **modify**, and safely publish through glossary terms, SQL attributes,
  semantic relationships, model YAML import/export, and governed result
  definitions. MCP cannot write; this skill covers the approved write paths.
- [`skills/nvidia-ontology-query/`](./skills/nvidia-ontology-query/) — how an
  agent calls Auto-Ontology (MCP first, REST fallback), discovers meaning through the
  semantic layer, and validates SQL, rows, and answers. Start here when Auto-Ontology is
  already deployed.

## Workflow ownership and handoffs

| User action | Owning skill |
| --- | --- |
| Install, configure, connect, ingest, compile, prove readiness | `nvidia-ontology-setup` |
| Inspect meaning and semantic relationships | `nvidia-ontology-management` |
| Design concepts, mappings, relationships, measures, units, grain, and policies | `nvidia-ontology-management` → `references/modeling.md` |
| Apply, verify, certify honestly, publish, and roll back | `nvidia-ontology-management` → `references/publication.md` |
| Ask descriptive or diagnostic questions and validate SQL, rows, and prose | `nvidia-ontology-query` → `references/query-validation.md` |

The composed lifecycle is install/connect/readiness → inspect/model → staged
apply/readback → query validation → governed publication → fresh query readback.
A step that lacks product support must return an explicit gap or receipt rather
than inventing an operation. Authentication, permissions, provenance, and error
handling remain shared concerns rather than separate overlapping skills.

## Sources of truth (do not duplicate)

Skills encode **workflow, order, and pitfalls**. They must not become a second
API catalog or a second installer.

| Job | Owner | Skills do |
| --- | --- | --- |
| Install commands | `DEPLOYMENT.md` (Helm, official), `docker-compose.yml`; `dev_tools/setup_env.sh` for developer workflows | Invoke them; do not write a new installer |
| Live read tools | `mcp/auto_ontology_mcp/tools.py` (handshake tool list) | Prefer MCP; sequence reads; never copy the tool table |
| REST shapes and permissions | `docs/openapi/auto-ontology-api.json` | Name the operation and permission; link; do not paste schemas |

MCP is read-only by design. Writes go through the Next.js `/api/...` surface.
The live MCP tool list at handshake is the source of truth if it disagrees
with anything in a skill.

## Catalog mirror

These directories sync to
[github.com/nvidia/skills](https://github.com/nvidia/skills) (`npx skills add nvidia/skills`)
and build.nvidia.com/skills. That pipeline requires, per skill:

- `SKILL.md`, `skill-card.md`, `evals/evals.json` (maintained here)
- `BENCHMARK.md` and `skill.oms.sig` — generated by NVSkills CI. A maintainer
  comments `/nvskills-ci` on any pull request that changes `skills/`; the
  `nv-skills-ci[bot]` pushes an "Attach NVSkills validation signatures" commit
  that must stay in the PR. Never hand-edit or fabricate these files, and rerun
  NVSkills CI after any later change to a skill in the same PR.
- the `components.d/auto-ontology.yml` entry in **nvidia/skills** registering:

```yaml
name: Auto-Ontology
repo: NVIDIA/auto-ontology
description: Set up Auto-Ontology, model and publish its semantic layer, and run validated text-to-SQL queries through it.
skills:
  - path: skills/nvidia-ontology-setup/
    catalog_dir: nvidia-ontology-setup
  - path: skills/nvidia-ontology-management/
    catalog_dir: nvidia-ontology-management
  - path: skills/nvidia-ontology-query/
    catalog_dir: nvidia-ontology-query
```

Skills must stay free of staging hostnames, cluster names, Vault paths, and
credentials — the catalog is public even when Auto-Ontology itself is
access-restricted.
