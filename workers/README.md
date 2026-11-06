# Auto-Ontology Agent Gateway — Cloudflare Containers + Durable Objects

**Phase 3, Milestone H2.** A Cloudflare Workers + Containers gateway that
authenticates clients and proxies to the Auto-Ontology LangGraph agent, which
runs inside a Container and streams results back over SSE.

## Why this shape

The agent is a long, synchronous LangGraph loop (tool calls, MCP round-trips,
multi-step reasoning, optional human-in-the-loop pauses). That does not fit the
Workers Python runtime (no `langgraph`; `langchain-core` there is ~5 major
versions older). So the agent image runs **unchanged** in a Cloudflare
**Container**, and a Workers layer handles auth + session orchestration + SSE
relaying.

```
client ──auth──▶ Worker (agent-gateway.ts)
                        │  resolveIdentity()  (shared secret OR SSO bearer)
                        ▼
              Durable Object (agent-do.ts)   ← one per session
                        │  ctx.container.start({ instance, instance_type })
                        ▼
              Container (AgentContainer)     ← agent image, LangGraph loop
                        │  fetch()  (127.0.0.1:AGENT_PORT)
                        ▼
              FastAPI /chat/completions  ──text/event-stream──▶ client
```

## Files

| File | Role |
| --- | --- |
| `src/agent-gateway.ts` | Worker entry point. Health check, auth, per-session DO routing. |
| `src/agent-do.ts` | Session Durable Object. Starts/resumes the Container instance, relays SSE, handles cancel. |
| `src/agent-container.ts` | Container lifecycle class. Raises `sleepAfter` and keeps the instance warm for the session. |
| `src/auth.ts` | Identity contract: internal shared-secret path and SSO-federation path. Mirrors the agent's `resolve_internal_user`. |
| `wrangler.toml` | Container + durable-object bindings, instance size, vars. |
| `types/*.d.ts` | Ambient types for the Container API and `Env` (the published `workers-types` lags the Container runtime). |

## Auth contract

The agent must never be publicly reachable. The gateway validates the client
and forwards an internal identity header. Two paths, matching the agent's own
`resolve_internal_user`:

1. **Internal service-to-service** — client presents `Authorization: Bearer
   <CLOUDFLARE_AGENT_SECRET>`; gateway injects
   `x-auto-ontology-user-id: <user-id>`.
2. **SSO federation** — client presents a valid SSO bearer token; gateway
   validates it and forwards the resolved subject. Enabled on the agent when
   `ANY_CONNECTION_USES_SSO_FEDERATION=true`.

Set `CLOUDFLARE_AGENT_SECRET` via `wrangler secret put CLOUDFLARE_AGENT_SECRET`
— never commit it.

## Container lifecycle

- `sleepAfter = 30m` (default 10m is too short for a HITL pause).
- `onActivityExpired` is a no-op so a warm instance survives the session; the
  DO stops it explicitly when the session ends.
- Instance size is chosen by the DO at start time (`CONTAINER_INSTANCE_TYPE`,
  default `standard-1`).

## Deploy

```bash
cd workers
wrangler secret put CLOUDFLARE_AGENT_SECRET --value '<secret>'
wrangler deploy
```

## Notes / open items

- The `durable_object` Container scheduling policy is in **beta**; confirm the
  exact `ctx.container.start` / `getByName` method names against the live
  Container API at deploy time.
- The published `@cloudflare/workers-types` predates the Container lifecycle
  API, so the types are declared locally in `types/cloudflare-containers.d.ts`.
- The Container image is the repo-root `Dockerfile` (the existing agent image);
  no Python changes are required for H2.
- **Container runtime env.** The agent needs its catalog DB connection and LLM/
  prediction keys to run. These are Cloudflare Secrets forwarded into the
  Container at start time by `AgentDo.buildContainerEnv()`, driven by the
  comma-separated `CONTAINER_ENV_SECRETS` var in `wrangler.toml`. Add the agent's
  real secret names there (and `wrangler secret put` each). They are never baked
  into the image.
