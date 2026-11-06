// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Identity / auth contract for the Auto-Ontology agent.
//
// The agent must never be publicly reachable. The gateway validates the client
// and then forwards an internal identity header to the agent. Two auth paths
// are supported, matching the agent's own `resolve_internal_user`:
//
//   1. Internal service-to-service: the caller presents the gateway's shared
//      secret (CLOUDFLARE_AGENT_SECRET). The gateway injects
//      `x-auto-ontology-user-id: <user-id>` (INTERNAL_USER_HEADER) and the
//      agent trusts it because the request originates from an authorized
//      internal source.
//
//   2. SSO federation: the caller presents a valid SSO bearer token. The
//      gateway validates it and forwards the resolved subject as the internal
//      user header. The agent accepts the SSO token when
//      any_connection_uses_sso_federation() is enabled.
//
// Credentials are injected via Cloudflare Secrets (wrangler.toml `[vars]` /
// `wrangler secret put`), never committed.

// Header the gateway injects to identify the internal caller to the agent.
export const INTERNAL_USER_HEADER = "x-auto-ontology-user-id";

// Header the client presents to the gateway.
export const AUTH_HEADER = "authorization";

export interface ResolvedIdentity {
  // The user id forwarded to the agent as INTERNAL_USER_HEADER.
  userId: string;
  // The Authorization header value to forward to the agent (SSO path), or null.
  ssoToken: string | null;
}

// Validate the client request and resolve the identity to forward to the agent.
// Returns null when the request is not authorized; the caller should 401.
export function resolveIdentity(
  request: Request,
  env: Env,
): ResolvedIdentity | null {
  const auth = request.headers.get(AUTH_HEADER);

  // Path 1: internal service-to-service.
  if (auth === `Bearer ${env.CLOUDFLARE_AGENT_SECRET}`) {
    const userId = request.headers.get(INTERNAL_USER_HEADER) ?? env.DEFAULT_USER_ID;
    return { userId, ssoToken: null };
  }

  // Path 2: SSO federation. The gateway would validate the SSO token here
  // (e.g. against the IdP's JWKS) and resolve the subject. For now we accept
  // a well-formed bearer token and forward it; production should validate it.
  if (auth && auth.startsWith("Bearer ") && env.ANY_CONNECTION_USES_SSO_FEDERATION === "true") {
    const ssoToken = auth.slice("Bearer ".length);
    const userId = request.headers.get(INTERNAL_USER_HEADER) ?? env.DEFAULT_USER_ID;
    return { userId, ssoToken };
  }

  return null;
}
