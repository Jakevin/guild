import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  storedAccessToken,
  subscriptionByPicker,
} from "./oauth.ts";
import {
  openaiTools,
  roundSignal,
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

export const AUX_ROLES: { id: AuxRole; name: string; hint: string }[] = [
  { id: "vision", name: "Vision", hint: "Image analysis" },
  { id: "web", name: "Web extract", hint: "Page summarization" },
  { id: "compression", name: "Compression", hint: "Context compaction" },
  { id: "skills", name: "Skills hub", hint: "Skill search" },
  { id: "approval", name: "Approval", hint: "Command risk scoring" },
  { id: "title", name: "Title", hint: "Session titles" },
  { id: "generate", name: "Generate", hint: "Soul / Agent / Skill markdown" },
];

export const DEFAULT_MODELS: ModelsFile = {
  default: null,
  reasoning: "medium",
  fast: false,
  aux: {},
  recent: [],
  providers: {
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
    return parsed;
  } catch {
    return structuredClone(DEFAULT_MODELS);
  }
}

export function writeModelsFile(dataDir: string, file: ModelsFile): ModelsFile {
  const cleaned = sanitizeModels(file);
  writeFileSync(modelsPath(dataDir), `${JSON.stringify(cleaned, null, 2)}\n`);
  return cleaned;
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
  return writeModelsFile(dataDir, next);
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

export function publicModels(dataDir: string, env: NodeJS.ProcessEnv = process.env) {
  const file = readModelsFile(dataDir);
  const providers: PublicProvider[] = Object.entries(file.providers).map(
    ([id, provider]) => {
      const key = provider.apiKey ?? "";
      const stored = !key ? "empty" : key.startsWith("$") ? "env" : "literal";
      return {
        id,
        ...provider,
        apiKey: stored === "literal" ? "" : key,
        apiKeyPreview: key ? maskApiKey(key) : "",
        stored,
      };
    },
  );
  const target = resolveLlm(dataDir, env);
  const subscriptions = listSubscriptions(dataDir);
  const picker = [
    ...providers.map((p) => ({
      id: p.id,
      name: p.name || p.id,
      kind: "key" as const,
      ready: Boolean(resolveApiKey(p.apiKey, env) || p.stored === "literal"),
      models: p.models,
    })),
    ...subscriptions.map((s) => ({
      id: s.pickerId,
      name: s.name,
      kind: "oauth" as const,
      ready: s.ready,
      models: s.models ?? [],
    })),
  ];
  return {
    default: file.default ?? null,
    reasoning: file.reasoning ?? "medium",
    fast: Boolean(file.fast),
    aux: file.aux ?? {},
    auxRoles: AUX_ROLES,
    recent: file.recent ?? [],
    providers,
    subscriptions,
    picker,
    active: target
      ? {
          provider: target.providerId,
          model: target.model,
          ready: true,
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

export function resolveLlm(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  role?: AuxRole | "chat",
  prefer?: ModelRef | null,
): LlmTarget | null {
  const file = readModelsFile(dataDir);
  const ref: ModelRef | null | undefined =
    prefer ??
    (role && role !== "chat" ? file.aux?.[role] : file.default);
  const tryProvider = (id: string, modelId?: string): LlmTarget | null => {
    const oauth = oauthTarget(dataDir, id, modelId);
    if (oauth) return oauth;
    const provider = file.providers[id];
    if (!provider) return null;
    const apiKey = resolveApiKey(provider.apiKey, env);
    if (!apiKey) return null;
    const model = modelId || provider.models[0]?.id || "";
    if (!model) return null;
    return {
      providerId: id,
      model,
      baseUrl: provider.baseUrl.replace(/\/+$/, ""),
      apiKey,
      api: provider.api,
    };
  };
  if (ref?.provider) {
    const hit = tryProvider(ref.provider, ref.model);
    if (hit) return hit;
  }
  if (file.default?.provider) {
    const hit = tryProvider(file.default.provider, file.default.model);
    if (hit) return hit;
  }
  for (const id of Object.keys(file.providers)) {
    const hit = tryProvider(id);
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
  if (OAUTH_PICKER_IDS.has(target.providerId)) {
    try {
      const file = readModelsFile(input.dataDir);
      return await completeOAuth({
        dataDir: input.dataDir,
        pickerId: target.providerId,
        model: target.model,
        system: input.system,
        messages: input.messages,
        temperature: input.temperature ?? 0.4,
        reasoning: file.fast ? "low" : file.reasoning,
        tools: useTools,
        skills: input.skills,
        toolCtx,
      });
    } catch (error) {
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
  } catch {
    return null;
  }
}

type DispatchResult = {
  text: string;
  traces: ToolTrace[];
  thinking: string;
  usage?: ChatUsage;
};

async function dispatchComplete(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  temperature: number,
  tools: boolean,
  ctx: ToolContext,
): Promise<DispatchResult | null> {
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
    ? completeOpenAiTools(target, system, messages, temperature, ctx)
    : wrapText(await completeOpenAi(target, system, messages, temperature));
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
      const response = await fetch(`${target.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${target.apiKey}`,
          "content-type": "application/json",
          ...(target.headers ?? {}),
        },
        body: JSON.stringify({
          model: target.model,
          temperature,
          messages: msgs,
          tools: catalog,
          tool_choice: "auto",
        }),
        signal: roundSignal(ctx),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        choices?: { message?: ChatMsg; finish_reason?: string }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
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
      const response = await fetch(
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
      if (!response.ok) return null;
      const data = (await response.json()) as {
        stop_reason?: string;
        content?: Part[];
        usage?: { input_tokens?: number; output_tokens?: number };
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

async function completeOpenAi(
  target: LlmTarget,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  temperature: number,
): Promise<string | null> {
  const url = `${target.baseUrl}/chat/completions`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${target.apiKey}`,
    "content-type": "application/json",
    ...(target.headers ?? {}),
  };
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: target.model,
      temperature,
      messages: [{ role: "system", content: system }, ...messages],
    }),
    signal: AbortSignal.timeout(25_000),
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
  const response = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: target.model,
      max_tokens: 1024,
      system,
      messages,
    }),
    signal: AbortSignal.timeout(25_000),
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
    signal: AbortSignal.timeout(40_000),
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
    signal: AbortSignal.timeout(40_000),
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
      .map((model) => ({
        id: model.id.trim(),
        name: model.name?.trim() || undefined,
      }));
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
    if (providers[ref.provider]?.models.some((m) => m.id === ref.model)) {
      return { provider: ref.provider, model: ref.model };
    }
    return null;
  };
  const aux: ModelsFile["aux"] = {};
  for (const [role, ref] of Object.entries(file.aux ?? {})) {
    aux[role as AuxRole] = validRef(ref as ModelRef | null);
  }
  const reasoning =
    file.reasoning === "minimal" ||
    file.reasoning === "low" ||
    file.reasoning === "high"
      ? file.reasoning
      : "medium";
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
  };
}
