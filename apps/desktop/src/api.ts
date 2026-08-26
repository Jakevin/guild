import { DEFAULT_GUILD_HOST, DEFAULT_GUILD_PORT } from "@guild/protocol";
import type { BenchListing, HealthResponse } from "@guild/protocol";

/** Loopback Guild daemon. Vite proxies the same paths in `vite.config.ts`. */
export const DAEMON_ORIGIN = `http://${DEFAULT_GUILD_HOST}:${DEFAULT_GUILD_PORT}`;

function origin(): string {
  if (import.meta.env.DEV && typeof window !== "undefined") {
    return window.location.origin;
  }
  return DAEMON_ORIGIN;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${origin()}/health`);
  if (!response.ok) {
    throw new Error(`health failed: ${response.status}`);
  }
  return (await response.json()) as HealthResponse;
}

export async function fetchBench(): Promise<BenchListing> {
  const response = await fetch(`${origin()}/bots`);
  if (!response.ok) {
    throw new Error(`bench failed: ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new Error("bench listing is not a JSON array");
  }
  return body as BenchListing;
}
