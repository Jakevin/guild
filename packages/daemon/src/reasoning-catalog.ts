import type { ModelReasoning } from "@guild/protocol";
import { guildUserAgent } from "./version.ts";

const MODELS_DEV = "https://models.dev/api.json";
const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";
const TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_MS = 4_000;

/** Hermes-style: Guild / Pi picker id → models.dev provider id. */
const DEV_PROVIDER: Record<string, string> = {
  xai: "xai",
  "xai-oauth": "xai",
  openai: "openai",
  "openai-codex": "openai",
  anthropic: "anthropic",
  "anthropic-oauth": "anthropic",
  "github-copilot": "github-copilot",
  "opencode-free": "opencode",
  opencode: "opencode",
  openrouter: "openrouter",
  "openrouter-oauth": "openrouter",
  google: "google",
  gemini: "google",
  groq: "groq",
  deepseek: "deepseek",
  qwen: "alibaba-token-plan",
  alibaba: "alibaba",
  zai: "zai",
  moonshot: "moonshotai",
  moonshotai: "moonshotai",
  kimi: "moonshotai",
  bai: "xiaomi",
  xiaomi: "xiaomi",
  minimax: "minimax",
};

const OPENROUTER_PREFIX: Record<string, string> = {
  xai: "x-ai",
  openai: "openai",
  anthropic: "anthropic",
  "opencode-free": "opencode",
  opencode: "opencode",
  "github-copilot": "github-copilot",
  google: "google",
  gemini: "google",
};

/** Pi: host of baseUrl → models.dev provider (token-plan, Zen, labs). */
const HOST_TO_DEV: Array<[string, string]> = [
  ["openrouter.ai", "openrouter"],
  ["api.x.ai", "xai"],
  ["api.openai.com", "openai"],
  ["api.anthropic.com", "anthropic"],
  ["opencode.ai", "opencode"],
  ["api.groq.com", "groq"],
  ["api.deepseek.com", "deepseek"],
  ["generativelanguage.googleapis.com", "google"],
  ["token-plan.ap-southeast-1.maas.aliyuncs.com", "alibaba-token-plan"],
  ["dashscope.aliyuncs.com", "alibaba"],
  ["api.z.ai", "zai"],
  ["open.bigmodel.cn", "zai"],
  ["api.moonshot.ai", "moonshotai"],
  ["api.moonshot.cn", "moonshotai"],
  ["api.b.ai", "xiaomi"],
];

/** Sort key only — never used as the displayed list. */
const EFFORT_RANK = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Default ladder when the catalog has no list. */
export const DEFAULT_EFFORTS = ["low", "medium", "high"];

export function pickDefaultEffort(efforts: string[]): string | undefined {
  if (!efforts.length) return undefined;
  if (efforts.includes("medium")) return "medium";
  if (efforts.includes("high")) return "high";
  if (efforts.includes("low")) return "low";
  return efforts[0];
}

type CatalogMaps = {
  at: number;
  dev: Map<string, ModelReasoning>;
  openrouter: Map<string, ModelReasoning>;
  gatewayEfforts: string[];
};

let maps: CatalogMaps | null = null;

export function parseEffortList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const key = item.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(key) || out.includes(key)) continue;
    out.push(key);
  }
  return out;
}

export function sanitizeEffort(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(key)) return undefined;
  return key;
}

export function fromModelsDevModel(raw: unknown): ModelReasoning | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  if (row.reasoning === false) return undefined;
  const options = Array.isArray(row.reasoning_options)
    ? row.reasoning_options
    : [];
  let efforts: string[] = [];
  let supportsMaxTokens = false;
  for (const opt of options) {
    if (!opt || typeof opt !== "object" || Array.isArray(opt)) continue;
    const rec = opt as Record<string, unknown>;
    if (rec.type === "effort") efforts = parseEffortList(rec.values);
    if (rec.type === "budget_tokens") supportsMaxTokens = true;
  }
  if (row.reasoning !== true && !efforts.length && !supportsMaxTokens) {
    return undefined;
  }
  const spec: ModelReasoning = {};
  if (efforts.length) spec.supportedEfforts = efforts;
  if (supportsMaxTokens) spec.supportsMaxTokens = true;
  spec.defaultEnabled = true;
  if (efforts.length) spec.mandatory = !efforts.includes("none");
  const def = pickDefaultEffort(efforts);
  if (def) spec.defaultEffort = def;
  return spec;
}

export function fromOpenRouterModel(raw: unknown): ModelReasoning | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const block = row.reasoning;
  if (block === undefined) return undefined;
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return undefined;
  }
  const rec = block as Record<string, unknown>;
  const spec: ModelReasoning = {};
  if (rec.supported_efforts === null) {
    spec.supportedEfforts = undefined;
  } else {
    const efforts = parseEffortList(rec.supported_efforts);
    if (efforts.length) spec.supportedEfforts = efforts;
  }
  const def = sanitizeEffort(rec.default_effort);
  if (def) spec.defaultEffort = def;
  if (typeof rec.mandatory === "boolean") spec.mandatory = rec.mandatory;
  if (typeof rec.default_enabled === "boolean") {
    spec.defaultEnabled = rec.default_enabled;
  }
  if (rec.supports_max_tokens === true) spec.supportsMaxTokens = true;
  if (
    !spec.supportedEfforts &&
    spec.defaultEffort === undefined &&
    spec.mandatory === undefined &&
    spec.supportsMaxTokens === undefined
  ) {
    return { defaultEnabled: spec.defaultEnabled ?? true };
  }
  return spec;
}

function indexDev(data: unknown): Map<string, ModelReasoning> {
  const out = new Map<string, ModelReasoning>();
  if (!data || typeof data !== "object") return out;
  for (const [pid, prov] of Object.entries(data as Record<string, unknown>)) {
    if (!prov || typeof prov !== "object") continue;
    const models = (prov as { models?: Record<string, unknown> }).models;
    if (!models || typeof models !== "object") continue;
    for (const [mid, model] of Object.entries(models)) {
      const spec = fromModelsDevModel(model);
      if (!spec) continue;
      const provider = pid.toLowerCase();
      const modelKey = mid.toLowerCase();
      out.set(`${provider}/${modelKey}`, spec);
      const bare = (modelKey.split("/").pop() || modelKey).toLowerCase();
      out.set(`${provider}/${bare}`, spec);
    }
  }
  return out;
}

function indexOpenRouter(data: unknown): {
  map: Map<string, ModelReasoning>;
  gateway: string[];
} {
  const map = new Map<string, ModelReasoning>();
  const seen = new Set<string>();
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)
      ? ((data as { data: unknown[] }).data)
      : [];
  for (const row of rows) {
    const spec = fromOpenRouterModel(row);
    if (!spec) continue;
    const id =
      row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
        ? (row as { id: string }).id
        : "";
    if (!id) continue;
    const slug = id.toLowerCase();
    map.set(slug, spec);
    const bare = slug.split("/").pop() || slug;
    if (bare !== slug && !map.has(bare)) map.set(bare, spec);
    for (const effort of spec.supportedEfforts ?? []) seen.add(effort);
  }
  const gateway = EFFORT_RANK.filter((key) => seen.has(key));
  for (const key of seen) {
    if (!gateway.includes(key)) gateway.push(key);
  }
  return { map, gateway };
}

export function setReasoningCatalogForTests(input: {
  dev?: unknown;
  openrouter?: unknown;
}): void {
  const openrouter = indexOpenRouter(input.openrouter ?? { data: [] });
  maps = {
    at: Date.now(),
    dev: indexDev(input.dev ?? {}),
    openrouter: openrouter.map,
    gatewayEfforts: openrouter.gateway,
  };
}

export function resetReasoningCatalog(): void {
  maps = null;
}

function skipLiveFetch(): boolean {
  return Boolean(
    process.env.NODE_TEST_CONTEXT ||
      process.argv.some((arg) => arg === "--test" || arg.includes("--test=")),
  );
}

export async function refreshReasoningCatalog(
  force = false,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!force && maps && Date.now() - maps.at < TTL_MS) return;
  if (!force && skipLiveFetch() && maps) return;
  if (skipLiveFetch() && !force) return;
  const ctrl = AbortSignal.timeout(FETCH_MS);
  const [devRes, orRes] = await Promise.allSettled([
    fetcher(MODELS_DEV, {
      headers: { accept: "application/json", "user-agent": guildUserAgent() },
      signal: ctrl,
    }),
    fetcher(OPENROUTER_MODELS, {
      headers: { accept: "application/json", "user-agent": guildUserAgent() },
      signal: ctrl,
    }),
  ]);
  let dev = maps?.dev ?? new Map<string, ModelReasoning>();
  let openrouter = maps?.openrouter ?? new Map<string, ModelReasoning>();
  let gateway = maps?.gatewayEfforts ?? [];
  let got = false;
  if (devRes.status === "fulfilled" && devRes.value.ok) {
    try {
      dev = indexDev(await devRes.value.json());
      got = true;
    } catch {
      /* keep previous */
    }
  }
  if (orRes.status === "fulfilled" && orRes.value.ok) {
    try {
      const indexed = indexOpenRouter(await orRes.value.json());
      openrouter = indexed.map;
      gateway = indexed.gateway;
      got = true;
    } catch {
      /* keep previous */
    }
  }
  if (!got && !maps) return;
  if (!got) return;
  maps = {
    at: Date.now(),
    dev,
    openrouter,
    gatewayEfforts: gateway,
  };
}

function fillNullEfforts(spec: ModelReasoning): ModelReasoning {
  if (spec.supportedEfforts?.length) return spec;
  if (!maps?.gatewayEfforts.length) return spec;
  return { ...spec, supportedEfforts: [...maps.gatewayEfforts] };
}

function catalogGet(
  table: Map<string, ModelReasoning>,
  key: string,
): ModelReasoning | undefined {
  return table.get(key) ?? table.get(key.toLowerCase());
}

function hostOf(baseUrl?: string): string {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function catalogIdsFor(provider: string, baseUrl?: string): string[] {
  const ids: string[] = [];
  const add = (id?: string) => {
    const key = String(id || "").trim().toLowerCase();
    if (!key || ids.includes(key)) return;
    if (key === "commandcode" || key === "command-code" || key === "command_code") return;
    ids.push(key);
  };
  add(DEV_PROVIDER[provider]);
  add(provider.replace(/-oauth$/, ""));
  const host = hostOf(baseUrl);
  if (host) {
    for (const [suffix, id] of HOST_TO_DEV) {
      if (host === suffix || host.endsWith(`.${suffix}`)) add(id);
    }
  }
  if (ids.includes("alibaba-token-plan")) add("alibaba");
  return ids;
}

export function reasoningFor(
  providerId: string,
  modelId: string,
  baseUrl?: string,
): ModelReasoning | undefined {
  if (!maps) return undefined;
  const provider = String(providerId || "").trim().toLowerCase();
  const model = String(modelId || "").trim();
  if (!provider || !model) return undefined;
  // Command Code picks thinking depth itself. Do not borrow models.dev
  // efforts — the picker would offer levels the endpoint does not take.
  if (
    provider === "commandcode" ||
    provider === "command-code" ||
    provider === "command_code"
  ) {
    return undefined;
  }
  const bare = (model.split("/").pop() || model).toLowerCase();
  const catalogs = catalogIdsFor(provider, baseUrl);

  if (catalogs.includes("openrouter")) {
    const hit =
      catalogGet(maps.openrouter, model) ||
      catalogGet(maps.openrouter, bare);
    if (hit) return fillNullEfforts(hit);
  }

  for (const devId of catalogs) {
    const devHit =
      catalogGet(maps.dev, `${devId}/${model}`) ||
      catalogGet(maps.dev, `${devId}/${bare}`);
    if (devHit) return devHit;
  }

  for (const devId of catalogs) {
    const prefix = OPENROUTER_PREFIX[devId] || OPENROUTER_PREFIX[provider];
    if (!prefix) continue;
    const orHit =
      catalogGet(maps.openrouter, `${prefix}/${bare}`) ||
      catalogGet(maps.openrouter, model);
    if (orHit) return fillNullEfforts(orHit);
  }
  return undefined;
}

export function sanitizeModelReasoning(raw: unknown): ModelReasoning | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const efforts = parseEffortList(rec.supportedEfforts);
  const defaultEffort = sanitizeEffort(rec.defaultEffort);
  if (!efforts.length && !defaultEffort) return undefined;
  const spec: ModelReasoning = { defaultEnabled: true };
  if (efforts.length) {
    spec.supportedEfforts = efforts;
    spec.mandatory = !efforts.includes("none");
  }
  if (defaultEffort && (!efforts.length || efforts.includes(defaultEffort))) {
    spec.defaultEffort = defaultEffort;
  } else {
    const def = pickDefaultEffort(efforts);
    if (def) spec.defaultEffort = def;
  }
  return spec;
}

/** Catalog efforts win. Manual models.json efforts fill a catalog miss. */
export function resolveReasoning(
  providerId: string,
  modelId: string,
  baseUrl?: string,
  stored?: ModelReasoning,
): ModelReasoning | undefined {
  const catalog = reasoningFor(providerId, modelId, baseUrl);
  if (catalog?.supportedEfforts?.length) return catalog;
  const provider = String(providerId || "").trim().toLowerCase();
  if (
    provider === "commandcode" ||
    provider === "command-code" ||
    provider === "command_code"
  ) {
    return undefined;
  }
  if (stored?.supportedEfforts?.length) return stored;
  return catalog;
}

export function attachReasoning(
  providerId: string,
  models: { id: string; name?: string; reasoning?: ModelReasoning }[],
  baseUrl?: string,
): { id: string; name?: string; reasoning?: ModelReasoning }[] {
  return models.map((model) => {
    const spec = resolveReasoning(providerId, model.id, baseUrl, model.reasoning);
    if (!spec) return model;
    return { ...model, reasoning: spec };
  });
}

export function annotateKeyModels(
  providerId: string,
  models: { id: string; name?: string; reasoning?: ModelReasoning }[],
  baseUrl?: string,
): {
  id: string;
  name?: string;
  reasoning?: ModelReasoning;
  catalogEfforts?: string[];
  manualEfforts?: string[];
}[] {
  return models.map((model) => {
    const catalog = reasoningFor(providerId, model.id, baseUrl)?.supportedEfforts ?? [];
    const manual = model.reasoning?.supportedEfforts ?? [];
    return {
      id: model.id,
      name: model.name,
      ...(model.reasoning ? { reasoning: model.reasoning } : {}),
      ...(catalog.length ? { catalogEfforts: catalog } : {}),
      ...(manual.length ? { manualEfforts: manual } : {}),
    };
  });
}

export function clampEffort(
  want: string | undefined,
  spec: ModelReasoning | undefined,
  fast = false,
): string | undefined {
  const efforts = spec?.supportedEfforts;
  if (!efforts?.length) return undefined;
  const usable = spec?.mandatory
    ? efforts.filter((key) => key !== "none")
    : efforts;
  if (!usable.length) return undefined;
  if (fast) {
    if (usable.includes("low")) return "low";
    if (usable.includes("minimal")) return "minimal";
    const ranked = EFFORT_RANK.filter((key) => usable.includes(key));
    return ranked[0] || usable[usable.length - 1];
  }
  const picked = sanitizeEffort(want);
  if (picked && usable.includes(picked)) return picked;
  if (spec?.defaultEffort && usable.includes(spec.defaultEffort)) {
    return spec.defaultEffort;
  }
  return pickDefaultEffort(usable) || usable[0];
}

export function reasoningPayload(
  providerId: string,
  baseUrl: string,
  effort: string | undefined,
): Record<string, unknown> {
  if (!effort) return {};
  const viaOpenRouter =
    providerId.includes("openrouter") ||
    /openrouter\.ai/i.test(baseUrl);
  if (viaOpenRouter) return { reasoning: { effort } };
  return { reasoning_effort: effort, reasoning: { effort } };
}
