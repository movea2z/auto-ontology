# Auto-Ontology Worker Gateway

Cloudflare Worker authenticates the frontend server, routes requests to a
per-user Durable Object, starts Python FastAPI Container, and streams responses
without buffering.

## Request flow

```text
frontend server -> Worker -> per-user Durable Object -> Container :3001
                                           /api/* -> FastAPI
```

Worker exposes public `GET /health` and authenticated `/api/*`. It forwards
backend paths and query strings unchanged, including chat endpoints:

- `POST /api/chat/completions` — streams chat SSE.
- `GET /api/chat/watch` — streams an existing run.
- `POST /api/chat/cancel` — cancels backend run.
- Other `/api/*` routes — proxied to FastAPI.

All response bodies stream directly from Container. Gateway does not implement
conversation authorization; frontend server must authenticate the user and
enforce route permissions before proxying.

## Authentication and identity

Every `/api/*` request MUST include:

- `x-auto-ontology-gateway-secret: <CLOUDFLARE_AGENT_SECRET>`
- `x-auto-ontology-user-id: <authenticated user id>`

Set `CLOUDFLARE_AGENT_SECRET` as a Worker secret, never as a committed var:

```sh
cd workers
wrangler secret put CLOUDFLARE_AGENT_SECRET
```

Configure the frontend Worker with the gateway's HTTPS URL as
`AGENT_GATEWAY_URL` and the same `CLOUDFLARE_AGENT_SECRET` as a secret.
Neither value should be exposed to browser code. Rotate the shared secret on
both Workers together.

The frontend Worker also requires `APP_URL`, a strong persistent `AUTH_SECRET`,
and a `HYPERDRIVE` binding to the shared PostgreSQL database. Create Hyperdrive
with query caching disabled: authentication and frontend data require
read-after-write consistency. Set `CLOUDFLARE_HYPERDRIVE_ID` to its ID when
building or deploying the frontend; no database password belongs in Worker
configuration. The frontend and Python services must use the same migrated
database until the planned D1 cutover.

Prisma generates separate Node and Cloudflare clients from
`frontend/prisma/schema.prisma`. Run `pnpm db:generate` after schema changes;
the Worker uses request-scoped clients and Hyperdrive connection pooling.

Before the first Worker deployment, apply the frontend Prisma schema to the
shared database and bootstrap an admin from a trusted machine or migration
job with database network access. Provide `POSTGRES_*`,
`AUTO_ONTOLOGY_ADMIN_EMAIL`, and `AUTO_ONTOLOGY_ADMIN_PASSWORD` through a
protected environment, then run from `frontend/`:

```sh
pnpm exec tsx -e 'import { seedAdmin } from "./auth/seed-admin"; seedAdmin().catch((err) => { console.error(err); process.exitCode = 1; })'
```

`seedAdmin` does nothing if either admin variable is absent. If that email
already exists, it resets the account's password and restores its admin role;
run it only when that is intended. Do not rely on Worker isolate startup to
seed accounts.

Missing secret, missing identity, or mismatched secret returns `401`.
`Authorization` does not authenticate gateway. Gateway preserves it as optional
SSO subject token for FastAPI, strips gateway-secret header, then overwrites
backend identity header with authenticated proxy identity. Worker does not
validate SSO token; frontend server owns authentication and authorization.

Enable `ANY_CONNECTION_USES_SSO_FEDERATION=true` in `workers/wrangler.toml` only
when frontend validates SSO tokens before forwarding them. That setting is
passed into Python Container with its runtime environment.

Worker scopes Durable Object by authenticated user ID, never client-provided
session IDs. This keeps each user's Container/API process separate. Backend
still enforces conversation ownership using forwarded identity.

## Container configuration

`wrangler.toml` is run from `workers/`; `main` points to `./src/agent-gateway.ts`
and container image points to repo-root `../Dockerfile`. Dockerfile serves
FastAPI on port `3001`, routes are under `/api/`, and Worker defaults to port
`3001`.

Configure a deploy:

```sh
cd workers
wrangler secret put CLOUDFLARE_AGENT_SECRET
wrangler secret put AURORA_PASSWORD
# Add other runtime secrets used by the agent.
wrangler deploy
```

`CONTAINER_ENV_SECRETS` lists binding names forwarded into Python Container at
start. Configure database and model credentials with `wrangler secret put` and
add required names to this list. SSO federation flag is a non-secret Worker var
included in the list. Gateway secret is explicitly excluded from Container
environment. `CONTAINER_ENABLE_INTERNET=true` enables outbound model/API
requests; set false only when agent does not need external services.

Worker starts Container using `ctx.container.start({ image, instance,
enableInternet, env })`, probes its documented `/api/health/live` endpoint for
up to 60 seconds, then forwards through `ctx.container.getTcpPort(3001)`.
Container and Durable Object are one per active user, so running instance count
and cost scale with active users.

## Limitations

- Gateway secret is shared between frontend server and Worker; rotate both
  sides together. Do not expose it to browser code.
- Worker trusts identity asserted by holder of gateway secret. Protect that
  secret and ensure frontend server derives identity from authenticated session,
  never client-supplied identity headers.
- Gateway does not validate SSO/JWT tokens or apply per-route permissions.
- Backend still requires external Postgres and configured model/provider
  credentials; gateway does not replace those dependencies.
