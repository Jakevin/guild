/**
 * Subscription login + completion, same path as
 * https://github.com/ziyou979/dsh-llm-oauth: `@earendil-works/pi-ai`
 * with a durable CredentialStore so tokens refresh on the request.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  contentText,
  createModels,
  type AssistantMessage,
  type AuthEvent,
  type AuthInteraction,
  type AuthPrompt,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type Message,
  type MutableModels,
  type OAuthCredential,
} from "@earendil-works/pi-ai";
import {
  guildTools,
  LLM_ROUND_TIMEOUT_MS,
  TOOL_LOOP_EXHAUSTED,
  TOOL_LOOP_WRAP,
  type SkillRef,
  type ToolContext,
  type ToolTrace,
} from "./tools.ts";
import { runAgentLoop } from "./harness.ts";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { defaultDataDir, StoreError } from "./store.ts";
import {
  addUsage,
  blankUsage,
  fromPiUsage,
  withDuration,
} from "./usage.ts";
import type { ChatUsage } from "@guild/protocol";

export type ModelEntryLite = { id: string; name: string };
export type SubscriptionFlow = "device" | "pkce";

export type SubscriptionDef = {
  id: string;
  pickerId: string;
  name: string;
  hint: string;
  loginHint?: string;
  flow: SubscriptionFlow;
};

export const SUBSCRIPTIONS: SubscriptionDef[] = [
  {
    id: "xai",
    pickerId: "xai-oauth",
    name: "xAI Grok",
    hint: "SuperGrok / X Premium+ 訂閱。裝置碼登入，不必貼 API key。",
    flow: "device",
  },
  {
    id: "openai-codex",
    pickerId: "openai-codex",
    name: "ChatGPT Codex",
    hint: "ChatGPT Plus/Pro 訂閱。Web 走裝置碼（與 dsh-llm-oauth 相同）。",
    loginHint:
      "先到 ChatGPT → Settings → Apps & connectors，開啟 Codex 的 device code authorization。非正式客戶端有帳號風險。",
    flow: "device",
  },
  {
    id: "anthropic",
    pickerId: "anthropic-oauth",
    name: "Claude Pro/Max",
    hint: "Claude 訂閱。瀏覽器 PKCE，完成後自動回到 Guild。",
    flow: "pkce",
  },
  {
    id: "github-copilot",
    pickerId: "github-copilot",
    name: "GitHub Copilot",
    hint: "GitHub Copilot 訂閱。裝置碼登入 github.com。",
    flow: "device",
  },
  {
    id: "openrouter",
    pickerId: "openrouter-oauth",
    name: "OpenRouter",
    hint: "OpenRouter OAuth 會換成你帳號下的 API key，從點數扣款。",
    flow: "pkce",
  },
];

export const OAUTH_PICKER_IDS = new Set(SUBSCRIPTIONS.map((s) => s.pickerId));
const CATALOG_IDS = SUBSCRIPTIONS.map((s) => s.id);

export function subscriptionById(id: string): SubscriptionDef | undefined {
  return SUBSCRIPTIONS.find((s) => s.id === id);
}

export function subscriptionByPicker(pickerId: string): SubscriptionDef | undefined {
  return SUBSCRIPTIONS.find((s) => s.pickerId === pickerId);
}

export function oauthPath(dataDir: string): string {
  return join(dataDir, "oauth.json");
}

class FileCredentialStore implements CredentialStore {
  private cache: Record<string, Credential> | undefined;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    readonly path: string,
    private readonly seedPaths: string[],
  ) {}

  private load(): Record<string, Credential> {
    const cached = this.cache;
    if (cached) {
      const xai = cached.xai;
      if (xai?.type !== "oauth" || Date.now() + 60_000 < xai.expires) {
        return cached;
      }
    }
    this.cache = hydrateAuthFile(this.path, this.seedPaths);
    return this.cache;
  }

  private save(next: Record<string, Credential>): void {
    this.cache = next;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    this.chains.set(providerId, run.then(() => undefined, () => undefined));
    return run;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return this.load()[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.load()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      const file = { ...this.load() };
      const next = await fn(file[providerId]);
      if (next === undefined) return file[providerId];
      file[providerId] = next;
      this.save(file);
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.enqueue(providerId, async () => {
      const file = { ...this.load() };
      if (file[providerId] === undefined) return;
      delete file[providerId];
      this.save(file);
    });
  }

  peek(providerId: string): Credential | undefined {
    return this.load()[providerId];
  }
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* missing or invalid */
  }
  return {};
}

function parseExpiry(rec: Record<string, unknown>): number {
  for (const n of [rec.expires, rec.expiresAt, rec.expires_at]) {
    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      return n > 1e12 ? n : n * 1000;
    }
    if (typeof n === "string" && n.trim()) {
      const t = Date.parse(n);
      if (!Number.isNaN(t)) return t;
    }
  }
  return Date.now() + 3600_000;
}

function asCredential(raw: unknown): Credential | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  if (rec.type === "api_key" && typeof rec.key === "string") {
    return rec as Credential;
  }
  if (rec.type === "oauth" && typeof rec.access === "string") {
    const typed = rec as OAuthCredential;
    const expires = parseExpiry(rec);
    if (expires !== typed.expires) {
      return { ...typed, expires };
    }
    return typed;
  }
  const grokCliKey =
    typeof rec.key === "string" &&
    rec.key &&
    (typeof rec.refresh_token === "string" ||
      typeof rec.refresh === "string" ||
      rec.auth_mode === "oidc");
  const access =
    (typeof rec.access === "string" && rec.access) ||
    (typeof rec.accessToken === "string" && rec.accessToken) ||
    (typeof rec.access_token === "string" && rec.access_token) ||
    (grokCliKey ? rec.key : "") ||
    "";
  if (!access) return undefined;
  const refresh =
    (typeof rec.refresh === "string" && rec.refresh) ||
    (typeof rec.refreshToken === "string" && rec.refreshToken) ||
    (typeof rec.refresh_token === "string" && rec.refresh_token) ||
    "";
  const cred: OAuthCredential = {
    type: "oauth",
    access,
    refresh,
    expires: parseExpiry(rec),
  };
  if (typeof rec.accountId === "string") cred.accountId = rec.accountId;
  if (Array.isArray(rec.availableModelIds)) {
    cred.availableModelIds = rec.availableModelIds.filter(
      (item): item is string => typeof item === "string",
    );
  }
  return cred;
}

export function oauthCredentialFromUnknown(raw: unknown): Credential | undefined {
  return asCredential(raw);
}

export function xaiFromGrokAuthFile(
  raw: unknown,
): OAuthCredential | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const direct = asCredential(rec);
  if (direct?.type === "oauth") return direct;
  for (const [key, value] of Object.entries(rec)) {
    if (
      !key.includes("auth.x.ai") &&
      !(
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        ("refresh_token" in value || "key" in value)
      )
    ) {
      continue;
    }
    const cred = asCredential(value);
    if (cred?.type === "oauth") return cred;
  }
  return undefined;
}

function takeBetterOAuth(
  current: Credential | undefined,
  incoming: Credential | undefined,
): Credential | undefined {
  if (!incoming || incoming.type !== "oauth") return current;
  if (!current || current.type !== "oauth") return incoming;
  const now = Date.now();
  const incomingOk = incoming.expires > now;
  const currentOk = current.expires > now;
  if (incomingOk && !currentOk) return incoming;
  if (incoming.expires > current.expires + 5000) return incoming;
  return current;
}

function hydrateAuthFile(
  path: string,
  seedPaths: string[],
): Record<string, Credential> {
  const file: Record<string, Credential> = {};
  const incoming = readJsonObject(path);
  let dirty = false;
  for (const [id, raw] of Object.entries(incoming)) {
    const cred = asCredential(raw);
    if (!cred) continue;
    file[id] = cred;
    if (!(raw && typeof raw === "object" && (raw as { type?: string }).type)) {
      dirty = true;
    }
  }
  for (const seed of seedPaths) {
    const extra = readJsonObject(seed);
    for (const id of CATALOG_IDS) {
      const cred = asCredential(extra[id]);
      if (!cred || cred.type !== "oauth") continue;
      const better = takeBetterOAuth(file[id], cred);
      if (better && better !== file[id]) {
        file[id] = better;
        dirty = true;
      }
    }
    const grokXai = xaiFromGrokAuthFile(extra);
    if (grokXai) {
      const better = takeBetterOAuth(file.xai, grokXai);
      if (better && better !== file.xai) {
        file.xai = better;
        dirty = true;
      }
    }
  }
  if (dirty) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  }
  return file;
}

const modelsByDir = new Map<string, MutableModels>();
const storesByDir = new Map<string, FileCredentialStore>();
let providerCache: ReturnType<typeof builtinProviders> | undefined;

/** SuperGrok / X Premium+ is billed on the Grok CLI proxy, not api.x.ai. */
export const GROK_CLI_PROXY = "https://cli-chat-proxy.grok.com/v1";

function grokCliVersion(): string {
  try {
    const raw = JSON.parse(
      readFileSync(join(homedir(), ".grok", "version.json"), "utf8"),
    ) as { version?: string };
    if (typeof raw.version === "string" && raw.version.trim()) {
      return raw.version.trim();
    }
  } catch {
    /* ignore */
  }
  return "1.0.5";
}

export function grokCliHeaders(): Record<string, string> {
  const version = grokCliVersion();
  return {
    "X-XAI-Token-Auth": "xai-grok-cli",
    "x-grok-client-identifier": "grok-shell",
    "x-grok-client-version": version,
    "User-Agent": `xai-grok-cli/${version}`,
  };
}

function withGrokSubscriptionProxy<T extends { id: string }>(
  provider: T,
): T {
  if (provider.id !== "xai") return provider;
  const stock = provider as T & {
    baseUrl?: string;
    headers?: Record<string, string>;
    getModels?: () => readonly { baseUrl?: string; headers?: Record<string, string> }[];
  };
  const headers = grokCliHeaders();
  const originalGetModels = stock.getModels?.bind(stock);
  return {
    ...stock,
    name: "xAI Grok",
    baseUrl: GROK_CLI_PROXY,
    headers: { ...stock.headers, ...headers },
    getModels() {
      const models = originalGetModels ? originalGetModels() : [];
      return models.map((model) => ({
        ...model,
        baseUrl: GROK_CLI_PROXY,
        headers: { ...headers, ...(model.headers ?? {}) },
      }));
    },
  };
}

function catalogProviders() {
  if (!providerCache) providerCache = builtinProviders();
  return CATALOG_IDS.map((id) => providerCache!.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => withGrokSubscriptionProxy(p));
}

function oauthSeedPaths(dataDir: string): string[] {
  if (resolve(dataDir) !== resolve(defaultDataDir())) return [];
  return [
    join(homedir(), ".pi", "agent", "auth.json"),
    join(homedir(), ".dsh", "pi-ai-oauth.json"),
    join(homedir(), ".grok", "auth.json"),
  ];
}

function getStore(dataDir: string): FileCredentialStore {
  const existing = storesByDir.get(dataDir);
  if (existing) return existing;
  const store = new FileCredentialStore(oauthPath(dataDir), oauthSeedPaths(dataDir));
  storesByDir.set(dataDir, store);
  return store;
}

function piModels(dataDir: string): MutableModels {
  const hit = modelsByDir.get(dataDir);
  if (hit) return hit;
  const models = createModels({ credentials: getStore(dataDir) });
  for (const provider of catalogProviders()) models.setProvider(provider);
  modelsByDir.set(dataDir, models);
  return models;
}

function catalogModels(id: string, dataDir: string): ModelEntryLite[] {
  try {
    const models = piModels(dataDir).getModels(id);
    if (models.length) {
      return models.map((model) => ({
        id: model.id,
        name: model.name || model.id,
      }));
    }
  } catch {
    /* catalog not ready */
  }
  return [];
}

export type OAuthStatus = {
  id: string;
  pickerId: string;
  name: string;
  hint: string;
  loginHint?: string;
  flow: SubscriptionFlow;
  connected: boolean;
  pending: boolean;
  ready: boolean;
  kind: "oauth";
  models: ModelEntryLite[];
  userCode?: string;
  verificationUri?: string;
  importHint?: string | null;
  error?: string;
};

type LoginWatch = {
  provider: string;
  status: "waiting" | "ok" | "error";
  detail?: string;
  openUrl?: string;
  userCode?: string;
  flow: SubscriptionFlow;
  resolvePrompt?: (value: string) => void;
};

const watches = new Map<string, LoginWatch>();

function importHintFor(id: string): string | null {
  const pi = join(homedir(), ".pi", "agent", "auth.json");
  const grok = join(homedir(), ".grok", "auth.json");
  const dsh = join(homedir(), ".dsh", "pi-ai-oauth.json");
  try {
    if (asCredential(readJsonObject(pi)[id])) return "偵測到 ~/.pi/agent/auth.json";
  } catch {
    /* ignore */
  }
  if (id === "xai") {
    try {
      if (xaiFromGrokAuthFile(readJsonObject(grok))) {
        return "偵測到 ~/.grok/auth.json";
      }
    } catch {
      /* ignore */
    }
  }
  try {
    if (asCredential(readJsonObject(dsh)[id])) return "偵測到 ~/.dsh/pi-ai-oauth.json";
  } catch {
    /* ignore */
  }
  return null;
}

function hasOAuth(dataDir: string, id: string): boolean {
  const cred = getStore(dataDir).peek(id);
  return Boolean(cred && cred.type === "oauth" && cred.access);
}

function oauthUsable(dataDir: string, id: string): boolean {
  const cred = getStore(dataDir).peek(id);
  if (!cred || cred.type !== "oauth" || !cred.access) return false;
  if (Date.now() < cred.expires) return true;
  return Boolean(cred.refresh);
}

export function storedAccessToken(dataDir: string, id: string): string | null {
  const cred = getStore(dataDir).peek(id);
  if (cred?.type === "oauth" && cred.access) return cred.access;
  return null;
}

export function oauthStatus(dataDir: string, id: string): OAuthStatus {
  const def = subscriptionById(id);
  if (!def) throw new StoreError(400, `unknown subscription ${id}`);
  const watch = watches.get(id);
  const connected = hasOAuth(dataDir, id);
  const ready = oauthUsable(dataDir, id);
  const provider = catalogProviders().find((p) => p.id === id);
  return {
    id: def.id,
    pickerId: def.pickerId,
    name: provider?.name || def.name,
    hint: def.hint,
    loginHint: def.loginHint,
    flow: def.flow,
    kind: "oauth",
    connected,
    pending: watch?.status === "waiting",
    ready,
    models: catalogModels(id, dataDir),
    userCode: watch?.userCode,
    verificationUri: watch?.openUrl,
    importHint: importHintFor(id),
    error: watch?.status === "error" ? watch.detail : undefined,
  };
}

export function listSubscriptions(dataDir: string): OAuthStatus[] {
  return SUBSCRIPTIONS.map((def) => oauthStatus(dataDir, def.id));
}

function pickSelectOption(
  provider: string,
  options: readonly { id: string; label: string; description?: string }[],
): { id: string; label: string } {
  const byId = (id: string) => options.find((option) => option.id === id);
  if (provider === "openai-codex") {
    const device = byId("device_code");
    if (device) return device;
  }
  const headless = options.find((option) =>
    /device[_-]?code|headless|cli/i.test(
      `${option.id} ${option.label} ${option.description ?? ""}`,
    ),
  );
  if (headless) return headless;
  return options[0]!;
}

function answerOptionalText(
  provider: string,
  prompt: AuthPrompt,
): string | undefined {
  if (prompt.type !== "text") return undefined;
  const blob = `${prompt.message} ${prompt.placeholder ?? ""}`.toLowerCase();
  if (
    provider === "github-copilot" ||
    /enterprise|blank for github\.com|github\.com/i.test(blob)
  ) {
    return "";
  }
  if (/\bblank\b|\boptional\b|\bleave empty\b|\(empty\)/i.test(blob)) {
    return "";
  }
  return undefined;
}

function waitForPaste(watch: LoginWatch, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = (value: string) => {
      watch.resolvePrompt = undefined;
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      watch.resolvePrompt = undefined;
      reject(new Error("Login cancelled"));
    };
    watch.resolvePrompt = finish;
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function startLogin(dataDir: string, id: string): Promise<OAuthStatus> {
  const def = subscriptionById(id);
  if (!def) throw new StoreError(400, `unknown subscription ${id}`);
  const existing = watches.get(id);
  if (existing?.status === "waiting") return oauthStatus(dataDir, id);

  const models = piModels(dataDir);
  if (!models.getProvider(id)) {
    throw new StoreError(400, `unknown subscription ${id}`);
  }

  const watch: LoginWatch = {
    provider: id,
    status: "waiting",
    flow: def.flow,
  };
  watches.set(id, watch);

  let released = false;
  let release!: (error?: Error) => void;
  const firstNotice = new Promise<void>((resolve, reject) => {
    release = (error?: Error) => {
      if (released) return;
      released = true;
      if (error) reject(error);
      else resolve();
    };
  });

  const interaction: AuthInteraction = {
    async prompt(prompt) {
      if (prompt.type === "select" && prompt.options.length > 0) {
        return pickSelectOption(id, prompt.options).id;
      }
      const optional = answerOptionalText(id, prompt);
      if (optional !== undefined) return optional;
      if (prompt.type === "manual_code" || prompt.type === "text") {
        return waitForPaste(watch, prompt.signal);
      }
      throw new Error(
        `Interactive prompt required (${prompt.type}: ${prompt.message}). ` +
          "Paste the redirect URL on the settings page.",
      );
    },
    notify(event: AuthEvent) {
      if (event.type === "auth_url") watch.openUrl = event.url;
      if (event.type === "device_code") {
        watch.openUrl = event.verificationUri;
        watch.userCode = event.userCode;
      }
      if (event.type === "device_code" || event.type === "auth_url") release();
    },
  };

  const finished = models.login(id, "oauth", interaction).then(
    () => {
      watch.status = "ok";
      watch.detail = `Logged in to ${id}`;
    },
    (error: unknown) => {
      watch.status = "error";
      watch.detail = error instanceof Error ? error.message : String(error);
      release(error instanceof Error ? error : new Error(watch.detail));
    },
  );
  void finished;

  try {
    await firstNotice;
  } catch (error) {
    throw new StoreError(
      502,
      error instanceof Error ? error.message : String(error),
    );
  }
  return oauthStatus(dataDir, id);
}

export async function pollLogin(dataDir: string, id: string): Promise<OAuthStatus> {
  const def = subscriptionById(id);
  if (!def) throw new StoreError(400, `unknown subscription ${id}`);
  const watch = watches.get(id);
  if (watch?.status === "error") {
    return { ...oauthStatus(dataDir, id), error: watch.detail };
  }
  return oauthStatus(dataDir, id);
}

export async function completeLogin(
  dataDir: string,
  id: string,
  input: { code?: string; url?: string },
): Promise<OAuthStatus> {
  const watch = watches.get(id);
  const value = (input.url || input.code || "").trim();
  if (!watch?.resolvePrompt) {
    throw new StoreError(400, "no pending browser login");
  }
  if (!value) throw new StoreError(400, "missing authorization code");
  watch.resolvePrompt(value);
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (watch.status !== "waiting") break;
  }
  return oauthStatus(dataDir, id);
}

export async function logoutOAuth(dataDir: string, id: string): Promise<OAuthStatus> {
  const def = subscriptionById(id);
  if (!def) throw new StoreError(400, `unknown subscription ${id}`);
  watches.delete(id);
  await piModels(dataDir).logout(id);
  return oauthStatus(dataDir, id);
}

export function formatOAuthError(provider: string, message?: string): string {
  const text = (message ?? "").trim();
  if (
    /^模型請求/.test(text) ||
    text.includes("不是訂閱失效") ||
    text.includes("登入已失效")
  ) {
    return text;
  }
  if (/terminated|timed?\s*out|timeout|aborted/i.test(text)) {
    return "模型請求逾時，多半是思考或工具跑太久，不是訂閱失效。再送一次即可。";
  }
  if (/401|unauthorized|invalid.?token|not logged in/i.test(text)) {
    return "登入已失效，請到模型頁重新連接。";
  }
  if (provider === "xai" && /426|outdated/i.test(text)) {
    return "Grok CLI 被判定過舊。請執行 grok update。";
  }
  if (
    provider === "xai" &&
    /402|credits|Grok subscription|spending-limit/i.test(text)
  ) {
    return (
      "Grok 訂閱走 grok.com CLI（SuperGrok / X Premium+），不是 console.x.ai 的 API 點數。" +
      (text ? ` 原文：${text}` : "")
    );
  }
  return text ? `模型請求失敗：${text}` : "模型請求失敗";
}

export async function completeOAuth(input: {
  dataDir: string;
  pickerId: string;
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  temperature?: number;
  reasoning?: "minimal" | "low" | "medium" | "high";
  tools?: boolean;
  skills?: SkillRef[];
  toolCtx?: ToolContext;
}): Promise<{
  text: string;
  provider: string;
  model: string;
  traces: ToolTrace[];
  thinking: string;
  usage: ChatUsage;
}> {
  const sub = subscriptionByPicker(input.pickerId);
  if (!sub) throw new Error(`unknown oauth provider ${input.pickerId}`);
  const models = piModels(input.dataDir);
  const model = models.getModel(sub.id, input.model);
  if (!model) throw new Error(`${sub.id} has no model ${input.model}`);
  const auth = await models.checkAuth(sub.id);
  if (!auth) {
    throw new Error(`${sub.name} is not logged in`);
  }
  const now = Date.now();
  const transcript: Message[] = input.messages.map((item) =>
    item.role === "user"
      ? { role: "user" as const, content: item.content, timestamp: now }
      : stubAssistant(model, item.content, now),
  );
  const useTools = Boolean(input.tools);
  const options: {
    temperature: number;
    reasoning?: "minimal" | "low" | "medium" | "high";
    timeoutMs: number;
    transformHeaders?: (
      headers: Record<string, string | null>,
    ) => Record<string, string | null>;
  } = {
    temperature: input.temperature ?? 0.4,
    reasoning: input.reasoning,
    timeoutMs: LLM_ROUND_TIMEOUT_MS,
    ...(sub.id === "xai"
      ? {
          transformHeaders: (headers: Record<string, string | null>) => ({
            ...headers,
            ...grokCliHeaders(),
          }),
        }
      : {}),
  };
  const traces: ToolTrace[] = [];
  const thinkingChunks: string[] = [];
  const usage = blankUsage();
  usage.provider = input.pickerId;
  usage.model = input.model;
  const started = Date.now();
  const finish = (text: string) => ({
    text,
    provider: input.pickerId,
    model: input.model,
    traces,
    thinking: thinkingChunks.join("\n\n"),
    usage: withDuration(usage, started),
  });
  const toolCtx: ToolContext = input.toolCtx ?? {
    skills: input.skills,
    dataDir: input.dataDir,
    spawnDepth: 0,
    allowWrite: true,
  };
  const tools = guildTools(input.skills ?? [], toolCtx);
  let lastResult: AssistantMessage | null = null;
  const looped = await runAgentLoop({
    toolCtx,
    traces,
    thinkingChunks,
    ask: async ({ wrap, steer }) => {
      if (wrap) {
        transcript.push({
          role: "user",
          content: TOOL_LOOP_WRAP,
          timestamp: Date.now(),
        });
      }
      if (steer) {
        transcript.push({
          role: "user",
          content: steer,
          timestamp: Date.now(),
        });
      }
      const result = await models.completeSimple(
        model,
        {
          systemPrompt: input.system,
          messages: transcript,
          ...(useTools ? { tools } : {}),
        },
        options,
      );
      if (result.stopReason === "error" || result.stopReason === "aborted") {
        throw new Error(
          formatOAuthError(sub.id, result.errorMessage) ||
            `${sub.id} request failed`,
        );
      }
      addUsage(usage, fromPiUsage(result.usage));
      lastResult = result;
      const think = result.content
        .filter(
          (part): part is Extract<typeof part, { type: "thinking" }> =>
            part.type === "thinking",
        )
        .map((part) => part.thinking)
        .join("\n")
        .trim();
      const calls =
        result.stopReason === "toolUse"
          ? result.content.filter(
              (part): part is Extract<typeof part, { type: "toolCall" }> =>
                part.type === "toolCall",
            )
          : [];
      const text = contentText(result.content).trim();
      if (!calls.length && !text && traces.length === 0) {
        throw new Error(`${sub.id} returned an empty reply`);
      }
      return {
        calls: calls.map((call) => ({
          id: call.id,
          name: call.name,
          args: (call.arguments ?? {}) as Record<string, unknown>,
        })),
        text,
        thinking: think,
      };
    },
    onRetry: (late) => {
      if (lastResult) transcript.push(lastResult);
      transcript.push({
        role: "user",
        content: late,
        timestamp: Date.now(),
      });
    },
    onTools: (calls, outcomes) => {
      if (lastResult) transcript.push(lastResult);
      for (let i = 0; i < calls.length; i++) {
        transcript.push({
          role: "toolResult",
          toolCallId: calls[i].id,
          toolName: calls[i].name,
          content: [{ type: "text", text: outcomes[i]?.text ?? "" }],
          isError: outcomes[i]?.isError,
          timestamp: Date.now(),
        });
      }
    },
  });
  if (!looped) return finish(TOOL_LOOP_EXHAUSTED);
  return finish(looped.text);
}

function stubAssistant(
  model: { api: AssistantMessage["api"]; provider: string; id: string },
  text: string,
  timestamp: number,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

export async function accessToken(
  dataDir: string,
  id: string,
): Promise<{ accessToken: string } | null> {
  const auth = storedAccessToken(dataDir, id);
  if (!auth) return null;
  const resolved = await piModels(dataDir).getAuth(id);
  const key = resolved?.auth.apiKey;
  if (!key) return { accessToken: auth };
  return { accessToken: key };
}

export async function xaiAccessToken(dataDir: string): Promise<string | null> {
  const tokens = await accessToken(dataDir, "xai");
  return tokens?.accessToken ?? null;
}
