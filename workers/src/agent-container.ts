// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Container lifecycle class for the Auto-Ontology LangGraph agent.
//
// The agent runs an arbitrary-length synchronous LangGraph loop (tool calls,
// MCP round-trips, multi-step reasoning). The default Container `sleepAfter`
// (10 minutes of inactivity) is too short for a HITL "awaiting human" pause,
// so we raise it and make onActivityExpired a no-op so a warm instance is kept
// for the duration of a session rather than being torn down mid-conversation.
//
// This class is referenced by `[[containers]] class_name = "AgentContainer"`
// in wrangler.toml and is exported so the durable-object scheduler can manage
// its instances.

import { Container } from "cloudflare:workers";

// Raise the inactivity timeout to 30 minutes. A session is expected to finish
// well within this window; the DO also pings the instance to keep it warm.
export const CONTAINER_SLEEP_AFTER_MS = 30 * 60 * 1000;

export class AgentContainer extends Container {
  // Inactivity timeout before Cloudflare would otherwise stop the instance.
  sleepAfter = CONTAINER_SLEEP_AFTER_MS;

  // Runs after the container process is up and its port is accepting traffic.
  // Use it to log readiness / warm the agent's model cache.
  async onStart() {
    console.log("AgentContainer: started");
  }

  // Runs when the container process exits.
  async onStop(exitCode: number, reason: string) {
    console.log(`AgentContainer: stopped (code=${exitCode}, reason=${reason})`);
  }

  // Runs when the `sleepAfter` timer expires with no incoming requests.
  // Override to keep the instance warm for the session instead of stopping it.
  async onActivityExpired() {
    // Keep the instance alive; the DO drives lifecycle per session and will
    // stop the instance explicitly when the session ends.
    console.log("AgentContainer: activity expired, keeping warm");
  }

  // Runs when startup or port-checking fails.
  async onError(error: unknown) {
    console.error("AgentContainer: startup error", error);
  }
}
