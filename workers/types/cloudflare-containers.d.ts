// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Ambient declarations for the Cloudflare Container API.
//
// The published @cloudflare/workers-types package (5.20261104.1) predates the
// Container lifecycle surface, so these types are declared locally against the
// runtime API. They mirror the documented Container API:
//   https://developers.cloudflare.com/containers/api/container-class/
//
// Import from "cloudflare:workers" in application code.

declare module "cloudflare:workers" {
  // Base class you extend to define Container lifecycle hooks. The runtime
  // also provides instance-level methods (start/monitor/getTcpPort/...) on the
  // running instance; those are omitted here since the hooks class is only
  // extended, never instantiated directly.
  export class Container {
    // Inactivity timeout (ms) before Cloudflare stops the instance.
    sleepAfter: number;

    // Runs after the container process is up and its port accepts traffic.
    onStart(): Promise<void>;
    // Runs after the container process exits.
    onStop(exitCode: number, reason: string): Promise<void>;
    // Runs when the sleepAfter timer expires with no incoming requests.
    onActivityExpired(): Promise<void>;
    // Runs when startup or port-checking fails.
    onError(error: unknown): Promise<void>;
  }

  // A handle to a single Container instance. Call fetch() to proxy a request.
  export interface ContainerInstance {
    fetch(request: Request): Promise<Response>;
    readonly name: string;
    readonly running: boolean;
  }

  // The container namespace available on a Durable Object's ctx under the
  // durable_object scheduling policy.
  export interface ContainerNamespace {
    start(options: {
      instance?: string;
      instance_type?: string;
      runtime?: string;
      enableInternet?: boolean;
      envVars?: Record<string, string>;
    }): Promise<void>;
    getByName(name: string): ContainerInstance;
    get(id: string): ContainerInstance;
    list(): ContainerInstance[];
  }
}
