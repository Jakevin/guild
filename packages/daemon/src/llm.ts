import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AuxRole,
  LlmApi,
  ModelEntry,
  ModelRef,
  ModelsFile,
  ProviderEntry,
} from "@guild/protocol";
import { StoreError } from "./store.ts";
import { estimateSendTokens, trimSendMessages } from "./send-budget.ts";
import {
  completeOAuth,
  formatOAuthError,
  listSubscriptions,
  OAUTH_PICKER_IDS,
  STREAM_IDLE_TIMEOUT_MS,
  storedAccessToken,
  subscriptionByPicker,
  withTransientRetries,
} from "./oauth.ts";
import {
  emitProgress,
  openaiTools,
  roundSignal,
  throwIfAborted,
  TOOL_LOOP_WRAP,
  type SkillRef,
  type ToolContext,
  type ToolTrace,
} from "./tools.ts";
import { runAgentLoop } from "./harness.ts";
import type { ChatUsage } from "@guild/protocol";
import {
  addUsage,
  blankUsage,
  fromAnthropicUsage,
  fromOpenAiUsage,
  withDuration,
} from "./usage.ts";
import {
  annotateKeyModels,
  attachReasoning,
  clampEffort,
  resolveReasoning,
  reasoningPayload,
  refreshReasoningCatalog,
  sanitizeEffort,
  sanitizeModelReasoning,
} from "./reasoning-catalog.ts";

export { refreshReasoningCatalog };
import {
  OPENCODE_FREE_DEFAULT_MODEL,
  OPENCODE_FREE_PROVIDER_ID,
  fetchOpenCodeFreeModels,
  isKeylessProvider,
  llmRequestHeaders,
  openCodeFreeModels,
  openCodeFreeProvider,
  probeOpenCodeFreeModels,
  selectOpenCodeFreeIds,
  usesZenResponses,
  type OpenCodeFreeProbe,
} from "./opencode-free.ts";
import {
  FREEBUFF_CHAT_DEFAULT_MODEL,
  FREEBUFF_CHAT_HINT,
  FREEBUFF_CHAT_LOGIN_HINT,
  FREEBUFF_CHAT_PICKER_ID,
  WEB_BRIDGE_PICKER_IDS,
  completeFreebuffChat,
  formatFreebuffError,
  isWebBridgeTarget,
  liveOrFloorModels,
  readFreebuffState,
  sessionUsable,
  type FreebuffLeaseParts,
} from "./freebuff-chat.ts";

import {
  COMMANDCODE_PICKER_ID,
  COMMANDCODE_PROVIDER_API_BASE,
  CommandCodeUpgradeRequired,
  apiForModelId,
  commandCodeRequestHeaders,
  commandCodeStatus,
  commandCodeUsesGenerate,
  isCommandCodeProvider,
  isCommandCodeUpgradeRequired,
  markCommandCodeGenerate,
  resolveCommandCodeAuth,
} from "./commandcode.ts";
import { completeCommandCodeGenerate } from "./commandcode-generate.ts";

export { isWebBridgeTarget };

export const AUX_ROLES: { id: AuxRole; name: string; hint: string }[] = [
  { id: "vision", name: "Vision", hint: "Image analysis" },
  { id: "web", name: "Web extract", hint: "Page summarization" },
  { id: "spawn", name: "SubAgent", hint: "explorer / worker / reviewer" },
];

const CONFIGURABLE_AUX = new Set(AUX_ROLES.map((role) => role.id));

export const DEFAULT_MODELS: ModelsFile = {
  default: {
    provider: OPENCODE_FREE_PROVIDER_ID,
    model: OPENCODE_FREE_DEFAULT_MODEL,
  },
  reasoning: "medium",
  fast: false,
  aux: {},
  recent: [],
  providers: {
    [OPENCODE_FREE_PROVIDER_ID]: openCodeFreeProvider(),
    openai: {
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      api: "openai-completions",
      apiKey: "$OPENAI_API_KEY",
      models: [
        { id: "gpt-4.1-mini", name: "GPT-4.1 mini" },
        { id: "gpt-4.1", name: "GPT-4.1" },
      ],
    },
    xai: {
      name: "xAI",
      baseUrl: "https://api.x.ai/v1",
      api: "openai-completions",
      apiKey: "$XAI_API_KEY",
      models: [
        { id: "grok-4.6", name: "Grok 4.6" },
        { id: "grok-4.5", name: "Grok 4.5" },
        { id: "grok-4.3", name: "Grok 4.3" },
      ],
    },
    anthropic: {
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      apiKey: "$ANTHROPIC_API_KEY",
      models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
    },
    ollama: {
      name: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      apiKey: "ollama",
      models: [{ id: "llama3.1:8b", name: "Llama 3.1 8B" }],
    },
    openrouter: {
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      api: "openai-completions",
      apiKey: "$OPENROUTER_API_KEY",
      models: [
        { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
        { id: "openai/gpt-4.1-mini", name: "GPT-4.1 mini" },
      ],
    },
  },
};

export function modelsPath(dataDir: string): string {
  return join(dataDir, "models.json");
}

export function seedModelsFile(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(modelsPath(dataDir))) return;
  writeModelsFile(dataDir, DEFAULT_MODELS);
}

export function readModelsFile(dataDir: string): ModelsFile {
  seedModelsFile(dataDir);
  try {
    const raw = readFileSync(modelsPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as ModelsFile;
    if (!parsed || typeof parsed !== "object" || !parsed.providers) {
      return structuredClone(DEFAULT_MODELS);
    }
    if (Object.keys(parsed.providers).length === 0) return parsed;
    return withOpenCodeFree(parsed);
  } catch {
    return structuredClone(DEFAULT_MODELS);
  }
}

function pinOpenCodeFree(file: ModelsFile): ModelsFile {
  const current = file.providers[OPENCODE_FREE_PROVIDER_ID];
  if (!current) return file;
  const keys = Object.keys(file.providers);
  if (keys[0] === OPENCODE_FREE_PROVIDER_ID) return file;
  const rest: ModelsFile["providers"] = {};
  for (const [id, provider] of Object.entries(file.providers)) {
    if (id === OPENCODE_FREE_PROVIDER_ID) continue;
    rest[id] = provider;
  }
  return {
    ...file,
    providers: {
      [OPENCODE_FREE_PROVIDER_ID]: current,
      ...rest,
    },
  };
}

function withOpenCodeFree(file: ModelsFile): ModelsFile {
  if (file.providers[OPENCODE_FREE_PROVIDER_ID]) return pinOpenCodeFree(file);
  return pinOpenCodeFree({
    ...file,
    providers: {
      [OPENCODE_FREE_PROVIDER_ID]: openCodeFreeProvider(),
      ...file.providers,
    },
  });
}

export function writeModelsFile(dataDir: string, file: ModelsFile): ModelsFile {
  const cleaned = pinOpenCodeFree(sanitizeModels(file));
  const path = modelsPath(dataDir);
  writeFileSync(path, `${JSON.stringify(cleaned, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return cleaned;
}

export function shownIdsOf(file: ModelsFile, pickerId: string): string[] | null {
  const ids = file.shown?.[pickerId];
  return Array.isArray(ids) ? ids : null;
}

export function filterShownModels<T extends { id: string }>(
  models: T[],
  shownIds: string[] | null,
): T[] {
  if (!shownIds) return models;
  const allow = new Set(shownIds);
  return models.filter((row) => allow.has(row.id));
}

export function setShownModels(
  dataDir: string,
  pickerId: string,
  shownIds: string[] | null,
): ModelsFile {
  const existing = readModelsFile(dataDir);
  const shown = { ...(existing.shown ?? {}) };
  const id = String(pickerId || "").trim();
  if (!id) return existing;
  if (shownIds == null) delete shown[id];
  else shown[id] = shownIds;
  return writeModelsFile(dataDir, { ...existing, shown });
}

export function mergeModelsFile(
  dataDir: string,
  incoming: Partial<ModelsFile>,
): ModelsFile {
  const existing = readModelsFile(dataDir);
  const next: ModelsFile = {
    default: incoming.default !== undefined ? incoming.default : existing.default,
    reasoning: incoming.reasoning ?? existing.reasoning ?? "medium",
    fast: incoming.fast ?? existing.fast ?? false,
    aux: incoming.aux !== undefined ? incoming.aux : existing.aux,
    recent: incoming.recent !== undefined ? incoming.recent : existing.recent,
    providers: incoming.providers ? {} : existing.providers,
    shown: incoming.shown !== undefined ? incoming.shown : existing.shown,
  };
  if (incoming.default) {
    next.recent = pushRecent(existing.recent, incoming.default);
  }
  if (!incoming.providers) {
    return writeModelsFile(dataDir, next);
  }
  const providersIn: ModelsFile["providers"] = {};
  for (const [id, provider] of Object.entries(incoming.providers)) {
    const prev = existing.providers[id];
    const incomingKey = String(provider.apiKey ?? "").trim();
    const prevKey = prev?.apiKey ?? "";
    const apiKey =
      !incomingKey || (prevKey && incomingKey === maskApiKey(prevKey))
        ? prevKey || incomingKey
        : incomingKey;
    providersIn[id] = { ...provider, apiKey };
  }
  next.providers = providersIn;
  return writeModelsFile(dataDir, withOpenCodeFree(next));
}

function pushRecent(list: ModelRef[] | undefined, ref: ModelRef): ModelRef[] {
  const next = [
    ref,
    ...(list ?? []).filter(
      (item) => !(item.provider === ref.provider && item.model === ref.model),
    ),
  ];
  return next.slice(0, 8);
}

export type PublicProvider = ProviderEntry & {
  id: string;
  stored: "empty" | "env" | "literal";
  apiKeyPreview: string;
};

export function maskApiKey(value: string): string {
  const key = String(value || "");
  if (key.length <= 10) return key;
  return key.slice(0, 5) + "…" + key.slice(-5);
}

export async function refreshOpenCodeFreeCatalog(
  dataDir: string,
  force = false,
): Promise<{
  models: { id: string; name?: string }[];
  updated: boolean;
  probe?: OpenCodeFreeProbe[];
}> {
  const file = readModelsFile(dataDir);
  const prev = file.providers[OPENCODE_FREE_PROVIDER_ID] ?? openCodeFreeProvider();
  if (!force) {
    return { models: prev.models, updated: false };
  }
  const live = await fetchOpenCodeFreeModels(4_000, true);
  if (!live?.length) {
    throw new StoreError(502, "couldn't sync OpenCode Free");
  }
  const probe = await probeOpenCodeFreeModels(live);
  const keepId =
    file.default?.provider === OPENCODE_FREE_PROVIDER_ID
      ? file.default.model
      : undefined;
  const usable = selectOpenCodeFreeIds(live, probe, keepId);
  if (!usable.length) {
    return { models: prev.models, updated: false, probe };
  }
  const ids = usable;
  const models = openCodeFreeModels(ids);
  const same =
    models.length === prev.models.length &&
    models.every((row, i) => row.id === prev.models[i]?.id);
  if (!same) {
    writeModelsFile(dataDir, {
      ...file,
      providers: {
        ...file.providers,
        [OPENCODE_FREE_PROVIDER_ID]: { ...prev, models },
      },
    });
  }
  return { models, updated: !same, probe };
}

export function publicModels(dataDir: string, env: NodeJS.ProcessEnv = process.env) {
  const file = withOpenCodeFree(readModelsFile(dataDir));
  const providers: PublicProvider[] = Object.entries(file.providers).map(
    ([id, provider]) => {
      const key = provider.apiKey ?? "";
      const stored = !key ? "empty" : key.startsWith("$") ? "env" : "literal";
      return {
        id,
        ...provider,
        models: annotateKeyModels(id, provider.models, provider.baseUrl),
        apiKey: stored === "literal" ? "" : key,
        apiKeyPreview: key ? maskApiKey(key) : "",
        stored,
      };
    },
  );
  const target = resolveLlm(dataDir, env);
  const subscriptions = listSubscriptions(dataDir).map((s) => {
    const shownIds = shownIdsOf(file, s.pickerId);
    const catalog = s.models ?? [];
    return {
      ...s,
      catalog,
      shownIds,
      models: filterShownModels(catalog, shownIds),
    };
  });
  const freebuffReady = sessionUsable(dataDir);
  const freebuffState = readFreebuffState(dataDir);
  const freebuffModels = attachReasoning(
    FREEBUFF_CHAT_PICKER_ID,
    liveOrFloorModels(dataDir),
  );
  const commandCode = commandCodeStatus(dataDir, env);
  const freebuffShown = shownIdsOf(file, FREEBUFF_CHAT_PICKER_ID);
  const webBridges = [
    {
      id: FREEBUFF_CHAT_PICKER_ID,
      pickerId: FREEBUFF_CHAT_PICKER_ID,
      name: "Freebuff Chat",
      hint: FREEBUFF_CHAT_HINT,
      loginHint: FREEBUFF_CHAT_LOGIN_HINT,
      kind: "web-bridge" as const,
      connected: freebuffReady,
      pending: Boolean(freebuffState.pending) && !freebuffReady,
      ready: freebuffReady,
      accessTier: freebuffState.accessTier,
      catalog: freebuffModels,
      shownIds: freebuffShown,
      models: filterShownModels(freebuffModels, freebuffShown),
    },
  ];
  const picker = [
    ...providers.map((p) => ({
      id: p.id,
      name: p.name || p.id,
      kind: (isKeylessProvider(p.id) ? "keyless" : "key") as "key" | "keyless",
      ready:
        isKeylessProvider(p.id) ||
        Boolean(resolveApiKey(p.apiKey, env) || p.stored === "literal"),
      models: attachReasoning(p.id, p.models, p.baseUrl),
    })),
    ...subscriptions.map((s) => ({
      id: s.pickerId,
      name: s.name,
      kind: "oauth" as const,
      ready: s.ready,
      models: attachReasoning(s.pickerId, s.models ?? []),
    })),
    {
      id: COMMANDCODE_PICKER_ID,
      name: "Command Code",
      kind: "commandcode" as const,
      ready: commandCode.ready,
      models: filterShownModels(
        commandCode.catalog,
        shownIdsOf(file, COMMANDCODE_PICKER_ID),
      ),
    },
    {
      id: FREEBUFF_CHAT_PICKER_ID,
      name: "Freebuff Chat",
      kind: "web-bridge" as const,
      ready: freebuffReady,
      models: filterShownModels(freebuffModels, freebuffShown),
    },
  ];
  return {
    default: file.default ?? null,
    reasoning: file.reasoning ?? "",
    fast: Boolean(file.fast),
    aux: file.aux ?? {},
    auxRoles: AUX_ROLES,
    recent: file.recent ?? [],
    providers,
    subscriptions,
    commandCode: {
      ...commandCode,
      shownIds: shownIdsOf(file, COMMANDCODE_PICKER_ID),
      models: filterShownModels(commandCode.catalog, shownIdsOf(file, COMMANDCODE_PICKER_ID)),
    },
    webBridges,
    picker,
    active: target
      ? {
          provider: target.providerId,
          model: target.model,
          ready: isWebBridgeTarget(target)
            ? Boolean(target.sessionReady)
            : true,
        }
      : null,
  };
}

export type LlmTarget = {
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  api: LlmApi;
  headers?: Record<string, string>;
  accountId?: string;
  transport?: "http" | "oauth" | "web-bridge" | "commandcode";
  sessionReady?: boolean;
  fetch?: typeof fetch;
};

export function resolveApiKey(
  raw: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith("$")) return (env[value.slice(1)] ?? "").trim();
  return value;
}

function oauthTarget(
  dataDir: string,
  providerId: string,
  modelId?: string,
): LlmTarget | null {
  const sub = subscriptionByPicker(providerId);
  if (!sub) return null;
  if (!storedAccessToken(dataDir, sub.id)) return null;
  const model =
    modelId ||
    listSubscriptions(dataDir).find((item) => item.id === sub.id)?.models[0]
      ?.id ||
    "";
  if (!model) return null;
  return {
    providerId,
    model,
    baseUrl: "pi-ai",
    apiKey: "oauth",
    api: "openai-completions",
  };
}

function isChatRole(role?: AuxRole | "chat"): boolean {
  return role == null || role === "chat";
}

export function resolveLlm(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  role?: AuxRole | "chat",
  prefer?: ModelRef | null,
): LlmTarget | null {
  const file = readModelsFile(dataDir);
  const selected: ModelRef | null | undefined =
    prefer ??
    (role && CONFIGURABLE_AUX.has(role as AuxRole)
      ? file.aux?.[role as AuxRole]
      : undefined) ??
    file.default;
  const tryProvider = (
    id: string,
    modelId: string | undefined,
    callSite: "selected" | "fallback",
  ): LlmTarget | null => {
    const providerId = isKeylessProvider(id) ? OPENCODE_FREE_PROVIDER_ID : id;
    if (WEB_BRIDGE_PICKER_IDS.has(id) || WEB_BRIDGE_PICKER_IDS.has(providerId)) {
      if (!isChatRole(role)) return null;
      if (callSite !== "selected") return null;
      return {
        providerId: FREEBUFF_CHAT_PICKER_ID,
        model: modelId || FREEBUFF_CHAT_DEFAULT_MODEL,
        baseUrl: "freebuff-chat",
        apiKey: "session",
        api: "openai-completions",
        transport: "web-bridge",
        sessionReady: sessionUsable(dataDir),
      };
    }
    if (isCommandCodeProvider(id) || isCommandCodeProvider(providerId)) {
      const auth = resolveCommandCodeAuth(dataDir, env);
      if (!auth.token) return null;
      const model = modelId || commandCodeStatus(dataDir, env).models[0]?.id || "deepseek/deepseek-v4-flash";
      const api = apiForModelId(model);
      return {
        providerId: COMMANDCODE_PICKER_ID,
        model,
        baseUrl: COMMANDCODE_PROVIDER_API_BASE,
        apiKey: auth.token,
        api,
        transport: "commandcode",
        headers: commandCodeRequestHeaders(auth.token),
      };
    }
    const oauth = oauthTarget(dataDir, id, modelId);
    if (oauth) return oauth;
    const provider = file.providers[providerId];
    if (!provider) return null;
    const apiKey = resolveApiKey(provider.apiKey, env);
    if (!apiKey && !isKeylessProvider(providerId)) return null;
    const model = modelId || provider.models[0]?.id || "";
    if (!model) return null;
    return {
      providerId,
      model,
      baseUrl: provider.baseUrl.replace(/\/+$/, ""),
      apiKey,
      api: provider.api,
    };
  };
  if (selected?.provider) {
    const hit = tryProvider(selected.provider, selected.model, "selected");
    if (hit) return hit;
  }
  if (file.default?.provider) {
    const hit = tryProvider(file.default.provider, file.default.model, "fallback");
    if (hit) return hit;
  }
  for (const id of Object.keys(file.providers)) {
    const hit = tryProvider(id, undefined, "fallback");
    if (hit) return hit;
  }
  return envFallback(env);
}

function envFallback(env: NodeJS.ProcessEnv): LlmTarget | null {
  if (env.XAI_API_KEY) {
    return {
      providerId: "xai",
      model: env.XAI_MODEL ?? "grok-4-fast",
      baseUrl: (env.XAI_API_URL ?? "https://api.x.ai/v1").replace(
        /\/chat\/completions$/,
        "",
      ),
      apiKey: env.XAI_API_KEY,
      api: "openai-completions",
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      providerId: "openai",
      model: env.OPENAI_MODEL ?? "gpt-4.1-mini",
      baseUrl: (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
        /\/chat\/completions$/,
        "",
      ),
      apiKey: env.OPENAI_API_KEY,
      api: "openai-completions",
    };
  }
  return null;
}

export async function llmComplete(input: {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  temperature?: number;
  role?: AuxRole | "chat";
  prefer?: ModelRef | null;
  tools?: boolean;
  skills?: SkillRef[];
  toolCtx?: ToolContext;
  lease?: FreebuffLeaseParts;
}): Promise<{
  text: string;
  provider: string;
  model: string;
  traces: ToolTrace[];
  thinking: string;
  usage?: ChatUsage;
} | null> {
  const env = input.env ?? process.env;
  const target = resolveLlm(input.dataDir, env, input.role, input.prefer);
  if (!target) return null;
  const useTools = input.tools ?? input.role === "chat";
  const toolCtx: ToolContext = input.toolCtx ?? {
    skills: input.skills,
    dataDir: input.dataDir,
    env,
    spawnDepth: 0,
    allowWrite: true,
  };
  const file = readModelsFile(input.dataDir);
  const stored = file.providers[target.providerId]?.models.find(
    (model) => model.id === target.model,
  )?.reasoning;
  const effort = clampEffort(
    file.fast ? "low" : input.prefer ? input.prefer.reasoning : file.reasoning,
    resolveReasoning(target.providerId, target.model, target.baseUrl, stored),
    Boolean(file.fast),
  );
  if (isWebBridgeTarget(target)) {
    try {
      return await completeFreebuffChat({
        dataDir: input.dataDir,
        target,
        system: input.system,
        messages: input.messages,
        toolCtx,
        signal: toolCtx.signal,
        lease: input.lease,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      return {
        text: formatFreebuffError(error),
        provider: target.providerId,
        model: target.model,
        traces: [],
        thinking: "",
        usage: { provider: target.providerId, model: target.model },
      };
    }
  }
  if (OAUTH_PICKER_IDS.has(target.providerId)) {
    try {
      return await completeOAuth({
        dataDir: input.dataDir,
        pickerId: target.providerId,
        model: target.model,
        system: input.system,
        messages: input.messages,
        temperature: input.temperature ?? 0.4,
        reasoning: effort,
        tools: useTools,
        skills: input.skills,
        toolCtx,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      return {
        text: formatOAuthError(
          target.providerId.replace(/-oauth$/, ""),
          message,
        ),
        provider: target.providerId,
        model: target.model,
        traces: [],
        thinking: "",
        usage: { provider: target.providerId, model: target.model },
      };
    }
  }
  try {
    const done = await dispatchComplete(
      target,
      input.system,
      input.messages,
      input.temperature ?? 0.4,
      useTools,
      toolCtx,
      effort,
    );
    if (!done) return null;
    return {
      text: done.text,
      provider: target.providerId,
      model: target.model,
      traces: done.traces,
      thinking: done.thinking,
      usage: {
        ...(done.usage ?? {}),
        provider: target.providerId,
        model: target.model,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (target.transport === "commandcode") {
      const message = error instanceof Error ? error.message : String(error);
      return {
        text: `模型請求失敗：Command Code: ${message}`,
        provider: target.providerId,
        model: target.model,
        traces: [],
        thinking: "",
        usage: { provider: target.providerId, model: target.model },
      };
    }
    return null;
  }
}

type DispatchResult = {
  text: string;
  traces: ToolTrace[];
  thinking: string;
  usage?: ChatUsage;
};

function llmFetch(target: LlmTarget): typeof fetch {
  return target.fetch ?? fetch;
}

async function commandCodeAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 403) {
    let body: unknown;
    try {
      body = await res.clone().json();
    } catch {
      body = undefined;
    }
    if (isCommandCodeUpgradeRequired({ status: 403, body })) {
      throw new CommandCodeUpgradeRequired();
    }
  }
  return res;
}

async function completeCommandCode(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  temperature: number,
  tools: boolean,
  ctx: ToolContext,
  effort?: string,
): Promise<DispatchResult | null> {
  if (commandCodeUsesGenerate(target.apiKey)) {
    return completeCommandCodeGenerate({
      apiKey: target.apiKey,
      model: target.model,
      system,
      messages,
      temperature,
      tools,
      ctx,
      effort,
    });
  }
  const viaProvider: LlmTarget = { ...target, fetch: commandCodeAwareFetch };
  try {
    if (target.api === "anthropic-messages") {
      return tools
        ? await completeAnthropicTools(viaProvider, system, messages, ctx)
        : wrapText(await completeAnthropic(viaProvider, system, messages));
    }
    return tools
      ? await completeOpenAiTools(viaProvider, system, messages, temperature, ctx, effort)
      : wrapText(await completeOpenAi(viaProvider, system, messages, temperature, effort));
  } catch (error) {
    if (!(error instanceof CommandCodeUpgradeRequired)) throw error;
    markCommandCodeGenerate(target.apiKey);
    return completeCommandCodeGenerate({
      apiKey: target.apiKey,
      model: target.model,
      system,
      messages,
      temperature,
      tools,
      ctx,
      effort,
    });
  }
}

export async function dispatchComplete(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  temperature: number,
  tools: boolean,
  ctx: ToolContext,
  effort?: string,
): Promise<DispatchResult | null> {
  if (target.transport === "commandcode") {
    return completeCommandCode(target, system, messages, temperature, tools, ctx, effort);
  }
  if (isWebBridgeTarget(target)) {
    return {
      text: formatFreebuffError("freebuff_unreachable_dispatch"),
      traces: [],
      thinking: "",
    };
  }
  if (isKeylessProvider(target.providerId) && usesZenResponses(target.model)) {
    return tools
      ? completeZenResponsesTools(target, system, messages, ctx, effort)
      : wrapText(await completeZenResponses(target, system, messages, effort));
  }
  if (target.api === "openai-responses") {
    const text = await completeCodex(target, system, messages);
    return text ? { text, traces: [], thinking: "" } : null;
  }
  if (target.api === "anthropic-messages") {
    return tools
      ? completeAnthropicTools(target, system, messages, ctx)
      : wrapText(await completeAnthropic(target, system, messages));
  }
  return tools
    ? completeOpenAiTools(target, system, messages, temperature, ctx, effort)
    : wrapText(await completeOpenAi(target, system, messages, temperature, effort));
}

function wrapText(text: string | null): DispatchResult | null {
  return text ? { text, traces: [], thinking: "" } : null;
}

async function completeOpenAiTools(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  temperature: number,
  ctx: ToolContext,
  effort?: string,
): Promise<DispatchResult | null> {
  type ChatMsg = {
    role: string;
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
    tool_calls?: {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }[];
    tool_call_id?: string;
  };
  const msgs: ChatMsg[] = [
    { role: "system", content: system },
    ...messages,
  ];
  const traces: ToolTrace[] = [];
  const thinkingChunks: string[] = [];
  const catalog = openaiTools(ctx.skills ?? [], ctx);
  const usage = blankUsage();
  const started = Date.now();
  let lastAssistant: ChatMsg | null = null;
  const looped = await runAgentLoop({
    toolCtx: ctx,
    traces,
    thinkingChunks,
    nullIfNoTraces: true,
    ask: async ({ wrap, steer }) => {
      if (wrap) msgs.push({ role: "user", content: TOOL_LOOP_WRAP });
      if (steer) msgs.push({ role: "user", content: steer });
      const extra =
        estimateSendTokens(system) +
        estimateSendTokens(JSON.stringify(catalog)) +
        2048;
      const fitted = trimSendMessages(msgs, extra);
      if (fitted.length < msgs.length) {
        msgs.splice(0, msgs.length, ...fitted);
      }
      const response = await withTransientRetries(
        async () => {
          throwIfAborted(ctx);
          const res = await llmFetch(target)(`${target.baseUrl}/chat/completions`, {
            method: "POST",
            headers: llmRequestHeaders(target),
            body: JSON.stringify({
              model: target.model,
              temperature,
              messages: msgs,
              tools: catalog,
              tool_choice: "auto",
              ...reasoningPayload(target.providerId, target.baseUrl, effort),
            }),
            signal: roundSignal(ctx),
          });
          if (res.ok) return res;
          const err = new Error(`HTTP ${res.status}`);
          if (res.status === 429 || res.status >= 500) throw err;
          return res;
        },
        {
          signal: ctx.signal,
          onRetry: () => {
            emitProgress(ctx, traces, "連線中斷，重試中…");
          },
        },
      );
      if (!response.ok) {
        return {
          calls: [],
          text: `模型請求失敗：HTTP ${response.status}`,
          thinking: "",
        };
      }
      const data = (await response.json()) as {
        choices?: { message?: ChatMsg; finish_reason?: string }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
          input_tokens_details?: { cached_tokens?: number };
        };
      };
      const message = data.choices?.[0]?.message;
      if (!message) return null;
      addUsage(usage, fromOpenAiUsage(data.usage));
      lastAssistant = message;
      const calls = (message.tool_calls ?? []).map((call) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }
        return { id: call.id, name: call.function.name, args };
      });
      return {
        calls,
        text: message.content?.trim() ?? "",
        thinking: (message.reasoning_content || message.reasoning || "").trim(),
      };
    },
    onRetry: (late) => {
      if (lastAssistant) msgs.push(lastAssistant);
      msgs.push({ role: "user", content: late });
    },
    onTools: (calls, outcomes) => {
      if (lastAssistant) msgs.push(lastAssistant);
      for (let i = 0; i < calls.length; i++) {
        msgs.push({
          role: "tool",
          tool_call_id: calls[i].id,
          content: outcomes[i]?.text ?? "",
        });
      }
    },
  });
  if (!looped) return null;
  return {
    text: looped.text,
    traces: looped.traces,
    thinking: looped.thinking,
    usage: withDuration(usage, started),
  };
}

async function completeAnthropicTools(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  ctx: ToolContext,
): Promise<DispatchResult | null> {
  type Part =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
  type Msg = { role: "user" | "assistant"; content: string | Part[] };
  const msgs: Msg[] = messages.map((item) => ({
    role: item.role,
    content: item.content,
  }));
  const tools = openaiTools(ctx.skills ?? [], ctx).map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
  const headers = anthropicHeaders(target);
  const traces: ToolTrace[] = [];
  const usage = blankUsage();
  const started = Date.now();
  let lastParts: Part[] = [];
  const looped = await runAgentLoop({
    toolCtx: ctx,
    traces,
    nullIfNoTraces: true,
    ask: async ({ wrap, steer }) => {
      if (wrap) msgs.push({ role: "user", content: TOOL_LOOP_WRAP });
      if (steer) msgs.push({ role: "user", content: steer });
      const extra =
        estimateSendTokens(system) +
        estimateSendTokens(JSON.stringify(tools)) +
        2048;
      const fitted = trimSendMessages(msgs, extra);
      if (fitted.length < msgs.length) {
        msgs.splice(0, msgs.length, ...fitted);
      }
      const response = await withTransientRetries(
        async () => {
          throwIfAborted(ctx);
          const res = await llmFetch(target)(
            `${target.baseUrl.replace(/\/v1$/, "")}/v1/messages`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                model: target.model,
                max_tokens: 2048,
                system,
                messages: msgs,
                tools,
              }),
              signal: roundSignal(ctx),
            },
          );
          if (res.ok) return res;
          const err = new Error(`HTTP ${res.status}`);
          if (res.status === 429 || res.status >= 500) throw err;
          return res;
        },
        {
          signal: ctx.signal,
          onRetry: () => {
            emitProgress(ctx, traces, "連線中斷，重試中…");
          },
        },
      );
      if (!response.ok) {
        return {
          calls: [],
          text: `模型請求失敗：HTTP ${response.status}`,
          thinking: "",
        };
      }
      const data = (await response.json()) as {
        stop_reason?: string;
        content?: Part[];
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
      const parts = data.content ?? [];
      lastParts = parts;
      addUsage(usage, fromAnthropicUsage(data.usage));
      const uses =
        data.stop_reason === "tool_use"
          ? parts.filter(
              (part): part is Extract<Part, { type: "tool_use" }> =>
                part.type === "tool_use",
            )
          : [];
      const textPart = parts.find((part) => part.type === "text");
      const body =
        textPart && textPart.type === "text" ? textPart.text.trim() : "";
      return {
        calls: uses.map((call) => ({
          id: call.id,
          name: call.name,
          args: call.input ?? {},
        })),
        text: body,
      };
    },
    onRetry: (late) => {
      if (lastParts.length) msgs.push({ role: "assistant", content: lastParts });
      msgs.push({ role: "user", content: late });
    },
    onTools: (calls, outcomes) => {
      if (lastParts.length) msgs.push({ role: "assistant", content: lastParts });
      msgs.push({
        role: "user",
        content: calls.map((call, i) => ({
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: outcomes[i]?.text ?? "",
          is_error: outcomes[i]?.isError,
        })),
      });
    },
  });
  if (!looped) return null;
  return {
    text: looped.text,
    traces: looped.traces,
    thinking: looped.thinking,
    usage: withDuration(usage, started),
  };
}

function anthropicHeaders(target: LlmTarget): Record<string, string> {
  const oauth =
    target.providerId === "anthropic-oauth" ||
    target.apiKey.includes("sk-ant-oat");
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    ...(target.headers ?? {}),
  };
  if (oauth) {
    headers.authorization = `Bearer ${target.apiKey}`;
    headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20";
    headers["user-agent"] = "claude-cli/2.0.0";
    headers["x-app"] = "cli";
  } else if (!headers.authorization && !headers.Authorization) {
    headers["x-api-key"] = target.apiKey;
  }
  return headers;
}

type ZenInput =
  | { role: "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

function zenResponsesTools(
  catalog: ReturnType<typeof openaiTools>,
): { type: "function"; name: string; description: string; parameters: unknown }[] {
  return catalog.map((tool) => ({
    type: "function" as const,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

async function postZenResponses(
  target: LlmTarget,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${target.baseUrl.replace(/\/+$/, "")}/responses`, {
    method: "POST",
    headers: llmRequestHeaders(target),
    body: JSON.stringify(body),
    signal,
  });
}

async function completeZenResponses(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  effort?: string,
): Promise<string | null> {
  const response = await postZenResponses(
    target,
    {
      model: target.model,
      instructions: system,
      input: messages,
      ...reasoningPayload(target.providerId, target.baseUrl, effort),
    },
    AbortSignal.timeout(STREAM_IDLE_TIMEOUT_MS),
  );
  if (!response.ok) return null;
  const data = (await response.json()) as Record<string, unknown>;
  return extractResponsesText(data);
}

async function completeZenResponsesTools(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  ctx: ToolContext,
  effort?: string,
): Promise<DispatchResult | null> {
  const input: ZenInput[] = messages.map((item) => ({
    role: item.role,
    content: item.content,
  }));
  const traces: ToolTrace[] = [];
  const thinkingChunks: string[] = [];
  const catalog = openaiTools(ctx.skills ?? [], ctx);
  const tools = zenResponsesTools(catalog);
  const usage = blankUsage();
  const started = Date.now();
  let lastCalls: Extract<ZenInput, { type: "function_call" }>[] = [];
  const looped = await runAgentLoop({
    toolCtx: ctx,
    traces,
    thinkingChunks,
    nullIfNoTraces: true,
    ask: async ({ wrap, steer }) => {
      if (wrap) input.push({ role: "user", content: TOOL_LOOP_WRAP });
      if (steer) input.push({ role: "user", content: steer });
      const extra =
        estimateSendTokens(system) +
        estimateSendTokens(JSON.stringify(tools)) +
        2048;
      const fitted = trimSendMessages(input, extra);
      if (fitted.length < input.length) {
        input.splice(0, input.length, ...fitted);
      }
      const response = await withTransientRetries(
        async () => {
          throwIfAborted(ctx);
          const res = await postZenResponses(
            target,
            {
              model: target.model,
              instructions: system,
              input,
              tools,
              tool_choice: "auto",
              ...reasoningPayload(target.providerId, target.baseUrl, effort),
            },
            roundSignal(ctx),
          );
          if (res.ok) return res;
          const err = new Error(`HTTP ${res.status}`);
          if (res.status === 429 || res.status >= 500) throw err;
          return res;
        },
        {
          signal: ctx.signal,
          onRetry: () => {
            emitProgress(ctx, traces, "連線中斷，重試中…");
          },
        },
      );
      if (!response.ok) {
        return {
          calls: [],
          text: `模型請求失敗：HTTP ${response.status}`,
          thinking: "",
        };
      }
      const data = (await response.json()) as {
        output?: Record<string, unknown>[];
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          total_tokens?: number;
          input_tokens_details?: { cached_tokens?: number };
        };
      };
      addUsage(
        usage,
        fromOpenAiUsage({
          prompt_tokens: data.usage?.input_tokens,
          completion_tokens: data.usage?.output_tokens,
          total_tokens: data.usage?.total_tokens,
          prompt_tokens_details: {
            cached_tokens: data.usage?.input_tokens_details?.cached_tokens,
          },
        }),
      );
      lastCalls = [];
      const calls: { id: string; name: string; args: Record<string, unknown> }[] =
        [];
      for (const item of data.output ?? []) {
        if (item?.type !== "function_call") continue;
        const callId = String(item.call_id || item.id || "");
        const name = String(item.name || "");
        if (!callId || !name) continue;
        lastCalls.push({
          type: "function_call",
          call_id: callId,
          name,
          arguments: String(item.arguments || "{}"),
        });
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(item.arguments || "{}")) as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }
        calls.push({ id: callId, name, args });
      }
      return {
        calls,
        text: extractResponsesText(data as Record<string, unknown>) ?? "",
        thinking: "",
      };
    },
    onRetry: (late) => {
      input.push({ role: "user", content: late });
    },
    onTools: (calls, outcomes) => {
      for (let i = 0; i < calls.length; i++) {
        const raw = lastCalls[i];
        if (raw) input.push(raw);
        else {
          input.push({
            type: "function_call",
            call_id: calls[i].id,
            name: calls[i].name,
            arguments: JSON.stringify(calls[i].args ?? {}),
          });
        }
        input.push({
          type: "function_call_output",
          call_id: calls[i].id,
          output: outcomes[i]?.text ?? "",
        });
      }
    },
  });
  if (!looped) return null;
  return {
    text: looped.text,
    traces: looped.traces,
    thinking: looped.thinking,
    usage: withDuration(usage, started),
  };
}

async function completeOpenAi(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  temperature: number,
  effort?: string,
): Promise<string | null> {
  const url = `${target.baseUrl}/chat/completions`;
  const response = await llmFetch(target)(url, {
    method: "POST",
    headers: llmRequestHeaders(target),
    body: JSON.stringify({
      model: target.model,
      temperature,
      messages: [{ role: "system", content: system }, ...messages],
      ...reasoningPayload(target.providerId, target.baseUrl, effort),
    }),
    signal: AbortSignal.timeout(STREAM_IDLE_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function completeAnthropic(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string | null> {
  const base = target.baseUrl.replace(/\/v1$/, "");
  const oauth = target.providerId === "anthropic-oauth" || target.apiKey.includes("sk-ant-oat");
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    ...(target.headers ?? {}),
  };
  if (oauth) {
    headers.authorization = `Bearer ${target.apiKey}`;
    headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20";
    headers["user-agent"] = "claude-cli/2.0.0";
    headers["x-app"] = "cli";
  } else if (!headers.authorization && !headers.Authorization) {
    headers["x-api-key"] = target.apiKey;
  }
  const response = await llmFetch(target)(`${base}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: target.model,
      max_tokens: 1024,
      system,
      messages,
    }),
    signal: AbortSignal.timeout(STREAM_IDLE_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    content?: { type?: string; text?: string }[];
  };
  const text = data.content?.find((part) => part.type === "text")?.text;
  return text?.trim() || null;
}

async function completeCodex(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string | null> {
  const accountId =
    target.accountId || chatgptAccountId(target.apiKey) || "";
  if (!accountId) return null;
  const url = `${target.baseUrl.replace(/\/+$/, "")}/codex/responses`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${target.apiKey}`,
    "chatgpt-account-id": accountId,
    "content-type": "application/json",
    accept: "application/json",
    "OpenAI-Beta": "responses=experimental",
    originator: "guild",
  };
  const input = messages.map((item) => ({
    role: item.role,
    content: item.content,
  }));
  const body = {
    model: target.model,
    stream: false,
    store: false,
    instructions: system,
    input,
  };
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(STREAM_IDLE_TIMEOUT_MS),
  });
  if (response.ok) {
    const data = (await response.json()) as Record<string, unknown>;
    return extractResponsesText(data);
  }
  headers.accept = "text/event-stream";
  const streamed = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(STREAM_IDLE_TIMEOUT_MS),
  });
  if (!streamed.ok || !streamed.body) return null;
  return readSseText(streamed);
}

function extractResponsesText(data: Record<string, unknown>): string | null {
  const buckets = [data.output, (data.response as Record<string, unknown> | undefined)?.output];
  for (const output of buckets) {
    if (!Array.isArray(output)) continue;
    const parts: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const rec = part as { type?: string; text?: string };
        if ((rec.type === "output_text" || rec.type === "text") && rec.text) {
          parts.push(rec.text);
        }
      }
    }
    if (parts.length) return parts.join("").trim();
  }
  const text = data.output_text;
  return typeof text === "string" ? text.trim() : null;
}

async function readSseText(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n");
    buffer = chunks.pop() ?? "";
    for (const line of chunks) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const event = JSON.parse(raw) as {
          type?: string;
          delta?: string;
          text?: string;
        };
        if (typeof event.delta === "string") text += event.delta;
        else if (event.type === "response.output_text.delta" && event.text) {
          text += event.text;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return text.trim() || null;
}

function chatgptAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"];
    if (auth && typeof auth === "object") {
      const id = (auth as Record<string, unknown>).chatgpt_account_id;
      if (typeof id === "string" && id) return id;
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeModels(file: ModelsFile): ModelsFile {
  const providers: Record<string, ProviderEntry> = {};
  const incoming = file.providers ?? {};
  for (const [rawId, provider] of Object.entries(incoming)) {
    const id = rawId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id) continue;
    if (!provider || typeof provider !== "object") continue;
    const baseUrl = String(provider.baseUrl ?? "").trim();
    if (!baseUrl) {
      throw new StoreError(400, `provider ${id} needs baseUrl`);
    }
    const api: LlmApi =
      provider.api === "anthropic-messages"
        ? "anthropic-messages"
        : provider.api === "openai-responses"
          ? "openai-responses"
          : "openai-completions";
    const models: ModelEntry[] = (provider.models ?? [])
      .filter((model) => model && typeof model.id === "string" && model.id.trim())
      .map((model) => {
        const reasoning = sanitizeModelReasoning(model.reasoning);
        return {
          id: model.id.trim(),
          name: model.name?.trim() || undefined,
          ...(reasoning ? { reasoning } : {}),
        };
      });
    if (models.length === 0) {
      throw new StoreError(400, `provider ${id} needs at least one model`);
    }
    providers[id] = {
      name: provider.name?.trim() || id,
      baseUrl: baseUrl.replace(/\/+$/, ""),
      api,
      apiKey: provider.apiKey?.trim() || undefined,
      models,
    };
  }
  const oauthModels = (provider: string, model: string): boolean => {
    return OAUTH_PICKER_IDS.has(provider) && Boolean(model);
  };
  const validRef = (ref: ModelRef | null | undefined): ModelRef | null => {
    if (!ref?.provider || !ref.model) return null;
    if (OAUTH_PICKER_IDS.has(ref.provider) && oauthModels(ref.provider, ref.model)) {
      return { provider: ref.provider, model: ref.model };
    }
    if (WEB_BRIDGE_PICKER_IDS.has(ref.provider) && Boolean(ref.model)) {
      return { provider: ref.provider, model: ref.model };
    }
    if (isCommandCodeProvider(ref.provider) && Boolean(ref.model)) {
      return { provider: COMMANDCODE_PICKER_ID, model: ref.model };
    }
    if (providers[ref.provider]?.models.some((m) => m.id === ref.model)) {
      return { provider: ref.provider, model: ref.model };
    }
    return null;
  };
  const aux: ModelsFile["aux"] = {};
  for (const [role, ref] of Object.entries(file.aux ?? {})) {
    aux[role as AuxRole] = validRef(ref as ModelRef | null);
  }
  const reasoning = sanitizeEffort(file.reasoning);
  const recent = (file.recent ?? [])
    .map((ref) => validRef(ref))
    .filter((ref): ref is ModelRef => Boolean(ref))
    .slice(0, 8);
  return {
    default: validRef(file.default ?? null),
    reasoning,
    fast: Boolean(file.fast),
    aux,
    recent,
    providers,
    shown: sanitizeShown(file.shown),
  };
}

function sanitizeShown(raw: ModelsFile["shown"]): ModelsFile["shown"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const shown: Record<string, string[]> = {};
  for (const [id, ids] of Object.entries(raw)) {
    const key = String(id || "").trim();
    if (!key || !Array.isArray(ids)) continue;
    shown[key] = ids.filter((item) => typeof item === "string" && item.trim());
  }
  return Object.keys(shown).length ? shown : undefined;
}
