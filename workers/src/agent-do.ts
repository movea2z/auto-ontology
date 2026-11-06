// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Durable Object that orchestrates the Auto-Ontology agent Container for a
// single session and relays its SSE stream back to the client.
//
// Why a DO per session:
//   - The agent runs a long, synchronous LangGraph loop. The DO keeps a warm
//     Container instance alive for the whole session (no mid-run teardown).
//   - The DO holds the run handle so the client can cancel via
//     POST /chat/cancel.
//   - The DO relays the container's text/event-stream response verbatim, so
//     streamed tokens reach the client without buffering.
//
// The durable_object scheduling policy lets this DO start/resume a named
// Container instance of a chosen size via ctx.container.start().

import { DurableObject, ContainerInstance } from "cloudflare:workers";
import { resolveIdentity, INTERNAL_USER_HEADER, ResolvedIdentity } from "./auth.js";

// ctx.container is provided by the runtime on the durable_object scheduling
// policy but is not yet in the published workers-types; declare the shape we use.
interface ContainerState {
  container: {
    start(options: {
      instance?: string;
      instance_type?: string;
      runtime?: string;
      enableInternet?: boolean;
      envVars?: Record<string, string>;
    }): Promise<void>;
    getByName(name: string): ContainerInstance;
  };
}

export class AgentDo extends DurableObject<Env> {
  // Per-session state.
  private instanceName = "default";
  private runHandle = { active: true };

  // The ctx.container namespace (runtime-provided; see ContainerState above).
  private get container() {
    return (this.ctx as unknown as ContainerState).container;
  }

  // Build the runtime env map for the agent Container from the Cloudflare
  // Secrets named in CONTAINER_ENV_SECRETS (comma-separated). The agent needs
  // these to run: the catalog DB connection and the LLM/prediction keys. They
  // are injected at start time, never baked into the image.
  private buildContainerEnv(): Record<string, string> {
    const names = (this.env.CONTAINER_ENV_SECRETS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const src = this.env as unknown as Record<string, string | undefined>;
    const envVars: Record<string, string> = {};
    for (const name of names) {
      const value = src[name];
      if (value === undefined || value === "") {
        console.warn(`AgentDo: secret ${name} not set; omitting from container env`);
        continue;
      }
      envVars[name] = value;
    }
    return envVars;
  }

  // Ensure a named Container instance exists and is ready, then return its
  // fetch handle. Idempotent: starting an already-running instance is a no-op.
  private async getInstance(): Promise<ContainerInstance> {
    await this.container.start({
      instance: this.instanceName,
      instance_type: this.env.CONTAINER_INSTANCE_TYPE,
      // Egress for the agent's LLM/embedding + Kumo prediction calls (Phase 3
      // task 13). The Python agent reaches NVAPI and Kumo over the public
      // internet; leave false to keep the container fully sandboxed.
      enableInternet: this.env.CONTAINER_ENABLE_INTERNET !== "false",
      envVars: this.buildContainerEnv(),
    });
    return this.container.getByName(this.instanceName);
  }

  // Build the upstream request to the agent, injecting the internal identity.
  private buildUpstreamRequest(request: Request, identity: ResolvedIdentity): Request {
    const url = new URL(request.url);
    url.host = "127.0.0.1";
    url.port = String(this.env.AGENT_PORT);
    url.protocol = "http";

    const headers = new Headers(request.headers);
    headers.set(INTERNAL_USER_HEADER, identity.userId);
    if (identity.ssoToken) {
      headers.set("authorization", `Bearer ${identity.ssoToken}`);
    }

    return new Request(url.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });
  }

  // Route the client request to the agent Container, relaying the SSE stream.
  async fetch(request: Request): Promise<Response> {
    const identity = resolveIdentity(request, this.env);
    if (!identity) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // POST /chat/cancel — stop the active run.
    if (request.method === "POST" && path.endsWith("/chat/cancel")) {
      this.runHandle.active = false;
      return new Response("Cancelled", { status: 200 });
    }

    // Any other request is proxied to the agent Container.
    const instance = await this.getInstance();
    const upstream = this.buildUpstreamRequest(request, identity);

    // start() does not wait for the container's ports to be ready, so the first
    // fetch can race the boot and throw a connection error. Retry a few times
    // with backoff while the container warms up. Once fetch() returns a Response
    // (including a streaming SSE body) we return it immediately — no retry — so a
    // live stream is never duplicated.
    return this.fetchWithWarmup(instance, upstream);
  }

  private async fetchWithWarmup(
    instance: ContainerInstance,
    upstream: Request,
    retries = 5,
  ): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await instance.fetch(upstream);
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }
    console.error("AgentDo: container fetch failed after warm-up", lastErr);
    return new Response("Bad Gateway", { status: 502 });
  }
}
