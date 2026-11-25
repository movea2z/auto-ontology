# Auto-Ontology — Cloudflare-Native Rewrite Plan

> Status: **Prototype, not deployed.** Target frontend and gateway on Workers;
> retain Python Containers where required and minimize external PostgreSQL use.

> **Cutover blocked:** Vectorize currently permits at most 1,536 dimensions per vector,
> but the configured embeddings have 2,048 dimensions. The Vectorize prototype is not
> deployable as configured. Keep pgvector until an embedding model or supported
> dimensionality-reduction strategy is selected, re-embedding is implemented, and recall
> is measured. See [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/).
> The prototype also needs live API and deletion validation before it can be treated as a
> drop-in replacement.

## 0. Verdict

The target runs the Next.js frontend and gateway on Workers. The existing Python
agent and ingestion components need Containers until their process, thread and
native-driver dependencies are migrated. The catalog currently needs PostgreSQL
and pgvector; use Cloudflare-native storage for frontend state where practical
only after removing the Python backend's direct dependencies on that state.

Vectorize is not a drop-in replacement for the current embeddings; keep pgvector
until the dimension and retrieval-validation blockers above are resolved.

---

## 1. Runtime map

| Concern | Traditional constraint | Cloudflare setup |
| --- | --- | --- |
| Edge API & Auth | Needs global distribution | Workers; Better Auth storage migration remains open |
| Agent Runtime | Existing subprocess-based Python execution | **Containers (Python)** bound to **Durable Objects** |
| Catalog Graph | Existing PostgreSQL schema and SQLAlchemy DAL | Managed Postgres while a native migration is unimplemented |
| Semantic Search | 2,048-dimensional embeddings | pgvector until Vectorize compatibility and recall are validated |
| Ingestion Engine | Native drivers, continuous daemons | **Cron → Queue → Container** (stateless batch pollers) |
| Unstructured Assets | High egress on external buckets | **R2** |
| Sessions / caches / rate limits | — | **D1 / KV** |

### LangGraph runtime: current Python backend

Cloudflare Python Workers support bundled pure-Python and compatible WebAssembly
packages, including FastAPI; an absent built-in LangGraph package alone does not
prove it cannot run. The project's dependency graph still needs compatibility
testing. See [Python Worker packages](https://developers.cloudflare.com/workers/languages/python/packages/).

The existing agent uses `multiprocessing` to isolate and cancel synchronous work
(`auto_ontology/server/chat/worker.py`), and ingestion uses threads. Those modules
are not functional in Python Workers' WebAssembly runtime. The existing backend
therefore needs a Container unless those execution paths and incompatible native
drivers are replaced. See [Python standard library support](https://developers.cloudflare.com/workers/languages/python/stdlib/).

Containers can restart, so durable application state must not depend on their memory.

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
   the DB. Disable query caching for frontend authentication and other reads requiring consistency.
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
## 4a. Phase status (as of 2026-11-24)

| Phase | Status | Tasks |
| --- | --- | --- |
| Phase 0 — Decisions & procurement | **Partial** | 1–3 done; 4 BLOCKED (Vectorize 1,536 max vs 2,048 embed) |
| Phase 1 — Storage layer | **Prototype done** | 6 satisfied by existing schema; provisioning moved to Phase 7 |
| Phase 2 — Catalog graph migration | **~90% done** | 8 DONE; 9 interface DONE; 11–13 remaining (blocked on task 4) |
| Phase 3 — Agent runtime | **Prototype done** | 10–13: gateway prototype committed; deployed validation OPEN |
| Phase 4 — Frontend (vinext) | **Prototype done** | 14 DONE; 15 restored, deployed verification OPEN; 16 OPEN; 17 prototype |
| Phase 5 — Ingestion | **Not started** | 16–17 not started |
| Phase 6 — Verify & cut over | **Not started** | 18–19 not started |
| Phase 7 — Deployment | **Not started** | 1–7 not started |



### Phase 0 — Decisions & procurement
1. Procure the one external dependency: **managed PostgreSQL** (Aurora — already available).
2. Lock agent-runtime decision: **Container + DO** (keeps Python LangGraph) — recommended.
3. Decide container lifecycle policy: override `sleepAfter` for HITL; set `max_age` strategy for
   Hyperdrive on write-sensitive catalog reads.
4. **BLOCKED — Vectorize dimension fit:** Cloudflare's documented maximum is 1,536,
   below the current 2,048-dimensional embedding. Select and validate a compatible
   embedding strategy before provisioning or re-embedding. Cosine is supported.

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

11. **Blocked on task 4 and provider implementation.** Once a compatible embedding strategy
    is selected, implement it consistently for indexing and queries, then run
    `compile_semantic_layer` + data-layer ingest. Verify catalog IDs and complete deletion
    against the live Vectorize API; current prototype deletion is not validated.
12. **Integration-validate the switch.** Run the `Retriever` against Vectorize with a live DB and
    confirm the `metadata_filter_format = "dict"` → Vectorize `where`-filter contract end-to-end
    (beyond the offline unit tests in `vdb/tests/`).
13. **Recall comparison.** Vectorize float32 retrieval recall vs. the pgvector halfvec baseline
    (also plan task 19). Regressions here are the gate for cutting over the switch.

### Phase 3 — Agent runtime (Container + DO)
10. Package FastAPI + LangGraph into a Docker image (Python + deps).
11. **Gateway prototype:** a per-user Durable Object starts a Python Container
    and streams responses. Validate startup, isolation, cancellation and restart
    behavior against the deployed runtime before relying on it.
12. The frontend Worker authenticates users and supplies a gateway secret and
    trusted user ID; the gateway verifies that secret and forwards SSO subject
    tokens separately. Provision the secret in both Workers. Do not expose it
    to browsers. See `workers/README.md`.
13. Wire LLM/embedding calls to Workers AI or keep OpenAI/Kumo via egress.

### Phase 4 — Frontend (App Router → Cloudflare via vinext)

> **Reassessed 2026-11.** Implemented with **vinext** (a Next.js → Cloudflare adapter), which
> builds the existing **App Router** (`app/`) directly to Cloudflare Pages + Workers — not a
> Pages-Router conversion and not `next-on-workers`. The frontend has **81 Route Handlers**, of
> which **13 touch `prisma.` directly** (`acronyms`, `conversations`, `custom-prompts`,
> `analytics`, `configurations/*`). Auth is **`better-auth`** (Prisma adapter + admin/sso/
> apiKey/mcp plugins) with session state in cookies.

14. **vinext build toolchain — DONE, verified.** `frontend/vite.config.ts` (vinext RSC+SSR
    build) and `frontend/cloudflare.config.ts` (the Cloudflare worker: assets, KV cache, images,
    `compatibilityDate: 2026-11-11`) were added, plus `dev/build/start/deploy:vinext` scripts in
    `package.json` and `react` bumped to 19.3. `tsconfig.json` excludes `.cloudflare/**` and
    `.gitignore` ignores `/dist`, `.vinext`, `.cloudflare`. Verified: `tsc --noEmit` and
    `vite build` (`build:vinext`) both exit 0.

15. **Frontend data routes — restored, deployed verification OPEN.** `acronyms`,
    `analytics`, `conversations`, `custom-prompts`, and `configurations/*`
    execute their permission-gated Prisma operations in the frontend again.
    They use the shared Postgres schema until the coordinated D1 migration.
    Local Workers preview verified authenticated conversation creation and
    readback, and rejected an unauthenticated read.

16. **Authentication and storage — OPEN.** Better Auth and frontend-owned
    Prisma operations use the shared PostgreSQL schema through a `HYPERDRIVE`
    binding. Disable Hyperdrive query caching for read-after-write consistency;
    Prisma clients are created per Worker invocation. A separate Cloudflare
    Prisma client is generated for the Worker. First-admin bootstrap runs
    separately; see `workers/README.md`. Local Workers preview verified health
    and email sign-in against isolated PostgreSQL through local Hyperdrive.
    Deployed connectivity to Aurora remains unverified.
    Prefer D1 for frontend-owned state to reduce external Postgres use. This
    requires a SQLite-compatible Prisma schema and D1 migrations, plus changes
    to Python code that directly reads and writes the shared `frontend` schema.
    Do not switch only the auth database: that would split identity and break
    existing cross-component behavior.

17. **Agent streaming (SSE) — prototype.** Chat Route Handlers forward to the
    gateway via `frontend/lib/containerProxy.ts`, preserving the browser client.
    Runtime streaming, cancellation, and end-to-end authentication remain to be
    validated with the deployed Worker and Container.

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

1. **Provision Hyperdrive** (task 5) against managed Postgres. Disable query
   caching for frontend authentication and other read-after-write operations.
   Supply the Hyperdrive ID through `CLOUDFLARE_HYPERDRIVE_ID` at frontend
   build/deployment; keep origin credentials in Hyperdrive, not the repository.
2. **Blocked on Phase 0 task 4:** provision two Vectorize indexes only after choosing a
   compatible embedding strategy (maximum 1,536 dimensions). Match index dimensions and
   metric to that strategy; re-embed both collections before cutover.
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

## 5b. Worker and Container gateway (prototype)

`workers/src/agent-gateway.ts` authenticates frontend-server requests using
`CLOUDFLARE_AGENT_SECRET` and routes by trusted user ID to `AgentDo`. The
Durable Object starts the Python Container and streams the response without
buffering. The gateway does not itself authenticate end users: the frontend
must enforce authentication and route permissions.

`workers/wrangler.toml` declares the Worker and Container image. Configure
secrets and environment variables as described in `workers/README.md`.
The Durable Object scheduling policy is beta. Typechecking and local auth
checks do not prove Container startup or end-to-end streaming on Cloudflare.

---

## 5c. Frontend agent-streaming proxy (prototype)

The three chat Route Handlers previously hard-coded a hop to the FastAPI backend
(`PYTHON_API_URL`, default `127.0.0.1:3001`). For the Container gateway they now forward through a
single shared helper:

- `frontend/lib/containerProxy.ts` - `forwardToContainer({ path, method, body, headers })` resolves
  `AGENT_GATEWAY_URL` (required on Workers; local development defaults to `127.0.0.1:3001`);
  `SSE_RESPONSE_HEADERS`
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
## 5d. Frontend Cloudflare migration via vinext (prototype - incomplete)

The vinext configuration builds the existing Next.js App Router for a Cloudflare
Worker. A successful build does not prove that authentication, data routes, or
streaming work in the Workers runtime.

Files added:

- `vite.config.ts` — vinext RSC+SSR build with the Cloudflare plugin, KV cache
  adapter, images optimizer, and SVGR for the existing icon components.
- `cloudflare.config.ts` — the Cloudflare worker: `entrypoint: "vinext/server/fetch-handler"`,
  `compatibilityDate: 2026-11-11`, assets plus `VINEXT_KV_CACHE` / `IMAGES` bindings.
- `auth/proxy-backend.ts` — permission-gated backend requests use the gateway
  when configured; local development can still reach `PYTHON_API_URL` directly.

Files changed:

- `app/api/acronyms`, `app/api/analytics`, `app/api/conversations`, `app/api/custom-prompts`,
  `app/api/configurations/*` — restored frontend Prisma operations against the
  shared Postgres schema; D1 migration and Workers runtime checks remain open.
- `package.json` — add `vinext`, `vite`, `@cloudflare/vite-plugin`, `@vinext/cloudflare` and the
  `dev/build/start/deploy:vinext` scripts; `pnpm-lock.yaml` regenerated.
- `tsconfig.json` — exclude `.cloudflare/**`; `.gitignore` ignores `/dist`, `.vinext`,
  `.cloudflare`.

**Open:** Better Auth and frontend-owned state still depend on the Postgres
`frontend` schema, which Python also reads and writes directly. Migrating that
state to D1 requires coordinated changes on both sides; see Phase 4.

**Verified:** `tsc --noEmit` and `vite build` (`build:vinext`) both exit 0 in `frontend/`.

---

## 6. Security notes

- Never commit credentials. Use Cloudflare Secrets / env injection for Postgres passwords and API
  keys. Placeholder connection strings in code must not contain real secrets.
