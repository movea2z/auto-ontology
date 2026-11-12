// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Shared helpers for the Next route handlers that forward requests to the
// Phase-3 Container gateway — the Cloudflare Worker that fronts the agent
// Container and streams tokens. This replaces the old `PYTHON_API_URL`
// (`http://127.0.0.1:3001`) hop: the handlers no longer need to know or care
// whether the upstream is the legacy FastAPI in local dev or the Worker
// gateway in production — only the target path and the headers to preserve.

// Legacy FastAPI hop. Kept as the default so local `pnpm dev` still works; the
// Cloudflare deployment sets AGENT_GATEWAY_URL to the deployed Worker gateway.
const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:3001';

// Base URL of the Container gateway. Trailing slash is normalized away so
// callers can append an absolute path verbatim.
export function containerGatewayUrl(): string {
	const url = (process.env.AGENT_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
	if (!url) throw new Error('AGENT_GATEWAY_URL is set but empty');
	return url;
}

export interface ContainerForward {
	/** Absolute request path on the gateway, e.g. `/api/chat/completions`. */
	path: string;
	method?: string;
	/** Already-serialized request body. */
	body?: string;
	/** Extra request headers (internal identity, SSO subject, ...). */
	headers?: Record<string, string>;
	/** `Accept` header; defaults to `application/json`. */
	accept?: string;
}

// Forwards one request to the Container gateway and returns the upstream
// Response unchanged. Callers decide whether to stream it (SSE) or read it.
export async function forwardToContainer(req: ContainerForward): Promise<Response> {
	const init: RequestInit = {
		method: req.method ?? 'GET',
		headers: { Accept: req.accept ?? 'application/json', ...(req.headers ?? {}) },
	};
	if (req.body !== undefined) {
		init.body = req.body;
		// @ts-expect-error — `duplex` is an undici/Node RequestInit field, not in
		// the DOM `RequestInit` lib bundled here; required to stream request bodies.
		init.duplex = 'half';
	}
	return fetch(`${containerGatewayUrl()}${req.path}`, init);
}

// SSE response headers. Identical to the previous handlers so the browser keeps
// the connection open and does not buffer the token stream.
export const SSE_RESPONSE_HEADERS: Record<string, string> = {
	'Content-Type': 'text/event-stream; charset=utf-8',
	'Cache-Control': 'no-cache, no-transform',
	Connection: 'keep-alive',
	'X-Accel-Buffering': 'no',
};
