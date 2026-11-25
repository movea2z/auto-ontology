<!--
SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Support and troubleshooting

Use this guide to isolate failures without exposing credentials or changing data. Start with readiness, then follow the affected path. For setup and deployment steps, use the [setup guide](../skills/nvidia-ontology-setup/SKILL.md), [deployment guide](../DEPLOYMENT.md), [authentication guide](./authentication.md), [connections guide](./connections.md), [conversation API](./conversation-api.md), and [MCP guide](./mcp.md).

## Readiness and service health

A process being alive does not mean it can serve useful requests. Check the relevant layer:

| Layer | Readiness check | Meaning |
| --- | --- | --- |
| Web app | `GET /api/health` on the public app URL | `200` means frontend's Postgres query succeeded; `503` means it did not. |
| FastAPI backend | `GET /api/health` on the private backend service | `200` means Postgres is reachable and migrations match; `503` includes `postgres` and `migrations` checks. |
| Ingestion service | `GET /health` on the private ingestion service | Same Postgres and migration checks as backend. |
| MCP question readiness | MCP `check_readiness` tool | Reports semantic layer, SQL execution connection, catalog, blockers, and checks caller could not verify. |

Liveness endpoints (`/api/health/live` on the private backend and `/health/live` on the private ingestion service) check only that the process is responding. They do not prove database or migrations are ready. Do not use liveness as readiness or restart a healthy process just because its database dependency is temporarily down.

MCP `check_readiness` is the quickest end-to-end check before a question. A non-empty `databases` list alone does not prove SQL can run: catalog entries can remain after source access is lost. A viewer may receive 403 when probing admin-only connections; tool reports that check as `unverified`, not as a bad credential. See [MCP readiness details](./mcp.md#about-check_readiness).

## Authentication and authorization

- **Login page or all pages fail after restart:** stale browser session can follow an `AUTH_SECRET` change or database reset. Clear site data for this app origin, then sign in again. A Better Auth default-secret error means `AUTH_SECRET` or `APP_URL` is missing; configure both as described in the [setup troubleshooting guide](../skills/nvidia-ontology-setup/references/troubleshooting.md#ui-loads-without-the-left-navigation-or-looks-broken-after-restart).
- **401:** check session expiry, token validity, and correct deployment host. Re-authenticate or rotate a revoked/expired API token. Tokens cannot mint tokens. See [authentication and API tokens](./authentication.md).
- **403:** identity was accepted, but caller lacks route permission. Check user role/permissions; do not treat a 403 on admin-only connection inspection as source credential failure.
- **SSO callback fails:** registered redirect URI must exactly match `<APP_URL>/api/auth/sso/callback`; compare scheme, hostname, port, and path. See [SSO setup](./authentication.md#sso).
- **MCP login fails while OAuth discovery works:** inspect frontend migration job logs. MCP auth tables live in Prisma `frontend` schema and are separate from backend Alembic migrations. Compose: `docker compose logs frontend-migrate`; Helm: `kubectl logs job/frontend-migrate-<release revision>`. See [MCP setup troubleshooting](../skills/nvidia-ontology-setup/references/troubleshooting.md#sign-in-or-mcp-login-fails-although-discovery-works).

Do not paste API keys, OAuth tokens, session cookies, passwords, or full authorization headers into tickets or logs.

## Connectivity and source connections

- **App health degraded / 503:** inspect returned check and database service state. Verify app's configured Postgres hostname, port, credentials, network policy, and migration job completion. In Compose, containers use Postgres service name `postgres` and port `5432`; `POSTGRES_PORT` host mapping does not change the in-network port.
- **Source database does not appear or questions fail to connect:** verify source hostname/port is reachable from both backend and ingestion service, TLS settings and credentials, and that database/schema are available to that account. Use **Settings → Connections → Test** for UI-managed entries. Source database troubleshooting and supported connectors are in [connections.md](./connections.md).
- **Mixed connection configuration behaves inconsistently:** use one source per deployment. Querying prefers UI-managed connections whenever any exist, with `CONNECTION_STRINGS` only as fallback; ingestion prefers `CONNECTION_STRINGS` whenever set, and uses UI entries only when it is empty. Therefore setting both can ingest one source and query another. Do not infer consistency from either setting alone.
- **Catalog scope unexpectedly empty or broad:** confirm selected database and schema. UI connections can apply schema allowlists and table allow/deny regexes; `CONNECTION_STRINGS` has no schema/table filters. Deny rules win. See [connection scope and precedence](./connections.md#connections-added-in-the-ui).

## Ingestion and semantic compilation

Ingestion and compilation are asynchronous. An accepted trigger (`202`) means work was queued, not that it completed.

1. Check ingestion service readiness (`/health`) and logs. Compose service log commands: `docker compose logs --tail=200 ingestion-service` and `docker compose logs --tail=200 auto-ontology`.
2. Confirm an effective source connection exists. Ingestion logs `no connections configured` when none resolves. A failed source is logged per connection; inspect error and connection name without sharing credentials.
3. Check ingestion and semantic compilation state in **Settings → Semantic Compilation**. API users can inspect `GET /api/semantic-compilation/status` (permission `chat:use`). The private service's `GET /semantic/status` is internal; do not expose ingestion service port publicly.
4. Confirm semantic compilation is enabled if expected. Enabling it while service runs does not require a restart; trigger a compilation through the supported UI/API only after source ingest has completed.
5. A compilation with no new tables to process can be a valid no-op. Distinguish this from an empty catalog or failed pass using status history and service logs.

If catalog tables exist but semantic layer is missing, compilation has likely not completed successfully. If `check_readiness` says semantic layer is built but `can_execute_sql` is false, restore a live source connection. Do not use reset/delete operations as diagnostics: resets remove catalog or semantic data. See the [deployment guide](../DEPLOYMENT.md) for operational procedures and [ingestion API reference](./openapi/ingestion.json) for internal endpoint contracts.

## Retrieval and answer failures

- **Empty answer with no SQL or error:** call MCP `check_readiness` first. If ready, use `search_terms` for the question's business nouns and verify terms/columns exist and are meaningful. Vocabulary not present in ontology commonly explains missing candidates. See [MCP tools](./mcp.md#tools).
- **“Auto Ontology cannot answer right now”:** check semantic readiness and compilation status. A request can also return `409` when the semantic layer is uncompiled or another turn already uses the same `conversation_id`; wait for prior stream to finish before reusing that ID. See [conversation API](./conversation-api.md#conversations).
- **Questions run slowly or fail during model calls:** check model endpoint availability, model name, API key, timeouts, and network egress from backend. Model roles use endpoint/key/model triplets; unset role values fall back to `DEFAULT_MODELS_*`. See [model configuration](../README.md#nvidia-nim) and setup troubleshooting.
- **No relevant terms despite healthy readiness:** ensure ingestion and query use same `EMBED_ENDPOINT` and `EMBED_MODEL`. Changing embedding space requires re-ingestion/re-indexing; do not expect vectors generated by a different model to match. Check embedding and reranking endpoint errors in service logs.
- **Generated SQL errors:** validate source permissions, schema, and source-specific SQL dialect. Preserve SQL and exact error for diagnosis only after removing private identifiers and sensitive literals. API request/response format is in [conversation-api.md](./conversation-api.md).

## MCP connectivity

- **Client cannot discover login:** `AUTO_ONTOLOGY_API_URL` must point to public web app (Compose default `http://localhost:3000`), not FastAPI `:3001`. `/.well-known/oauth-authorization-server` should return `200` JSON; login-page redirect can indicate older frontend deployment.
- **“Protected resource ... does not match expected ...”:** client URL and `AUTO_ONTOLOGY_MCP_PUBLIC_URL` must match exactly, including hostname spelling. `localhost` and `127.0.0.1` differ. Public MCP URL includes origin only; client connects to `/mcp`.
- **No tools shown:** check MCP client logs, server stderr, exact URL suffix `/mcp`, and restart client after config changes.
- **“This request carried no signed-in session”:** grant/session expired or revoked. Sign in again using MCP client; do not configure a shared server-side token.
- **MCP calls cannot reach Auto-Ontology:** verify network/DNS/TLS from MCP host to public web app, and that `AUTO_ONTOLOGY_API_URL` has correct origin. For call-specific checks and errors, see [MCP troubleshooting](./mcp.md#troubleshooting).

## Diagnostics and safe sharing

Collect the smallest useful set of facts:

- Auto-Ontology version/release and deployment type (Compose or Helm), component affected, UTC time and timezone.
- Which public health/readiness check failed, HTTP status, and sanitized response body.
- Relevant service log window around failure, with trace/request ID if present; include exact error text and whether repeatable.
- For question failures: sanitized question, readiness result, whether SQL was emitted, and SQL error category. Remove customer terms, values, table/column names, hostnames, account IDs, and returned rows when confidential.
- For connection/model failures: connector/model family, endpoint host only where safe, and whether source/network/key test succeeded. Never include URL userinfo, query-string secrets, API keys, passwords, private keys, bearer tokens, session cookies, or unredacted connection strings.

Logs can contain SQL, source/database names, model prompts, or user-provided text. Review and redact before sharing. Do not enable verbose tracing or export customer data unless approved by your organization's data-handling policy. Avoid destructive “cleanup” commands, database resets, or re-ingestion attempts as first-line diagnostics.

For Docker Compose, inspect state and bounded logs without changing services:

```sh
docker compose ps
docker compose logs --tail=200 auto-ontology auto-ontology-frontend ingestion-service
```

For Kubernetes, inspect pod/job status and bounded logs in the correct namespace; avoid dumping Secrets or full environment variables:

```sh
kubectl get pods
kubectl get jobs
kubectl logs <pod-name> --since=30m
```

## Security reporting

Do not report vulnerabilities in public GitHub issues, discussions, or pull requests. Follow [SECURITY.md](../SECURITY.md) and report potential vulnerabilities privately through NVIDIA's [Security Vulnerability Submission Form](https://www.nvidia.com/object/submit-security-vulnerability.html) or `psirt@nvidia.com`. Include affected product/version, vulnerability type, reproduction steps, impact, and proof of concept where safe. Use NVIDIA's [PGP key](https://www.nvidia.com/en-us/security/pgp-key) for secure email. For ordinary bugs or usage questions, use the repository's public issue templates and omit secrets, internal hostnames, and customer data.
