// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Per-user Durable Object: starts the Python API Container and streams its
// responses without buffering.

import { DurableObject } from "cloudflare:workers";
import { resolveIdentity, INTERNAL_USER_HEADER, GATEWAY_SECRET_HEADER } from "./auth.js";

interface ContainerState {
  container: {
    running: boolean;
    images: Record<string, string>;
    start(options: {
      image: string;
      instance?: string;
      enableInternet: boolean;
      env?: Record<string, string>;
    }): void;
    getTcpPort(port: number): {
      fetch(request: Request): Promise<Response>;
    };
  };
}

export class AgentDo extends DurableObject<Env> {
  private startPromise: Promise<void> | null = null;
  private readyPromise: Promise<void> | null = null;
  private containerReady = false;

  private get container() {
    return (this.ctx as unknown as ContainerState).container;
  }

  private buildContainerEnv(): Record<string, string> {
    const names = (this.env.CONTAINER_ENV_SECRETS ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => /^[A-Z][A-Z0-9_]*$/.test(name) && name !== "CLOUDFLARE_AGENT_SECRET");
    const bindings = this.env as unknown as Record<string, string | undefined>;
    const values: Record<string, string> = {};
    for (const name of names) {
      const value = bindings[name];
      if (value !== undefined && value !== "") values[name] = value;
    }
    return values;
  }

  private async startContainer(): Promise<void> {
    const container = this.container;
    if (!container.running && this.containerReady) {
      this.startPromise = null;
      this.readyPromise = null;
      this.containerReady = false;
    }
    if (!container.running && !this.startPromise) {
      this.startPromise = Promise.resolve(
        container.start({
          image: container.images.base,
          instance: this.env.CONTAINER_INSTANCE_TYPE || "standard-1",
          enableInternet: this.env.CONTAINER_ENABLE_INTERNET !== "false",
          env: this.buildContainerEnv(),
        }),
      ).catch((error: unknown) => {
        this.startPromise = null;
        throw error;
      });
    }
    await this.startPromise;
  }

  private async waitForReady(port: number): Promise<void> {
    const fetcher = this.container.getTcpPort(port);
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetcher.fetch(new Request("http://container/api/health/live"));
        if (response.ok) return;
        await response.body?.cancel();
      } catch {
        // Container process is still starting or its port is not ready.
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Python Container did not become ready within 60 seconds");
  }

  async fetch(request: Request): Promise<Response> {
    const identity = await resolveIdentity(request, this.env);
    if (!identity) return new Response("Unauthorized", { status: 401 });

    const url = new URL(request.url);
    const port = Number(this.env.AGENT_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return new Response("Gateway misconfigured", { status: 500 });
    }

    try {
      await this.startContainer();
      if (!this.readyPromise) {
        this.readyPromise = this.waitForReady(port).catch((error: unknown) => {
          this.startPromise = null;
          this.containerReady = false;
          this.readyPromise = null;
          throw error;
        });
      }
      await this.readyPromise;
      this.containerReady = true;

      const headers = new Headers(request.headers);
      headers.delete(GATEWAY_SECRET_HEADER);
      headers.set(INTERNAL_USER_HEADER, identity.userId);
      const upstream = new Request(`http://container${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      });
      return await this.container.getTcpPort(port).fetch(upstream);
    } catch (error) {
      console.error(JSON.stringify({
        message: "Container gateway request failed",
        error: error instanceof Error ? error.message : String(error),
        path: url.pathname,
      }));
      return new Response("Bad Gateway", { status: 502 });
    }
  }
}
