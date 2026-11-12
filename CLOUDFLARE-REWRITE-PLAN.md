# Auto-Ontology — Cloudflare-Native Rewrite Plan

> Status: **Compute can run on Cloudflare (Containers); the only external dependency is managed PostgreSQL.**
> Generated from an analysis of the current Python/Postgres + pgvector + Next.js stack.

## 0. Verdict

The original "cannot deploy on Cloudflare" verdict was based on a Workers-only assumption.
Cloudflare **Containers** now run arbitrary Docker images with a full Linux environment, system
libraries, and configurable CPU/memory — so the Python FastAPI backend, the LangGraph agent, the
ingestion service, and its native database connectors can all run natively. The single unavoidable
external piece is **managed PostgreSQL** (Cloudflare has no managed pgvector Postgres).

**External (one thing only):** Managed PostgreSQL (Aurora/Neon/Supabase/Crunchy) for the relational
semantic-catalog graph, reached from Workers via **Hyperdrive** and directly from Containers via
`psycopg`.

**Everything else runs on Cloudflare:** frontend (Pages+Functions), backend + agent (Containers),
vector search (Vectorize), blobs (R2), sessions/caches (D1/KV), ingestion orchestration (Cron +
Queues), edge auth (Workers + Turnstile).

---

## 1. Runtime map

| Concern | Traditional constraint | Cloudflare setup |
| --- | --- | --- |
| Edge API & Auth | Needs global distribution | Workers + Turnstile + KV |
| Agent Runtime | Long-running sync LangGraph loop | **Containers (Python)** bound to **Durable Objects** |
| Catalog Graph | Heavy joins/cascades unsuitable for D1 | **Managed Postgres via Hyperdrive**; `ltree` / `WITH RECURSIVE` |
| Semantic Search | High-dim similarity queries | **Vectorize** (embeddings keyed to Postgres IDs) |
| Ingestion Engine | Native drivers, continuous daemons | **Cron → Queue → Container** (stateless batch pollers) |
| Unstructured Assets | High egress on external buckets | **R2** |
| Sessions / caches / rate limits | — | **D1 / KV** |

### LangGraph runtime: Containers, NOT Workers Python

The agent runs in a **Cloudflare Container** (own Docker image), never on the
**Workers Python runtime**. These are different runtimes and the distinction is
load-bearing for LangGraph:

- The Workers Python page
  (`/workers/languages/python/packages/langchain/`) lists only three built-in
  LangChain packages: `langchain 0.1.8`, `langchain-core 0.1.25`,
  `langchain-openai 0.0.6`. **`langgraph` is not provided at all**, and the
  provided `langchain-core` (0.1.25) is ~5 major versions older than this app
  needs.
- The app pins `langgraph>=1.2.11`, `langchain-core>=1.6.1`,
  `langchain-openai>=1.3.0` (root `pyproject.toml`). That cannot run on the
  Workers Python runtime: the built-in framework is far too old and LangGraph
  has no built-in to vendor against.
- In a **Container** you `pip install` the same pins the app already declares —
  LangGraph runs unchanged. The Workers package list is irrelevant there.

**Conclusion:** host the agent in a Container. If anyone proposes running it on
Workers Python to cut cost, LangGraph (plus the 0.1.25 vs ≥1.6.1 gap) is the
concrete blocker — the alternatives are risky vendoring or a full TypeScript
rewrite (Workflows / Agents SDK).

**State:** LangGraph checkpointers need a store. Use the external managed
Postgres (Aurora) for graph state, or Durable Object storage for light
checkpoints — never container memory, since Containers restart.

---

## 2. Verified constraints & caveats (from Cloudflare docs)

1. **Containers have no fixed max runtime** — long synchronous agent runs are allowed.
   - BUT the `Container` class sets `sleepAfter` = **10 minutes** by default and stops the container
     after 10 min of inactivity (`setInactivityTimeout()` / override `sleepAfter`). **Override this
     for human-in-the-loop or multi-turn sessions that pause longer.**
   - A host restart can stop an active container at any time with no guarantee. **All agent/graph
     state must live in external Postgres**, never in container memory.
2. **Containers are invoked through a Worker via HTTP**: `env.MY_CONTAINER.getByName(path).fetch(req)`.
   So a Queue→Container path needs a **Worker bridge**; there is no direct queue-consumer container.
3. **Hyperdrive read-after-write staleness**: Hyperdrive does **not** invalidate cached reads on
   writes — a matching `SELECT` can return cached results until `max_age` expires. Writes still go to
   the DB. The semantic catalog is write-heavy, so use a **short `max_age`** or bypass the cache on
   write-sensitive reads.
4. **Vectorize has no `halfvec` and limited metrics** (cosine/euclidean). The current store uses
   **2048-dim** vectors — verify dimension + metric fit before committing.
5. **Pure-Workers agent alternative** (Workflows / Agents SDK / `@cloudflare/ai-chat`) is TypeScript —
   choosing it means re-implementing the LangGraph state machine in TS and dropping Python.
   **Container+DO keeps the existing Python agent** and is the lower-effort path.

---

## 3. Target architecture

```
Client (WebSocket / SSE)
   │
   ▼
Cloudflare Worker (Gateway / Auth / Turnstile)
   │
   ├──► Durable Object (session / state coordinator; proxies WS/SSE)
   │        │ lifecycle & proxy
   │        ▼
   │    Cloudflare Container (Python + FastAPI + LangGraph)   [override sleepAfter for HITL]
   │        │
   │        ├──► Workers AI  OR  OpenAI/Kumo (embeddings + LLM)
   │        ├──► Vectorize (semantic_layer, data_objects_layer)  ← keyed to Postgres IDs
   │        ├──► R2 (PDFs / raw assets)
   │        └──► Managed Postgres (Aurora)  ← catalog graph, ltree containment
   │
   └──► Hyperdrive  ──► Managed Postgres (edge-pooled reads, cached)

Ingestion:
  Cron Trigger ──► Worker (scheduler) ──► Queue ──► Container bridge ──► Container (Python ETL)
                                                    │
                                                    ├──► R2 (raw data)
                                                    ├──► Vectorize (vectors)
                                                    └──► Postgres via Hyperdrive (metadata)
```

---

## 4. Ordered task list

### Phase 0 — Decisions & procurement
1. Procure the one external dependency: **managed PostgreSQL** (Aurora — already available).
2. Lock agent-runtime decision: **Container + DO** (keeps Python LangGraph) — recommended.
3. Decide container lifecycle policy: override `sleepAfter` for HITL; set `max_age` strategy for
   Hyperdrive on write-sensitive catalog reads.
4. Confirm Vectorize dim/metric fit for the 2048-dim embeddings.

### Phase 1 — Storage layer
Storage wiring is prototype-complete (see §5a): `vdb/base.py`, `vdb/vectorize.py`, `vdb/postgres.py`,
`vdb/__init__.py`, `infra/aurora.py`, and tests — all committed. Remaining design task:
6. Model containment natively: migrate parent-FK hierarchy to **`ltree`** or **`WITH RECURSIVE`**,
   preserving cascade semantics. (Already satisfied by the existing parent-FK + `ON DELETE CASCADE`
   schema in `dal/schema.py`; no porting needed.)

Provisioning of the Cloudflare storage resources is a deployment action — consolidated in
**Phase 7** (§4 Phase 7): Hyperdrive (task 5), Vectorize/R2/D1-KV (task 7).

### Phase 2 — Catalog graph migration

> **Reassessed 2026-08.** Under the Container + managed-Postgres architecture (committed in
> H1/H2), this phase is ~90% already done — the schema and vdb switch run on Postgres unchanged.
> The original tasks 8-9 were written for a D1/Workers target; no D1 exists anywhere in the
> catalog/DAL path (the only "D1" hits are a step name `D11` and phase `ROUND1`). What remains is
> mostly Cloudflare-side provisioning + validation, not schema porting.

**Task 8 — SQLAlchemy Core schema + Alembic on Postgres (`catalog_` naming, text-uuid ids,
recursive containment). Status: DONE, no work needed.**

`auto_ontology/dal/schema.py` already is exactly this: SQLAlchemy Core `METADATA`, `catalog_`
prefix, `text` uuid ids (`gen_random_uuid()::text`), containment = **parent foreign key with
`ON DELETE CASCADE`** (Database → Schema → Table → Column), recursive containment reached by the
four-table join `_catalog_join()`. Migrations run via `alembic upgrade head` (the `migrate`
container mode; `alembic/` + `alembic.ini` are baked into the image; `dal/schema_version.py`
guards an un-migrated DB). Nothing to port.

**Task 9 — vdb provider interface + re-embed collections. Status: interface DONE (H1); re-embed
is already wired, not a new job.**

`vdb/__init__.get_vdb()` switches `PostgresVDB` ↔ `VectorizeVDB` via
`AUTO_ONTOLOGY_VDB_BACKEND` (default `postgres`, zero-risk). The switch is transparent to callers:
`Retriever` (`utils/retriever.py:86,94`) and `dal/reset.py` both build their store through
`get_data_vdb()`/`get_semantic_vdb()`. And the re-embed is **not** greenfield — `SemanticEmbedder`
is bound to `get_semantic_vdb()` (`semantic/embed.py:113`) and `compile_semantic_layer`
calls `embedder.vdb.create_index()` (`semantic/pipeline.py:214`); the data layer embeds through
`get_data_vdb()` during ingest. So **re-embedding = run `compile_semantic_layer` + data ingest with
`AUTO_ONTOLOGY_VDB_BACKEND=vectorize`**; rows upsert keyed by the deterministic catalog id
(`vdb/vectorize.py:_id_for`).

**Remaining ordered tasks:**

> Task 10 (Provision Vectorize) is a deployment action — moved to **Phase 7** (§4 Phase 7).

11. **Re-embed into Vectorize.** Run `compile_semantic_layer` + data-layer ingest with
    `AUTO_ONTOLOGY_VDB_BACKEND=vectorize`; confirm every row upserts keyed by its catalog id and
    that `delete_by_database`/`delete_all` clean up correctly (Vectorize `delete_all` recreates the
    index — no bulk delete-all).
12. **Integration-validate the switch.** Run the `Retriever` against Vectorize with a live DB and
    confirm the `metadata_filter_format = "dict"` → Vectorize `where`-filter contract end-to-end
    (beyond the offline unit tests in `vdb/tests/`).
13. **Recall comparison.** Vectorize float32 retrieval recall vs. the pgvector halfvec baseline
    (also plan task 19). Regressions here are the gate for cutting over the switch.

### Phase 3 — Agent runtime (Container + DO)
10. Package FastAPI + LangGraph into a Docker image (Python + deps).
11. Orchestrate via Durable Objects: DO spins up/resumes a container per session, proxies the
    WebSocket/SSE stream for live token output and HITL, hibernates to zero after the run.
12. Build the Worker gateway (auth-only) that fronts the DO/container and streams tokens. No
    Turnstile: every caller must already be authenticated (shared-secret service-to-service or
    SSO bearer), so the gateway's existing auth is the gate and there is no unauthenticated
    browser surface to protect. Turnstile was dropped because it only guards browser-human
    traffic on public surfaces — none here.
13. Wire LLM/embedding calls to Workers AI or keep OpenAI/Kumo via egress.

### Phase 4 — Frontend (App Router → Pages+Functions)

> **Reassessed 2026-08.** The frontend is **Next.js App Router** (`app/`), **not** the Pages
> Router, with **81 Route Handlers** (not ~18), of which **13 touch `prisma.` directly**
> (`acronyms`, `conversations`, `custom-prompts`, `analytics`, `configurations/*`). There is no
> `middleware.ts` and no Cloudflare adapter is installed yet. Auth is **`better-auth`** (Prisma
> adapter + admin/sso/apiKey/mcp plugins) with session state in cookies. The chat/agent path is
> three Route Handlers that proxy SSE to the backend.

14. **Convert App Router → Pages+Functions.** Move `app/api/**` Route Handlers to
    `/functions/api/**` (via `next-on-workers` or a manual `/functions` migration) so the UI runs
    on Pages and the API logic on Functions. Client API calls use **relative URLs**
    (`/api/chat/completions`), so no browser change is needed — only the server routes move.
15. **Proxy the 13 Prisma-backed data routes to the container API** rather than porting Prisma to
    D1. The semantic-catalog graph is a heavy join/cascade graph (Database → Schema → Table →
    Column, `ON DELETE CASCADE`) — the shape D1 handles worst. The Container already reads/writes
    Postgres directly (`infra/aurora.py`, `dal/schema.py`), so proxy these routes to it. Reserve
    D1 for small, high-cardinality lookups only if a later task proves it worth it.
16. **Re-auth `better-auth`.** Its session/user/account tables currently live in Postgres via the
    Prisma adapter. Recommend proxying its `/api/auth/...` HTTP endpoints to the container (single
    Postgres access path, consistent with task 15) rather than splitting auth tables into D1 —
    flag as the highest-risk Phase 4 item and confirm the final store at implementation.
17. **Agent streaming (SSE).** The three chat Route Handlers
    (`/chat/completions`, `/chat/cancel`, `/chat/watch`) stream token-by-token. They now forward to
    the Container gateway via `frontend/lib/containerProxy.ts` (see §5c). No new browser SSE client
    is required — the existing `api/chat.ts` → `lib/useChat.ts` path is unchanged.

### Phase 5 — Ingestion (event-driven, no daemons)
16. Replace `IntervalScheduler` daemons with **Cron → Worker → Queue → Container** bridge.
17. Put native connectors (pyhive, snowflake, databricks, trino) in the ingestion container image;
    ETL: fetch → R2, embed (Workers AI or in-container), vectors → Vectorize, metadata → Postgres.
    Container exits when the queue drains.

### Phase 6 — Verify & cut over
18. Test agent streaming + HITL across the 10-min inactivity boundary; confirm state survives
    container restart.
19. Catalog read-after-write freshness tests under Hyperdrive TTLs; retrieval-recall vs. old
    pgvector baseline.

Rollout with rollback to the old Helm/Compose stack (task 20) is a deployment action — moved to
**Phase 7** (§4 Phase 7).

### Phase 7 — Deployment (go-live)

Provision the Cloudflare resources, inject secrets, deploy the Worker gateway, run smoke tests,
and cut over with rollback. Provisioning is a Cloudflare-side action (resources live in
`wrangler.toml` / the dashboard, not the Python repo), so it is consolidated here rather than
scattered across the build phases.

1. **Provision Hyperdrive** (task 5) against the managed Postgres — Workers edge pooling + read
   cache for read-sensitive catalog reads; short `max_age` or cache-bypass on write-sensitive
   reads. Connection string via `cf` / dashboard.
2. **Provision Vectorize** (tasks 7/10) — one namespace, two collections `data_objects_layer` +
   `semantic_layer`, HNSW index, cosine or euclidean score (Vectorize has no `halfvec`;
   embeddings are float32).
3. **Provision R2** (blobs) and **D1/KV** (sessions, rate-limit counters, short-lived caches).
4. **Inject Cloudflare Secrets** via `wrangler secret put` (agent secret, Aurora/DB keys, LLM/
   prediction keys) and forward them into the Container via `CONTAINER_ENV_SECRETS`; set
   `CONTAINER_ENABLE_INTERNET` for LLM/embedding egress.
5. **Deploy the Worker gateway** (`wrangler deploy`) and run `workers/smoke-test.sh` (Tier 1
   health/401, Tier 2 SSE e2e) and `workers/provision-vectorize.sh`.
6. **Re-embed into Vectorize** and run the recall comparison vs. the pgvector baseline (task 13 /
   Phase 6 task 19) — regressions here gate the cutover.
7. **Rollout with rollback** (task 20): cut over traffic to the Cloudflare stack and keep the
   ability to roll back to the old Helm/Compose stack.

---

## 5. High-risk integrations (prototype first)

- **H1 — Storage layer (pgvector → Vectorize + catalog DB wiring).** Foundational; de-risks the last
  genuine fork. Consumes the Aurora details directly. **Starting point for this effort.**
- **H2 — DO ↔ Container agent gateway with SSE streaming.** Highest complexity; validates the
  10-min inactivity override and token streaming path. **Prototype done — see §5b.**

## 5a. Storage-layer wiring (prototype - done)

Files added/changed in `auto_ontology/`:

- `vdb/base.py` - `VDBBackend` ABC + shared `_extract`/`_flatten` record helpers.
- `vdb/vectorize.py` - `VectorizeVDB` (Cloudflare Vectorize) implementing the same contract.
- `vdb/postgres.py` - `PostgresVDB` now subclasses `VDBBackend`; `_to_async_url` translates
  `sslmode` -> `ssl` so one Aurora URL works on both psycopg2 (sync) and asyncpg (read) paths.
- `vdb/__init__.py` - `get_vdb()` selects the backend via `AUTO_ONTOLOGY_VDB_BACKEND`
  (`postgres` default, `vectorize` for the native path). Unknown values raise.
- `infra/aurora.py` - `aurora_connection_string()` builds a TLS URL from `AURORA_*` (fallback
  `POSTGRES_*`); `infra/postgres.get_postgres_connection_string()` prefers it when `AURORA_HOST` set.
- `vdb/tests/test_backend_abstraction.py` - offline tests (record extraction, filter conversion,
  deterministic ids, SSL translation, Aurora routing).

**Flip to Vectorize** (no caller changes):

```bash
export AUTO_ONTOLOGY_VDB_BACKEND=vectorize
export CLOUDFLARE_API_TOKEN=cf_...          # Vectorize read/write
```

**Point the whole stack at Aurora** (no code changes, env only):

```bash
export AURORA_HOST=cluster-xxx.us-east-1.rds.amazonaws.com
export AURORA_PORT=5432
export AURORA_USER=...   # inject via Cloudflare Secrets in the Container
export AURORA_PASSWORD=...
export AURORA_DATABASE=auto_ontology
# optional, for verify-ca/verify-full:
export AURORA_SSL_ROOT_CERT=/etc/ssl/rds-ca-global.pem
```

**Hyperdrive (Workers edge pooling to Aurora)** - a Cloudflare-side resource, not in the Python repo:

```toml
# wrangler.toml (created via `cf` / dashboard). Workers read the catalog through this.
[[hyperdrive]]
name = "AURORA"   # referenced as env.AURORA in Workers
connectionString = "postgresql://user:pass@aurora-endpoint:5432/auto_ontology?sslmode=verify-ca"
# max_age and stale_while_revalidate control read freshness (see caveat 3 in section 2).
```

> Hyperdrive is a **Workers binding**, not a Container binding. The Python Container reaches Aurora
> directly via `infra/aurora.py` (psycopg2 for the DAL + VDB admin ops, asyncpg for retrieval). Use
> a short `max_age` or bypass the cache on write-sensitive catalog reads (caveat in section 2).

---

## 5b. DO <-> Container agent gateway with SSE (prototype - done)

Files added in `workers/` (a new tree, no changes to the Python repo):

- `src/agent-gateway.ts` - Worker entry point. `/health` (public, no auth), else `resolveIdentity()`
  then route to a per-session Durable Object via `AGENT_DO.idFromName(sessionId)`.
- `src/agent-do.ts` - Session Durable Object. `ctx.container.start({ instance, instance_type })`
  boots/resumes the agent Container; proxies the request to `127.0.0.1:AGENT_PORT`; returns the
  container's response **verbatim** so the SSE `text/event-stream` body is relayed token-by-token.
  `POST /chat/cancel` flips an in-DO run flag. One DO per session keeps a warm instance for the
  whole conversation.
- `src/agent-container.ts` - Container lifecycle class. `sleepAfter = 30m` (default 10m is too short
  for a HITL pause) and `onActivityExpired` is a no-op so the instance stays warm; the DO stops it
  explicitly when the session ends.
- `src/auth.ts` - Identity contract mirroring the agent's `resolve_internal_user`. Two paths:
  (1) internal shared-secret `Authorization: Bearer <CLOUDFLARE_AGENT_SECRET>` -> inject
  `x-auto-ontology-user-id`; (2) SSO bearer token when `ANY_CONNECTION_USES_SSO_FEDERATION=true`.
- `wrangler.toml` - `[[containers]]` with `scheduling_policy = "durable_object"`, `class_name =
  "AgentContainer"`, `image = "./Dockerfile"` (the existing agent image, reused unchanged),
  `instance_type = "standard-1"`; `[[durable_objects.bindings]] AGENT_DO -> AgentDo`; `[exports.AgentDo]`
  `type = "durable-object" storage = "sqlite"`. `CONTAINER_ENV_SECRETS` (comma-separated) lists the
  Cloudflare Secrets forwarded into the Container at start so the agent can run (DB + LLM keys).
- `smoke-test.sh` / `deploy.sh` - deploy + Tier 1 (health/401) / Tier 2 (SSE e2e) smoke tests.
- `types/cloudflare-containers.d.ts` - ambient types for the Container lifecycle API (`Container`,
  `ContainerInstance`, `ContainerNamespace`). The published `@cloudflare/workers-types` lags the
  Container runtime, so these are declared locally.
- `types/globals.d.ts` - the global `Env` type (normally wrangler-generated).

**Verified:** `tsc -p workers/tsconfig.json` exits 0 (strict). The agent image and Python code are
**unchanged** for H2 — the gateway is a pure proxy.

**Deploy:**

```bash
cd workers
wrangler secret put CLOUDFLARE_AGENT_SECRET --value '<secret>'
wrangler deploy
# client:
curl -X POST https://<worker>/chat/completions \
  -H "Authorization: Bearer $CLOUDFLARE_AGENT_SECRET" \
  -H "x-auto-ontology-user-id: <user>" \
  -d '{"messages":[...]}'   # -> text/event-stream, ends with data: [DONE]
```

**Phase 3 task 13 — LLM/embedding wiring (kept via container egress, not Workers AI):**
the Python agent runs inside the Container, so Workers AI (a Workers-only API) is not a
fit; the agent reaches NVAPI + Kumo over the public internet instead.
- `src/agent-do.ts` sets `enableInternet` on `ctx.container.start()`
  (`CONTAINER_ENABLE_INTERNET`, default `true`) so the agent can make its LLM/embedding/
  Kumo calls. Leave `false` to sandbox the container.
- `wrangler.toml` `[vars]` `CONTAINER_ENV_SECRETS` now forwards the agent's LLM/prediction
  secrets alongside the DB keys: `KUMO_RFM_API_URL` (required by the predictor; omit to
  disable Kumo), `DEFAULT_MODELS_API_KEY` (shared fallback for every REASONING/NON_REASONING/
  EMBED/RERANK triplet), and the per-triplet `*_API_KEY` overrides. Endpoints and models fall
  back to built-in NVAPI defaults, or set `DEFAULT_MODELS_*`.
- `types/globals.d.ts` declares `CONTAINER_ENABLE_INTERNET` on `Env`.

> The `durable_object` Container scheduling policy is in **beta**; confirm the exact
> `ctx.container.start` / `getByName` signatures against the live Container API at deploy time.

---

## 5c. Frontend agent-streaming proxy (prototype - done)

The three chat Route Handlers previously hard-coded a hop to the FastAPI backend
(`PYTHON_API_URL`, default `127.0.0.1:3001`). For the Container gateway they now forward through a
single shared helper:

- `frontend/lib/containerProxy.ts` - `forwardToContainer({ path, method, body, headers })` resolves
  `AGENT_GATEWAY_URL` (default `127.0.0.1:3001`) and forwards verbatim; `SSE_RESPONSE_HEADERS`
  carries the `text/event-stream` headers (`Content-Type`, `no-cache`, `keep-alive`,
  `X-Accel-Buffering: no`) once, centrally.

Files changed:

- `app/api/chat/completions/route.ts` - `fetch(`${PYTHON_API_URL}/api/chat/completions`, …)` →
  `forwardToContainer({ path: '/api/chat/completions', … })`; SSE headers now `SSE_RESPONSE_HEADERS`.
- `app/api/chat/cancel/route.ts` - same swap for `/chat/cancel`.
- `app/api/chat/watch/route.ts` - same swap for `/chat/watch` (GET); SSE headers centralized.

`PYTHON_API_URL` is removed from all three. The client (`api/chat.ts` → `lib/useChat.ts`) is
unchanged — it already uses relative URLs, so the only move is server-side.

**Verified:** `tsc --noEmit` in `frontend/` exits 0 (strict) after `npm install`.

---

## 6. Security notes

- Never commit credentials. Use Cloudflare Secrets / env injection for Postgres passwords and API
  keys. Placeholder connection strings in code must not contain real secrets.
