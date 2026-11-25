<!--
SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Deployment guide

Auto-Ontology runs as frontend, FastAPI backend, ingestion worker, and PostgreSQL with pgvector. Treat deployment as a coordinated application-and-database release. For supported Kubernetes installation commands, use the authoritative [Helm deployment guide](../DEPLOYMENT.md); this page covers operational choices and risks, not a second install recipe.

## Choose deployment path

- **Kubernetes:** official production-oriented distribution is published Helm chart `nvidia/auto-ontology` in NGC. See [DEPLOYMENT.md](../DEPLOYMENT.md) for release artifacts, install, required bootstrap admin, and access steps. Chart templates and supported settings live in [`helm/auto-ontology`](../helm/auto-ontology/).
- **Docker Compose:** repository `docker-compose.yml` is a convenient local stack and reference for service ordering. README [Quickstart](../README.md#quickstart) contains full setup. Compose publishes app, backend, ingestion, PostgreSQL, and pgAdmin ports on host; do not expose this development-oriented configuration directly to untrusted networks.
- **Cloudflare:** [`workers/`](../workers/) is a prototype, not production-ready. The rewrite plan documents unresolved compatibility and validation blockers; do not use it as production deployment path.

## Configuration and secrets

Configure model endpoint/key/model triplets through `DEFAULT_MODELS_*` and optional per-role `REASONING_*`, `NON_REASONING_*`, `EMBED_*`, and `RERANK_*` variables. See [README model configuration](../README.md#nvidia-nim) and `.env.example` for names and defaults. Keep embedding model/dimension consistent between ingestion and retrieval.

Set `APP_URL` to exact public frontend origin; authentication callbacks and CSRF checks depend on it. Set `AUTH_SECRET` to a strong, persistent value shared by frontend replicas. Changing it invalidates sessions and can break auth flows. Set bootstrap admin credentials before first deployment; self-service sign-up is disabled. Use a distinct, strong Postgres password. Choose one source-database configuration per deployment: when `CONNECTION_STRINGS` is set, ingestion prefers it, but question answering prefers UI-managed connections whenever any exist; mismatched sources can make ingested metadata differ from queryable connections. See [connections and Vault](connections.md) for behavior and credential storage.

Never commit `.env`, secret values files, rendered manifests, or backups containing credentials. Restrict file permissions; avoid shell arguments/history and CI logs. For Kubernetes production, prefer an external secret manager/operator and disable chart `bundledSecret` so chart values do not become the secret-delivery mechanism. Kubernetes Secrets need cluster-side encryption-at-rest and least-privilege RBAC. Keep registry pull credentials separate. Preserve `AUTH_SECRET` across upgrades and restore.

## Network trust boundaries

Route user traffic through frontend on port 3000 (normally behind TLS-terminating ingress/load balancer). Backend port 3001 and ingestion port 3002 are internal-only. Backend trusts frontend-supplied `x-auto-ontology-user-id`; ingestion operations have no independent authentication. Direct exposure permits identity spoofing or unauthenticated ingestion/reset actions. Restrict network policies/firewalls to frontend-to-backend and backend-to-ingestion paths. PostgreSQL 5432 and pgAdmin 5050/80 are not public application endpoints; restrict them to operators and application workloads. Enforce TLS on external database/model connections where supported.

## Database migrations and upgrades

Backend Alembic owns the `public` schema; frontend Prisma owns `frontend`. Both migration steps must complete successfully against the target database before application pods serve traffic. Compose defines one-shot `auto-ontology-migrate` and `frontend-migrate` services. Helm runs corresponding migration Jobs and gates workloads on expected schema revisions. Do not bypass failed migration jobs or run old application images against a newer schema without checking compatibility.

Take a consistent database backup before upgrades and verify restore procedure. Migration changes can be destructive or irreversible; inspect release notes and migration scripts. Prisma migration guard may truncate legacy `frontend.conversation_analytics` rows if table predates required `user_id` column. Plan accordingly and preserve a backup. Database restore is the reliable rollback for incompatible schema/data changes; application rollback alone does not reverse migrations. Keep backend and frontend migrations independently accounted for.

## Health and availability

Backend `/api/health/live` reports process liveness; `/api/health` checks readiness including database connectivity. Do not use readiness as liveness: database outage cannot be fixed by restarting application process. Ingestion exposes `/health/live` for liveness and `/health` for readiness. Helm probes and Compose dependencies encode startup ordering, not a substitute for monitoring. Alert on failed migration Jobs, unavailable Postgres, repeated restarts, and readiness failures; check database capacity, persistent volume status, and logs before restarting.

Chart defaults use one replica per application component and bundled PostgreSQL with persistent storage. Review resource requests/limits, storage class, capacity, backup/restore, ingress/TLS, scheduling, and scaling against workload before production use. PostgreSQL high availability and backup lifecycle require an explicit operational design.

## Rollback

Pin chart and image versions; record deployed values (without secrets) and database migration state. For Kubernetes, inspect Helm release history before using Helm rollback. Rollback may restore old application images but does not undo Alembic/Prisma schema changes or restore deleted data. Confirm old version remains compatible with current schema; otherwise restore database backup and coordinate application rollback. For Compose, deploy prior image/build revision only after checking schema compatibility. Do not delete persistent volumes as a rollback step.

## Authoritative references

- [Official Helm installation and release artifacts](../DEPLOYMENT.md)
- [README quickstart and configuration](../README.md#quickstart)
- [Helm chart values and templates](../helm/auto-ontology/)
- [Connections and credential storage](connections.md)
- [Cloudflare prototype rewrite plan and blockers](../CLOUDFLARE-REWRITE-PLAN.md)
