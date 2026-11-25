// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Shared helpers for the Next route handlers that forward requests to the
// Phase-3 Container gateway — the Cloudflare Worker that fronts the agent
// Container and streams tokens. This replaces the old `PYTHON_API_URL`
// (`http://127.0.0.1:3001`) hop: the handlers no longer need to know or care
// whether the upstream is the legacy FastAPI in local dev or the Worker
// gateway in production — only the target path and the headers to preserve.

// Legacy FastAPI hop. Kept as the default so local `pnpm dev` still works.
const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:3001';
const GATEWAY_SECRET_HEADER = 'x-auto-ontology-gateway-secret';

type GatewayBindings = {
	AGENT_GATEWAY_URL?: string;
	CLOUDFLARE_AGENT_SECRET?: string;
};

async function gatewayBindings(): Promise<GatewayBindings | null> {
	try {
		// Cloudflare-only module cannot be statically imported by local Next.js.
		const { env } = await import('cloudflare:workers');
		return env as GatewayBindings;
	} catch {
		return null;
	}
}

export async function gatewayEnabled(): Promise<boolean> {
	const bindings = await gatewayBindings();
	const configuredUrl = bindings?.AGENT_GATEWAY_URL ?? process.env.AGENT_GATEWAY_URL;
	if (bindings && !configuredUrl) {
		throw new Error('AGENT_GATEWAY_URL is required in the Cloudflare Worker');
	}
	return configuredUrl !== undefined;
}

// Base URL of the Container gateway. Trailing slash is normalized away so
// callers can append an absolute path verbatim.
export async function containerGatewayUrl(): Promise<string> {
	const bindings = await gatewayBindings();
	const configuredUrl = bindings?.AGENT_GATEWAY_URL ?? process.env.AGENT_GATEWAY_URL;
	if (bindings && !configuredUrl) {
		throw new Error('AGENT_GATEWAY_URL is required in the Cloudflare Worker');
	}
	const url = (configuredUrl ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
	if (!url) throw new Error('AGENT_GATEWAY_URL is set but empty');
	return url;
}

async function gatewaySecret(): Promise<string | undefined> {
	const bindings = await gatewayBindings();
	return bindings?.CLOUDFLARE_AGENT_SECRET ?? process.env.CLOUDFLARE_AGENT_SECRET;
}

async function gatewayAuthHeaders(url: string): Promise<Record<string, string>> {
	const parsedUrl = new URL(url);
	const isLocal =
		parsedUrl.hostname === '127.0.0.1' ||
		parsedUrl.hostname === 'localhost' ||
		parsedUrl.hostname === '::1';
	if (isLocal && !(await gatewayEnabled())) return {};
	if (!isLocal && parsedUrl.protocol !== 'https:') {
		throw new Error('The agent gateway must use HTTPS outside local development');
	}
	const secret = await gatewaySecret();
	if (!secret) {
		throw new Error('CLOUDFLARE_AGENT_SECRET is required for the agent gateway');
	}
	return { [GATEWAY_SECRET_HEADER]: secret };
}

export interface ContainerForward {
	/** Absolute request path on the gateway, e.g. `/api/chat/completions`. */
	path: string;
	method?: string;
	/** Request body forwarded without buffering. */
	body?: string | ReadableStream<Uint8Array>;
	/** Extra request headers (internal identity, SSO subject, ...). */
	headers?: Record<string, string>;
	/** `Accept` header; defaults to `application/json`. */
	accept?: string;
}

// Forwards one request to the Container gateway and returns the upstream
// Response unchanged. Callers decide whether to stream it (SSE) or read it.
export async function forwardToContainer(req: ContainerForward): Promise<Response> {
	const url = await containerGatewayUrl();
	const init: RequestInit = {
		method: req.method ?? 'GET',
		headers: {
			Accept: req.accept ?? 'application/json',
			...(req.headers ?? {}),
			...(await gatewayAuthHeaders(url)),
		},
	};
	if (req.body !== undefined) {
		init.body = req.body;
		// @ts-expect-error — `duplex` is an undici/Node RequestInit field, not in
		// the DOM `RequestInit` lib bundled here; required to stream request bodies.
		init.duplex = 'half';
	}
	return fetch(`${url}${req.path}`, init);
}

// SSE response headers. Identical to the previous handlers so the browser keeps
// the connection open and does not buffer the token stream.
export const SSE_RESPONSE_HEADERS: Record<string, string> = {
	'Content-Type': 'text/event-stream; charset=utf-8',
	'Cache-Control': 'no-cache, no-transform',
	Connection: 'keep-alive',
	'X-Accel-Buffering': 'no',
};
