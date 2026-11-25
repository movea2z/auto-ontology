// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Auto-Ontology API gateway. Authenticates frontend-server requests, routes
// by trusted user identity, and streams Container responses.
//
// Routes:
//   /api/*       -> per-user Durable Object -> Python FastAPI
//   GET /health  -> unauthenticated liveness check

import { resolveIdentity } from "./auth.js";
export { AgentDo } from "./agent-do.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response("ok", { status: 200 });
    }
    if (
      !url.pathname.startsWith("/api/") ||
      !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)
    ) {
      return new Response("Not found", { status: 404 });
    }

    const identity = await resolveIdentity(request, env);
    if (!identity) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "www-authenticate": "Bearer" },
      });
    }

    // A single container per authenticated user keeps all of that user's API
    // and chat requests together while preventing caller-selected session IDs
    // from routing requests into another user's Durable Object.
    const doId = env.AGENT_DO.idFromName(JSON.stringify([identity.userId]));
    return env.AGENT_DO.get(doId).fetch(request);
  },
} satisfies ExportedHandler<Env>;
