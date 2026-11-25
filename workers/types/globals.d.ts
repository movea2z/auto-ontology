// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Global Env type for the Auto-Ontology agent gateway Worker.
//
// Wrangler normally generates this from wrangler.toml `[vars]` and bindings.
// It is declared here so the Worker typechecks without a wrangler build. Keep
// the members in sync with wrangler.toml.

interface Env {
  AGENT_DO: DurableObjectNamespace<unknown>;
  CONTAINER_INSTANCE_TYPE: string;
  CONTAINER_ENABLE_INTERNET: string;
  AGENT_PORT: string;
  CLOUDFLARE_AGENT_SECRET?: string;
  CONTAINER_ENV_SECRETS: string;
}
