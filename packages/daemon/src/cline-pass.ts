import type { ModelEntry, ProviderEntry } from "@guild/protocol";

export const CLINE_PASS_PROVIDER_ID = "cline-pass";
export const CLINE_PASS_BASE_URL = "https://api.cline.bot/api/v1";
const RECOMMENDED_MODELS_URL =
  "https://api.cline.bot/api/v1/ai/cline/recommended-models";

/** Gateway-wide efforts. `off` is rejected; `none` is the off switch. */
export const CLINE_PASS_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const reasoning = {
  supportedEfforts: CLINE_PASS_EFFORTS,
  defaultEffort: "medium",
};

/** Published Cline Pass models from dsh-cline-pass. */
const KNOWN: Array<[string, string]> = [
  ["cline-pass/glm-5.3-flash", "GLM-5.3 Flash"],
  ["cline-pass/kimi-k3", "Kimi K3"],
  ["cline-pass/deepseek-v4-flash", "DeepSeek V4 Flash"],
  ["cline-pass/deepseek-v4.1-flash", "DeepSeek V4.1 Flash"],
  ["cline-pass/qwen3.8-max", "Qwen3.8 Max"],
  ["cline-pass/minimax-m3", "MiniMax-M3"],
  ["cline-pass/glm-5.3", "GLM-5.3"],
  ["cline-pass/glm-5.2", "GLM-5.2"],
  ["cline-pass/deepseek-v4-pro", "DeepSeek V4 Pro"],
  ["cline-pass/mimo-v2.5-pro", "MiMo-V2.5-Pro"],
  ["cline-pass/mimo-v2.5", "MiMo-V2.5"],
  ["cline-pass/kimi-k2.6", "Kimi K2.6"],
  ["cline-pass/qwen3.7-plus", "Qwen3.7 Plus"],
  ["cline-pass/kimi-k2.7-code", "Kimi K2.7 Code"],
  ["cline-pass/qwen3.7-max", "Qwen3.7 Max"],
];

const NAMES = new Map(KNOWN);

export function clinePassModel(id: string, name?: string): ModelEntry {
  const modelId = id.trim();
  return {
    id: modelId,
    name: name?.trim() || NAMES.get(modelId) || modelId.replace(/^cline-pass\//, ""),
    reasoning,
  };
}

export function clinePassProvider(): ProviderEntry {
  return {
    name: "Cline Pass",
    baseUrl: CLINE_PASS_BASE_URL,
    api: "openai-completions",
    apiKey: "$CLINE_PASS_API_KEY",
    models: KNOWN.map(([id, name]) => clinePassModel(id, name)),
  };
}

export function parseClinePassModels(raw: unknown): ModelEntry[] {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
  const nested = rec?.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : undefined;
  const list = rec?.clinePass ?? nested?.clinePass;
  if (!Array.isArray(list)) return [];
  const out: ModelEntry[] = [];
  for (const item of list) {
    const id =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
          ? String((item as { id: string }).id).trim()
          : "";
    if (!/^cline-pass\/[a-z0-9._-]+$/i.test(id)) continue;
    const name =
      item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
        ? String((item as { name: string }).name)
        : undefined;
    if (out.some((row) => row.id === id)) continue;
    out.push(clinePassModel(id, name));
  }
  return out;
}

export async function fetchClinePassModels(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4_000,
): Promise<ModelEntry[]> {
  try {
    const response = await fetchImpl(RECOMMENDED_MODELS_URL, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return [];
    return parseClinePassModels(await response.json());
  } catch {
    return [];
  }
}
