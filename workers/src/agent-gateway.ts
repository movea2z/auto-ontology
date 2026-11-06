// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Auto-Ontology agent gateway Worker.
//
// Entry point. It authenticates the client, derives a per-session Durable
// Object id, and forwards the request to that DO, which relays the agent
// Container's SSE stream.
//
// Routing:
//   POST /chat/completions  -> DO (SSE stream)
//   POST /chat/watch        -> DO (reconnect)
//   POST /chat/cancel       -> DO (cancel run)
//   GET  /health            -> 200 (no DO needed)

import { resolveIdentity, AUTH_HEADER } from "./auth.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Public health check — no auth, no DO.
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // Authenticate the client.
    const identity = resolveIdentity(request, env);
    if (!identity) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "www-authenticate": "Bearer" },
      });
    }

    // Derive a per-session DO id from the session id (or a generated one).
    const sessionId = url.searchParams.get("sessionId") ?? identity.userId;
    const doId = env.AGENT_DO.idFromName(sessionId);

    // Forward to the DO, which manages the Container instance and relays SSE.
    const doStub = env.AGENT_DO.get(doId);
    return doStub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
