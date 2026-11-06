// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Global Env type for the Auto-Ontology agent gateway Worker.
//
// Wrangler normally generates this from wrangler.toml `[vars]` and bindings.
// It is declared here so the Worker typechecks without a wrangler build. Keep
// the members in sync with wrangler.toml.

interface Env {
  // Durable Object binding: the session coordinator.
  AGENT_DO: DurableObjectNamespace<unknown>;

  // Container instance size for the agent (lite, standard-1, standard-2, standard-4).
  CONTAINER_INSTANCE_TYPE: string;
  // Whether the agent Container may reach the public internet (egress for LLM,
  // embedding, and Kumo prediction calls). "false" sandboxes it.
  CONTAINER_ENABLE_INTERNET: string;
  // Agent HTTP port inside the container.
  AGENT_PORT: string;
  // Default user id when the caller does not supply one.
  DEFAULT_USER_ID: string;
  // Enable SSO-federation auth path on the agent.
  ANY_CONNECTION_USES_SSO_FEDERATION: string;
  // Shared secret the client presents to the gateway (internal path).
  CLOUDFLARE_AGENT_SECRET: string;
  // Comma-separated Cloudflare Secret names forwarded into the agent Container.
  CONTAINER_ENV_SECRETS: string;
}
