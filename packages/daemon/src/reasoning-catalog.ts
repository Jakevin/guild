import type { ModelReasoning } from "@guild/protocol";

const MODELS_DEV = "https://models.dev/api.json";
const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";
const TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_MS = 4_000;

const DEV_PROVIDER: Record<string, string> = {
  xai: "xai",
  "xai-oauth": "xai",
  openai: "openai",
  "openai-codex": "openai",
  anthropic: "anthropic",
  "anthropic-oauth": "anthropic",
  "github-copilot": "github-copilot",
  "opencode-free": "opencode",
  openrouter: "openrouter",
  "openrouter-oauth": "openrouter",
};

const OPENROUTER_PREFIX: Record<string, string> = {
  xai: "x-ai",
  openai: "openai",
  anthropic: "anthropic",
  "opencode-free": "opencode",
  "github-copilot": "github-copilot",
};

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
  if (efforts.includes("high")) spec.defaultEffort = "high";
  else if (efforts.includes("medium")) spec.defaultEffort = "medium";
  else if (efforts.length) spec.defaultEffort = efforts[0];
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
      out.set(`${pid}/${mid}`, spec);
      const bare = mid.split("/").pop() || mid;
      if (bare !== mid) out.set(`${pid}/${bare}`, spec);
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
    map.set(id, spec);
    const bare = id.split("/").pop() || id;
    if (bare !== id && !map.has(bare)) map.set(bare, spec);
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
      headers: { accept: "application/json", "user-agent": "Guild/0.2.19" },
      signal: ctrl,
    }),
    fetcher(OPENROUTER_MODELS, {
      headers: { accept: "application/json", "user-agent": "Guild/0.2.19" },
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

export function reasoningFor(
  providerId: string,
  modelId: string,
): ModelReasoning | undefined {
  if (!maps) return undefined;
  const provider = String(providerId || "").trim().toLowerCase();
  const model = String(modelId || "").trim();
  if (!provider || !model) return undefined;
  const bare = model.split("/").pop() || model;
  const devId = DEV_PROVIDER[provider] || provider.replace(/-oauth$/, "");

  if (devId === "openrouter") {
    const hit =
      maps.openrouter.get(model) ||
      maps.openrouter.get(bare) ||
      maps.openrouter.get(model.toLowerCase());
    return hit ? fillNullEfforts(hit) : undefined;
  }

  const devHit =
    maps.dev.get(`${devId}/${model}`) ||
    maps.dev.get(`${devId}/${bare}`) ||
    maps.dev.get(`${devId}/${bare.toLowerCase()}`);
  if (devHit) return devHit;

  const prefix = OPENROUTER_PREFIX[devId] || OPENROUTER_PREFIX[provider];
  if (prefix) {
    const slug = `${prefix}/${bare}`;
    const orHit = maps.openrouter.get(slug) || maps.openrouter.get(model);
    if (orHit) return fillNullEfforts(orHit);
  }
  return undefined;
}

export function attachReasoning(
  providerId: string,
  models: { id: string; name?: string; reasoning?: ModelReasoning }[],
): { id: string; name?: string; reasoning?: ModelReasoning }[] {
  return models.map((model) => {
    const spec = reasoningFor(providerId, model.id);
    if (!spec) return model;
    return { ...model, reasoning: spec };
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
  return usable.includes("high")
    ? "high"
    : usable.includes("medium")
      ? "medium"
      : usable[0];
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
