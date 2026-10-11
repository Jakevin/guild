import type { ProviderEntry } from "@guild/protocol";

/**
 * One picker row. The gateway's auto route chooses the upstream model.
 * Kilo's public free pool: no key, and prompts may be logged upstream.
 */
export const FREE_PROVIDER_ID = "free";
export const FREE_MODEL_ID = "free";
export const FREE_UPSTREAM_MODEL = "kilo-auto/free";
export const FREE_BASE_URL = "https://api.kilo.ai/api/gateway";

const ALIASES = new Set(["free", "kilo-free", "kilo", "kilo_free"]);

export function isFreeProvider(id: string): boolean {
  return ALIASES.has(String(id || "").trim().toLowerCase());
}

export function freeProvider(): ProviderEntry {
  return {
    name: "Free",
    baseUrl: FREE_BASE_URL,
    api: "openai-completions",
    apiKey: "",
    models: [{ id: FREE_MODEL_ID, name: "Free" }],
  };
}

/** The picker id stays `free`. The wire id is the gateway's auto route. */
export function freeWireModel(providerId: string, model: string): string {
  return isFreeProvider(providerId) ? FREE_UPSTREAM_MODEL : model;
}
