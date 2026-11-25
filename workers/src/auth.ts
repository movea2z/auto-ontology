// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Identity and gateway-auth contract shared with the frontend server proxy.
//
// The gateway secret authenticates the trusted proxy. Authorization is kept
// for the agent's optional SSO subject token and never authenticates the gateway.

export const INTERNAL_USER_HEADER = "x-auto-ontology-user-id";
export const GATEWAY_SECRET_HEADER = "x-auto-ontology-gateway-secret";

export interface ResolvedIdentity {
  userId: string;
}

async function sameSecret(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

export async function resolveIdentity(
  request: Request,
  env: Env,
): Promise<ResolvedIdentity | null> {
  const expected = env.CLOUDFLARE_AGENT_SECRET;
  const provided = request.headers.get(GATEWAY_SECRET_HEADER);
  if (!expected || !provided || !(await sameSecret(provided, expected))) {
    return null;
  }

  const userId = request.headers.get(INTERNAL_USER_HEADER);
  if (
    !userId ||
    userId.length > 256 ||
    userId.trim() !== userId ||
    /[\u0000-\u001f\u007f]/.test(userId)
  ) {
    return null;
  }

  return { userId };
}
