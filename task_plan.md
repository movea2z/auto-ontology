# Task Plan — Cloudflare Rewrite

Source: `CLOUDFLARE-REWRITE-PLAN.md`. Status as of 2026-11-24.

## Phase 0 — Decisions & procurement
- [ ] 1. Procure managed PostgreSQL (Aurora) — done (available)
- [ ] 2. Lock agent-runtime decision: Container + DO — done (recommended)
- [ ] 3. Container lifecycle policy: override `sleepAfter` for HITL; Hyperdrive `max_age` strategy — done (prototype)
- [ ] 4. **BLOCKED** — Vectorize dimension fit: 1,536 max vs 2,048 embed. Select compatible embedding strategy; validate; re-embed.

## Phase 1 — Storage layer
- [ ] 6. Model containment natively (ltree / WITH RECURSIVE) — satisfied by existing parent-FK + ON DELETE CASCADE schema; no porting needed
- Provisioning moved to Phase 7.

## Phase 2 — Catalog graph migration
- [ ] 8. SQLAlchemy Core schema + Alembic on Postgres — DONE
- [ ] 9. vdb provider interface + re-embed — interface DONE; re-embed wired (not new job)
- [ ] 11. Implement compatible embedding strategy; run `compile_semantic_layer` + data-layer ingest; verify catalog IDs and deletion against live Vectorize API — BLOCKED on task 4
- [ ] 12. Integration-validate switch: Retriever against Vectorize with live DB; confirm `metadata_filter_format = "dict"` → Vectorize `where`-filter contract — BLOCKED on task 4
- [ ] 13. Recall comparison: Vectorize float32 vs pgvector halfvec baseline — BLOCKED on task 4

## Phase 3 — Agent runtime (Container + DO)
- [ ] 10. Package FastAPI + LangGraph into Docker image — prototype done
- [ ] 11. Gateway prototype: per-user DO starts Python Container, streams responses — prototype done; deployed validation OPEN
- [ ] 12. Frontend Worker authenticates users, supplies gateway secret + trusted user ID; gateway verifies secret, forwards SSO subject tokens — prototype done; secret provisioning OPEN
- [ ] 13. Wire LLM/embedding calls to Workers AI or keep OpenAI/Kumo via egress — prototype done; deployed validation OPEN

## Phase 4 — Frontend (App Router → Cloudflare via vinext)
- [ ] 14. vinext build toolchain — DONE, verified (tsc + vite build)
- [ ] 15. Frontend data routes restored (acronyms, analytics, conversations, custom-prompts, configurations/*) — restored; deployed verification OPEN
- [ ] 16. Authentication and storage — OPEN: Better Auth + Prisma via HYPERDRIVE binding; disable Hyperdrive query caching; per-invocation Prisma clients; separate Cloudflare Prisma client; first-admin bootstrap; deployed connectivity to Aurora unverified; D1 migration deferred
- [ ] 17. Agent streaming (SSE) — prototype: chat Route Handlers forward via `frontend/lib/containerProxy.ts`; runtime streaming/cancellation/e2e auth OPEN

## Phase 5 — Ingestion (event-driven, no daemons)
- [ ] 16. Replace `IntervalScheduler` daemons with Cron → Worker → Queue → Container bridge — not started
- [ ] 17. Native connectors (pyhive, snowflake, databricks, trino) in ingestion container image; ETL: fetch → R2, embed (Workers AI or in-container), vectors → Vectorize, metadata → Postgres — not started

## Phase 6 — Verify & cut over
- [ ] 18. Test agent streaming + HITL across 10-min inactivity boundary; confirm state survives container restart — not started
- [ ] 19. Catalog read-after-write freshness tests under Hyperdrive TTLs; retrieval-recall vs old pgvector baseline — not started

## Phase 7 — Deployment (go-live)
- [ ] 1. Provision Hyperdrive (task 5) — not started
- [ ] 2. Provision two Vectorize indexes — BLOCKED on Phase 0 task 4
- [ ] 3. Provision R2 + D1/KV — not started
- [ ] 4. Inject Cloudflare Secrets via `wrangler secret put`; forward into Container via `CONTAINER_ENV_SECRETS`; set `CONTAINER_ENABLE_INTERNET` — not started
- [ ] 5. Deploy Worker gateway (`wrangler deploy`); run `workers/smoke-test.sh` + `workers/provision-vectorize.sh` — not started
- [ ] 6. Re-embed into Vectorize; recall comparison vs pgvector baseline — not started
- [ ] 7. Rollout with rollback (task 20) — not started
