# Findings — Cloudflare Rewrite

## Phase 0 — Decisions & procurement
- Aurora available; Container + DO recommended; sleepAfter override + Hyperdrive max_age strategy set.
- **BLOCKED:** Vectorize max 1,536 dims vs 2,048 embed. Cosine supported. No compatible strategy selected yet.

## Phase 1 — Storage layer
- `vdb/base.py`, `vdb/vectorize.py`, `vdb/postgres.py`, `vdb/__init__.py`, `infra/aurora.py`, `infra/postgres.py`, `vdb/tests/test_backend_abstraction.py` — committed.
- `get_vdb()` switches PostgresVDB ↔ VectorizeVDB via `AUTO_ONTOLOGY_VDB_BACKEND` (default postgres).
- Containment satisfied by existing parent-FK + ON DELETE CASCADE schema; no porting needed.

## Phase 2 — Catalog graph migration
- Task 8 DONE: `auto_ontology/dal/schema.py` is SQLAlchemy Core, `catalog_` prefix, text uuid ids, parent-FK containment.
- Task 9 interface DONE: `Retriever` and `dal/reset.py` build stores via `get_data_vdb()`/`get_semantic_vdb()`; `SemanticEmbedder` bound to `get_semantic_vdb()`; `compile_semantic_layer` calls `embedder.vdb.create_index()`.
- Tasks 11–13 remaining; blocked on task 4.

## Phase 3 — Agent runtime
- `workers/src/agent-gateway.ts`: authenticates frontend-server requests via `CLOUDFLARE_AGENT_SECRET`, routes by trusted user ID to `AgentDo`.
- `workers/src/agent-do.ts`: per-user DO starts Python Container, streams responses without buffering.
- `workers/src/auth.ts`: identity + gateway-auth contract; `INTERNAL_USER_HEADER`, `GATEWAY_SECRET_HEADER`.
- `workers/wrangler.toml`: `auto-ontology-agent-gateway`, `AgentDo` class, `durable_object` scheduling policy, `../Dockerfile`, `CONTAINER_INSTANCE_TYPE=standard-1`, `AGENT_PORT=3001`, `CONTAINER_ENABLE_INTERNET=true`.
- Deployed validation OPEN.

## Phase 4 — Frontend (vinext)
- `frontend/vite.config.ts`: vinext RSC+SSR build, Cloudflare plugin, KV cache adapter, images optimizer, SVGR, alias `@/lib/prisma` → `./lib/prisma-worker.ts`.
- `frontend/cloudflare.config.ts`: Worker `auto-ontology`, entrypoint `vinext/server/fetch-handler`, `compatibilityDate: 2026-11-11`, `nodejs_compat`, assets + `VINEXT_KV_CACHE`/`IMAGES`/`AUTH_SECRET`/`APP_URL`/`HYPERDRIVE`/`AGENT_GATEWAY_URL`/`CLOUDFLARE_AGENT_SECRET` bindings.
- `frontend/lib/prisma-worker.ts`: `getPrisma()` creates PrismaClient via `PrismaPg` adapter with `schema: 'frontend'`, using `HYPERDRIVE.connectionString` from `cloudflare:workers` env.
- `frontend/lib/prisma.ts`: local Prisma client (Postgres, `frontend` schema).
- `frontend/lib/containerProxy.ts`: `forwardToContainer()` resolves `AGENT_GATEWAY_URL` (required on Workers; local default `127.0.0.1:3001`); `SSE_RESPONSE_HEADERS` centralized.
- `frontend/auth/better-auth-core.ts`: shared Better Auth config (Prisma adapter, admin/sso/apiKey/mcp plugins).
- `frontend/auth/auth.ts`: `getAuth()` → `createAuth(getPrisma())`.
- `frontend/app/api/chat/completions/route.ts`: forwards to gateway via `forwardToContainer`; SSE headers centralized.
- `frontend/app/api/health/route.ts`: liveness probe (Postgres check).
- 13 routes touch `prisma.` directly: acronyms, analytics, conversations, custom-prompts, configurations/*, health, sso-providers.
- Verified: `tsc --noEmit` and `vite build` (`build:vinext`) exit 0.
- Deployed verification OPEN.

## Phase 5 — Ingestion
- Not started. `IntervalScheduler` daemons → Cron → Worker → Queue → Container bridge.

## Phase 6 — Verify & cut over
- Not started.

## Phase 7 — Deployment
- Not started. Provisioning consolidated here.
