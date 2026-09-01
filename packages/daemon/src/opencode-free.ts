import type { ModelEntry, ProviderEntry } from "@guild/protocol";
import { guildUserAgent } from "./version.ts";

/** Built-in alias `free` → this provider, matching Hermes Agent (2026-08). */
export const OPENCODE_FREE_PROVIDER_ID = "opencode-free";
export const OPENCODE_FREE_BASE_URL = "https://opencode.ai/zen/v1";

const ALIASES = new Set(["opencode-free", "free", "opencode_free"]);

/**
 * Offline floor — Hermes Agent's curated catalog.
 * Live GET /zen/v1/models is the source of truth when reachable.
 * Known-delisted slugs must not stay here (they 401 keyless).
 */
export const OPENCODE_FREE_FLOOR = [
  "laguna-s-2.1-free",
  "mimo-v2.5-free",
  "nemotron-3.5-lightning-free",
  "nemotron-3-ultra-free",
  "muse-spark-1.2-contributor-free",
  "ling-3.0-flash-fin-free",
  "deepseek-v4-flash-free",
] as const;

/** Default pick — user-facing Guild default, routed to `/v1/responses`. */
export const OPENCODE_FREE_DEFAULT_MODEL = "muse-spark-1.2-contributor-free";

/**
 * Hermes `opencode_model_api_mode`: Muse Spark on Zen/Go is Responses-only.
 * `/v1/chat/completions` 500s; `/v1/responses` completes.
 */
export function usesZenResponses(model: string): boolean {
  return String(model || "")
    .trim()
    .toLowerCase()
    .startsWith("muse-spark");
}

/** Free slugs that do not end in `-free` (OpenCode's rotating stealth slot). */
const EXTRA_SLUGS = new Set(["big-pickle"]);

/** `-free` suffix but KEYED (Go subscription), not anonymous. */
const KEYED_FREE_SUFFIX = new Set(["ox-alpha-free"]);

export function isKeylessProvider(id: string): boolean {
  return ALIASES.has(String(id || "").trim().toLowerCase());
}

export function prettyOpenCodeFreeName(id: string): string {
  const bare = String(id || "").trim().split("/").pop() || String(id || "");
  const slug = bare.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  if (!slug) return id;
  return slug.replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
}

export function openCodeFreeModels(ids: readonly string[] = OPENCODE_FREE_FLOOR): ModelEntry[] {
  return ids.map((id) => ({ id, name: prettyOpenCodeFreeName(id) }));
}

export function openCodeFreeProvider(): ProviderEntry {
  return {
    name: "OpenCode Free",
    baseUrl: OPENCODE_FREE_BASE_URL,
    api: "openai-completions",
    apiKey: "",
    models: openCodeFreeModels(),
  };
}

export function filterOpenCodeFreeIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id) continue;
    const bare = (id.split("/").pop() || id).toLowerCase();
    const ok =
      (bare.endsWith("-free") && !KEYED_FREE_SUFFIX.has(bare)) ||
      EXTRA_SLUGS.has(bare);
    if (!ok || seen.has(bare)) continue;
    seen.add(bare);
    out.push(id.includes("/") ? bare : id);
  }
  return out;
}

export function llmRequestHeaders(target: {
  providerId: string;
  apiKey: string;
  headers?: Record<string, string>;
}): Record<string, string> {
  const extra = { ...(target.headers ?? {}) };
  if (isKeylessProvider(target.providerId)) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "http-referer": "https://github.com/Jakevin/guild",
      "x-title": "Guild",
      "user-agent": guildUserAgent(),
      ...extra,
    };
    delete headers.authorization;
    delete headers.Authorization;
    return headers;
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...extra,
  };
  if (!headers.authorization && !headers.Authorization) {
    headers.authorization = `Bearer ${target.apiKey}`;
  }
  return headers;
}

let liveMemo: { at: number; ids: string[] | null } | null = null;
const LIVE_TTL_MS = 300_000;

export async function fetchOpenCodeFreeModels(
  timeoutMs = 4_000,
  force = false,
): Promise<string[] | null> {
  const now = Date.now();
  if (!force && liveMemo && now - liveMemo.at < LIVE_TTL_MS) {
    return liveMemo.ids ? [...liveMemo.ids] : null;
  }
  try {
    const res = await fetch(`${OPENCODE_FREE_BASE_URL}/models`, {
      headers: {
        accept: "application/json",
        "user-agent": guildUserAgent(),
        "http-referer": "https://github.com/Jakevin/guild",
        "x-title": "Guild",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      liveMemo = { at: now, ids: null };
      return null;
    }
    const body = (await res.json()) as { data?: { id?: string }[] } | { id?: string }[];
    const rows = Array.isArray(body) ? body : body.data;
    const ids = filterOpenCodeFreeIds(
      (rows ?? [])
        .map((row) => (row && typeof row.id === "string" ? row.id : ""))
        .filter(Boolean),
    );
    const result = ids.length ? ids : null;
    liveMemo = { at: now, ids: result };
    return result ? [...result] : null;
  } catch {
    liveMemo = { at: now, ids: null };
    return null;
  }
}

/** Tests only. */
export function resetOpenCodeFreeMemo(): void {
  liveMemo = null;
}

export type OpenCodeFreeProbe = {
  id: string;
  ok: boolean;
  status: number;
  reason?: string;
};

/** Health ping — not a turn timer. Muse /responses often needs ~7s. */
export const OPENCODE_FREE_PROBE_TIMEOUT_MS = 12_000;
const PROBE_CONCURRENCY = 4;

type FetchLike = typeof fetch;

export function selectOpenCodeFreeIds(
  live: string[],
  probe: OpenCodeFreeProbe[],
  keepId?: string,
): string[] {
  const ok = new Set(probe.filter((row) => row.ok).map((row) => row.id));
  const picked = live.filter((id) => ok.has(id));
  if (keepId && live.includes(keepId) && !picked.includes(keepId) && picked.length) {
    picked.push(keepId);
  }
  return picked;
}

export async function probeOpenCodeFreeModel(
  id: string,
  fetcher: FetchLike = fetch,
): Promise<OpenCodeFreeProbe> {
  const model = String(id || "").trim();
  if (!model) return { id: model, ok: false, status: 0, reason: "empty" };
  const responses = usesZenResponses(model);
  const url = `${OPENCODE_FREE_BASE_URL}${responses ? "/responses" : "/chat/completions"}`;
  const body = responses
    ? { model, input: [{ role: "user", content: "ping" }] }
    : {
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
      };
  try {
    const res = await fetcher(url, {
      method: "POST",
      headers: llmRequestHeaders({
        providerId: OPENCODE_FREE_PROVIDER_ID,
        apiKey: "",
      }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OPENCODE_FREE_PROBE_TIMEOUT_MS),
    });
    if (res.status === 429) {
      return { id: model, ok: true, status: 429, reason: "rate-limited" };
    }
    if (!res.ok) {
      return { id: model, ok: false, status: res.status, reason: `HTTP ${res.status}` };
    }
    return { id: model, ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timeout = /timeout|aborted/i.test(message);
    return {
      id: model,
      ok: false,
      status: 0,
      reason: timeout ? "timeout" : message || "error",
    };
  }
}

export async function probeOpenCodeFreeModels(
  ids: string[],
  fetcher: FetchLike = fetch,
): Promise<OpenCodeFreeProbe[]> {
  const list = ids.filter(Boolean);
  const results: OpenCodeFreeProbe[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      results[i] = await probeOpenCodeFreeModel(list[i], fetcher);
    }
  };
  const n = Math.min(PROBE_CONCURRENCY, Math.max(list.length, 0));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
