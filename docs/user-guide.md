<!--
SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# User guide

Auto-Ontology builds a semantic layer over connected databases, then uses that layer to answer natural-language questions. This guide covers the browser workflow; deployment and API details live in the linked references.

## Sign in

Open your deployment URL and sign in with the account provided by your administrator. Self-service sign-up is disabled. The first account is provisioned from the deployment's bootstrap admin settings; administrators can invite additional users from **Settings → Users**. Invitations create a one-time link; an administrator copies and sends it to the invitee.

Deployments may also offer **Sign in with SSO** when an administrator configured an identity provider. See [Authentication, SSO, and API tokens](./authentication.md) for SSO and API token details. For a first local setup, follow the [Quickstart](../README.md#quickstart); for deployment options, see the [deployment guide](./deployment-guide.md).

## Connect data and build the semantic layer

An administrator connects source databases and starts ingestion. The web interface exposes **Settings → Connections** when sources are UI-managed. A connection can be tested before saving; use credentials and source details supplied by your database administrator. UI-managed connections support schema allowlists and table allow/deny filters.

Deployments can instead provide source URLs through `CONNECTION_STRINGS`. In that case connections are managed at deployment time, and Settings navigation does not offer the Connections page. Do not mix the two approaches: question answering prefers UI connections when present, while ingestion prefers `CONNECTION_STRINGS` whenever it is set. See [Connections and credential storage](./connections.md) for supported engines, filtering behavior, and credential storage.

Ingestion extracts schemas and profiles data; semantic compilation builds terms, column mappings, relationships, and SQL attributes. With the Quickstart deployment, ingestion runs at startup. Semantic compilation must be enabled by an administrator under **Settings → Semantic Compilation**; completion is reported as **Semantic compilation is ready**. A compiled semantic layer and a live source connection are both needed to run questions. A catalog can remain after its original connection is gone, so a visible catalog alone does not prove that SQL can execute.

For installation, configuration, and operational procedures, use the [Quickstart](../README.md#quickstart), [deployment guide](./deployment-guide.md), and [connection guide](./connections.md); this guide does not duplicate deployment commands.

## Discover and manage ontology

Open **Terms** to browse the generated business concepts. Search the terms list, then open a term to inspect its name, description, synonyms, mapped column attributes, related terms, SQL attributes, and certification status. The semantic graph and an example selected term are shown in the [project overview](../README.md#how-it-works).

Users with catalog edit permission can refine term and attribute details. Open the relevant term or attribute and choose **Edit** where available; save the changes. For SQL attributes, validate an edited SQL expression before saving. Certification indicators help distinguish reviewed names, descriptions, and attributes from draft content. Certify a definition only after checking that it reflects the intended business meaning and SQL behavior. Controls vary with the account's permissions and the item being viewed.

Use **Discovery** to search catalog data and narrow results with the available filters. Treat generated terms and relationships as suggestions to review against domain knowledge, not as automatically approved definitions. Use **Settings → Import / Export** when exchanging models; see [Apache Ossie compatibility](../README.md#how-it-works) for the format overview.

## Ask questions and validate answers

Open **Chat**, enter a specific natural-language question, and submit it. Include the metric or entity, relevant filters, and time period. Follow-up questions can refer to the active conversation. The agent shows progress while it works, then returns a prose answer with SQL and query results; where generated, it also displays a chart. Question runs can take tens of seconds.

Validate an answer before relying on it:

1. Check whether the selected terms and filters match the wording and intended business definition.
2. Inspect the generated SQL and verify joins, date boundaries, aggregation, and filter values.
3. Compare returned rows or totals with source data or a trusted report. Use the result table and chart as views of the query output, not independent validation.
4. If a definition or query is wrong, refine the relevant term, mapping, or SQL attribute (with catalog edit access), then ask again.

The agent validates generated SQL and can repair it when checks fail, but this does not replace business review. If no suitable semantic definition or source data exists, clarify the question or connect the missing source rather than treating an unsupported answer as a reliable result. See the [question-answering overview](../README.md#how-it-works) and the [conversation API guide](./conversation-api.md) for result and streaming details.

## Use Auto-Ontology through MCP

An MCP-capable client can ask questions and inspect ontology context through the read-only MCP server. Configure the client with the MCP endpoint supplied by your administrator, then complete the Auto-Ontology sign-in flow when prompted. Each MCP call uses the signed-in user's permissions; do not share a client session or token as a way to grant access to another user.

A practical sequence is: check deployment readiness, search relevant terms, inspect term or table context, check whether the question is answerable, then ask it. The MCP tools include `check_readiness`, `search_terms`, `get_term`, `get_term_columns`, `get_term_sql_attributes`, `get_sql_attribute`, `describe_table`, `check_answerable`, and `ask_question`. These tools read ontology and query data; they do not edit the catalog or underlying databases. See the [MCP guide](./mcp.md) for setup, tool behavior, and troubleshooting.

## Accounts and permissions

Auto-Ontology has two account roles:

- **Admin** can manage connections and settings, edit the catalog, manage users, and use viewer capabilities.
- **Viewer** can read catalog information and ask questions, but cannot manage connections or edit ontology definitions.

Permissions apply to browser, API-token, and MCP requests according to the owning or signed-in user's role. Some screens or actions will be unavailable without the required permission. An administrator can invite a user or change another account's role in **Settings → Users**; self-service account creation is disabled. API tokens are user-bound credentials, not separate roles. See [Authentication, SSO, and API tokens](./authentication.md) for token handling and [access.json](../frontend/auth/access.json) for the role permission matrix.
