/**
 * Command Code provider (unofficial). Protocol copied from
 * pi-commandcode-provider / dsh-commandcode-provider:
 *   GET  {apiBase}/provider/v1/models
 *   POST {apiBase}/provider/v1/chat/completions  (or Anthropic messages)
 *   403 upgrade_required → POST {apiBase}/alpha/generate
 * Login is the official `cmd login` loopback, not a Guild-only fuse.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LlmApi, ModelEntry } from "@guild/protocol";
import { StoreError } from "./store.ts";

export const COMMANDCODE_PICKER_ID = "commandcode";
export const COMMANDCODE_API_BASE = "https://api.commandcode.ai";
export const COMMANDCODE_PROVIDER_API_BASE = `${COMMANDCODE_API_BASE}/provider/v1`;
export const COMMANDCODE_STUDIO_BASE = "https://commandcode.ai";
export const COMMANDCODE_DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
export const COMMAND_CODE_CLI_VERSION = "1.47.0";
export const COMMANDCODE_MODELS_TIMEOUT_MS = 10_000;
export const COMMANDCODE_REQUEST_TIMEOUT_MS = 60_000;

export const COMMANDCODE_HINT =
  "Command Code 訂閱。Connect 走官方 cmd login（瀏覽器 loopback）；也可貼 API key 或設 COMMAND_CODE_API_KEY。工具仍由 Guild 跑。";
export const COMMANDCODE_LOGIN_HINT =
  "社群接線，條款是 Command Code 的。登入需要本機瀏覽器能打回 127.0.0.1。遠端 Host 請改貼 key。";

const ALIASES = new Set(["commandcode", "command-code", "command_code"]);

export type CommandCodeAuthSource = "guild" | "env" | "cli-auth" | null;

export type CommandCodeAuth = {
  token?: string;
  source: CommandCodeAuthSource;
};

export type CommandCodeModel = {
  id: string;
  name: string;
  api: LlmApi;
  contextWindow: number;
};

export type CommandCodeState = {
  apiKey?: string;
  connectedAt?: string;
  userName?: string;
  keyName?: string;
};

export type CommandCodeStatus = {
  id: typeof COMMANDCODE_PICKER_ID;
  pickerId: typeof COMMANDCODE_PICKER_ID;
  name: string;
  hint: string;
  loginHint: string;
  kind: "commandcode";
  connected: boolean;
  pending: boolean;
  ready: boolean;
  models: ModelEntry[];
  catalog: ModelEntry[];
  shownIds: string[] | null;
  importHint?: string | null;
  loginUrl?: string;
  error?: string;
};

export type GenerateCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type GenerateRound = {
  text: string;
  thinking: string;
  calls: GenerateCall[];
};

type CommandCodeHooks = {
  homedir?: () => string;
  fetch?: typeof fetch;
  now?: () => number;
};

let hooks: CommandCodeHooks = {};
let catalogMemo: { at: number; dataDir: string; models: CommandCodeModel[] } | null = null;
const generateKeys = new Set<string>();
const CATALOG_TTL_MS = 300_000;

export function setCommandCodeHooksForTest(next?: CommandCodeHooks): void {
  hooks = next ?? {};
  catalogMemo = null;
  generateKeys.clear();
}

export function isCommandCodeProvider(id: string): boolean {
  return ALIASES.has(String(id || "").trim().toLowerCase());
}

export function apiForModelId(id: string): LlmApi {
  return String(id || "").startsWith("claude-") ? "anthropic-messages" : "openai-completions";
}

export function commandCodeJsonPath(dataDir: string): string {
  return join(dataDir, "commandcode.json");
}

function homeDir(): string {
  return hooks.homedir?.() ?? homedir();
}

export function officialCommandCodeAuthPath(): string {
  return join(homeDir(), ".commandcode", "auth.json");
}

export function sanitizeCommandCodeApiKey(input: string): string {
  const esc = String.fromCharCode(27);
  return Array.from(
    input
      .replaceAll(`${esc}[200~`, "")
      .replaceAll(`${esc}[201~`, "")
      .replaceAll("[200~", "")
      .replaceAll("[201~", ""),
  )
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function apiKeyFromCredentialRecord(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const type = stringValue(value.type);
  if (type === "api") return stringValue(value.key);
  if (type === "oauth") return stringValue(value.access);
  return stringValue(value.key) ?? stringValue(value.access);
}

export function parseCommandCodeAuthFile(parsed: unknown): string | undefined {
  if (!isRecord(parsed)) return undefined;
  const direct = stringValue(parsed.apiKey) ?? stringValue(parsed.commandcode);
  if (direct) return direct;
  return (
    apiKeyFromCredentialRecord(parsed.commandcode) ??
    apiKeyFromCredentialRecord(parsed["command-code"])
  );
}

function readAuthFileKey(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return parseCommandCodeAuthFile(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

export function readCommandCodeState(dataDir: string): CommandCodeState {
  const path = commandCodeJsonPath(dataDir);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(raw)) return {};
    const state: CommandCodeState = {};
    if (typeof raw.apiKey === "string") state.apiKey = raw.apiKey;
    if (typeof raw.connectedAt === "string") state.connectedAt = raw.connectedAt;
    if (typeof raw.userName === "string") state.userName = raw.userName;
    if (typeof raw.keyName === "string") state.keyName = raw.keyName;
    return state;
  } catch {
    return {};
  }
}

export function writeCommandCodeState(dataDir: string, patch: CommandCodeState): CommandCodeState {
  mkdirSync(dataDir, { recursive: true });
  const next = { ...readCommandCodeState(dataDir), ...patch };
  const path = commandCodeJsonPath(dataDir);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return next;
}

export function clearCommandCodeState(dataDir: string): void {
  const path = commandCodeJsonPath(dataDir);
  if (!existsSync(path)) return;
  writeFileSync(path, "{}\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function resolveCommandCodeAuth(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): CommandCodeAuth {
  const stored = sanitizeCommandCodeApiKey(readCommandCodeState(dataDir).apiKey ?? "");
  if (stored) return { token: stored, source: "guild" };
  const fromEnv = sanitizeCommandCodeApiKey(
    env.COMMAND_CODE_API_KEY ?? env.COMMANDCODE_API_KEY ?? "",
  );
  if (fromEnv) return { token: fromEnv, source: "env" };
  const fromCli = readAuthFileKey(officialCommandCodeAuthPath());
  if (fromCli) return { token: sanitizeCommandCodeApiKey(fromCli), source: "cli-auth" };
  return { source: null };
}

export const COMMANDCODE_FLOOR: CommandCodeModel[] = [
  {
    id: COMMANDCODE_DEFAULT_MODEL,
    name: "DeepSeek V4 Flash",
    api: "openai-completions",
    contextWindow: 128_000,
  },
  {
    id: "z-ai/glm-5.3-flash",
    name: "GLM 5.3 Flash",
    api: "openai-completions",
    contextWindow: 128_000,
  },
  {
    id: "meta/muse-spark-1.2-contributor",
    name: "Muse Spark 1.2 Contributor",
    api: "openai-completions",
    contextWindow: 128_000,
  },
];

export function parseCommandCodeCatalog(raw: unknown): CommandCodeModel[] {
  const rows = isRecord(raw) && Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const out: CommandCodeModel[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = stringValue(row.id);
    if (!id) continue;
    const name = stringValue(row.name) || id;
    const context =
      typeof row.context_length === "number" && row.context_length > 0
        ? row.context_length
        : typeof row.contextWindow === "number" && row.contextWindow > 0
          ? row.contextWindow
          : 128_000;
    out.push({ id, name, api: apiForModelId(id), contextWindow: context });
  }
  return out;
}

function catalogCachePath(dataDir: string): string {
  return join(dataDir, "commandcode-models.json");
}

export function loadCachedCommandCodeModels(dataDir: string): CommandCodeModel[] {
  const path = catalogCachePath(dataDir);
  if (!existsSync(path)) return [...COMMANDCODE_FLOOR];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const models = parseCommandCodeCatalog(
      isRecord(parsed) && Array.isArray(parsed.models) ? { data: parsed.models } : parsed,
    );
    return models.length ? models : [...COMMANDCODE_FLOOR];
  } catch {
    return [...COMMANDCODE_FLOOR];
  }
}

export function commandCodeCatalog(dataDir: string): ModelEntry[] {
  return loadCachedCommandCodeModels(dataDir).map((row) => ({ id: row.id, name: row.name }));
}

export function commandCodeModels(dataDir: string): ModelEntry[] {
  return commandCodeCatalog(dataDir);
}

export function markCommandCodeGenerate(apiKey: string): void {
  const key = sanitizeCommandCodeApiKey(apiKey);
  if (key) generateKeys.add(key);
}

export function commandCodeUsesGenerate(apiKey: string): boolean {
  return generateKeys.has(sanitizeCommandCodeApiKey(apiKey));
}

export async function refreshCommandCodeCatalog(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  force = false,
): Promise<CommandCodeModel[]> {
  const now = hooks.now?.() ?? Date.now();
  if (
    !force &&
    catalogMemo &&
    catalogMemo.dataDir === dataDir &&
    now - catalogMemo.at < CATALOG_TTL_MS
  ) {
    return catalogMemo.models;
  }
  const auth = resolveCommandCodeAuth(dataDir, env);
  const fetchImpl = hooks.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), COMMANDCODE_MODELS_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (auth.token) headers.authorization = `Bearer ${auth.token}`;
    const res = await fetchImpl(`${COMMANDCODE_PROVIDER_API_BASE}/models`, {
      headers,
      signal: ctrl.signal,
    });
    if (!res.ok) return loadCachedCommandCodeModels(dataDir);
    const models = parseCommandCodeCatalog(await res.json());
    if (!models.length) return loadCachedCommandCodeModels(dataDir);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      catalogCachePath(dataDir),
      `${JSON.stringify({ version: 1, models }, null, 2)}\n`,
      { mode: 0o600 },
    );
    catalogMemo = { at: now, dataDir, models };
    return models;
  } catch {
    return loadCachedCommandCodeModels(dataDir);
  } finally {
    clearTimeout(timer);
  }
}

export function projectSlugFromPath(pathName: string): string {
  const slug = pathName
    .toLowerCase()
    .replace(/^[a-z]:/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|(?<!-)-+$/g, "");
  return slug || "project";
}

export function buildCommandCodeAuthUrl(input: {
  studioBase?: string;
  callback: string;
  state: string;
}): string {
  const studio = (input.studioBase ?? COMMANDCODE_STUDIO_BASE).replace(/\/+$/, "");
  const params = new URLSearchParams({
    callback: input.callback,
    state: input.state,
  });
  return `${studio}/studio/auth/cli?${params.toString()}`;
}

export function isCommandCodeUpgradeRequired(input: {
  status: number;
  body: unknown;
}): boolean {
  if (input.status !== 403) return false;
  const body = input.body;
  const error = isRecord(body) ? (isRecord(body.error) ? body.error : body) : undefined;
  return stringValue(error?.code) === "upgrade_required";
}

export class CommandCodeUpgradeRequired extends Error {
  constructor() {
    super("commandcode_upgrade_required");
    this.name = "CommandCodeUpgradeRequired";
  }
}

export function parseCommandCodeStreamLine(line: string): unknown | undefined {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) return undefined;
  if (trimmed.startsWith("data:")) trimmed = trimmed.slice(5).trim();
  if (!trimmed || trimmed === "[DONE]") return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      /* fragment */
    }
  }
  return {};
}

export function readGenerateRound(events: unknown[]): GenerateRound {
  let text = "";
  let thinking = "";
  const calls: GenerateCall[] = [];
  const streaming = new Map<string, GenerateCall>();
  for (const event of events) {
    if (!isRecord(event)) continue;
    const type = stringValue(event.type);
    if (type === "text-delta") text += typeof event.text === "string" ? event.text : "";
    if (type === "reasoning-delta") thinking += typeof event.text === "string" ? event.text : "";
    if (type === "tool-input-start") {
      const id = stringValue(event.id);
      if (!id || streaming.has(id)) continue;
      streaming.set(id, { id, name: stringValue(event.toolName) ?? "", args: {} });
    }
    if (type === "tool-input-delta") {
      const id = stringValue(event.id);
      const active = id ? streaming.get(id) : undefined;
      const delta = stringValue(event.delta);
      if (!active || !delta) continue;
      active.args = recordOrEmpty(delta);
    }
    if (type === "tool-call") {
      const id = stringValue(event.toolCallId) ?? stringValue(event.id) ?? "";
      const name = stringValue(event.toolName) ?? streaming.get(id)?.name ?? "";
      const args = recordOrEmpty(event.input ?? event.args ?? event.arguments);
      streaming.delete(id);
      if (id) calls.push({ id, name, args });
    }
  }
  return { text, thinking, calls };
}

export function commandCodeRequestHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "x-command-code-version": COMMAND_CODE_CLI_VERSION,
    "x-cli-environment": "production",
    "user-agent": "cli",
    ...extra,
  };
}

export function commandCodeStatus(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  extra: Partial<CommandCodeStatus> = {},
): CommandCodeStatus {
  const auth = resolveCommandCodeAuth(dataDir, env);
  const state = readCommandCodeState(dataDir);
  const cli = existsSync(officialCommandCodeAuthPath());
  return {
    id: COMMANDCODE_PICKER_ID,
    pickerId: COMMANDCODE_PICKER_ID,
    name: "Command Code",
    hint: COMMANDCODE_HINT,
    loginHint: COMMANDCODE_LOGIN_HINT,
    kind: "commandcode",
    connected: Boolean(state.apiKey || state.connectedAt),
    pending: Boolean(extra.pending),
    ready: Boolean(auth.token),
    models: commandCodeModels(dataDir),
    catalog: commandCodeCatalog(dataDir),
    shownIds: null,
    importHint: cli ? "偵測到 ~/.commandcode/auth.json" : null,
    ...extra,
  };
}

export async function validateCommandCodeApiKey(
  apiKey: string,
  options: { fetchImpl?: typeof fetch; apiBase?: string } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? hooks.fetch ?? fetch;
  const base = (options.apiBase ?? COMMANDCODE_API_BASE).replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetchImpl(`${base}/alpha/whoami`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    throw new Error(
      `Could not validate the Command Code API key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (response.status === 401) throw new Error("Invalid Command Code API key");
  if (!response.ok) {
    throw new Error(`Could not validate the Command Code API key (${response.status})`);
  }
}

export async function saveCommandCodeApiKey(
  dataDir: string,
  apiKey: string,
  extra: { userName?: string; keyName?: string; fetchImpl?: typeof fetch } = {},
): Promise<CommandCodeStatus> {
  const cleaned = sanitizeCommandCodeApiKey(apiKey);
  if (!cleaned) throw new StoreError(400, "No Command Code API key provided");
  try {
    await validateCommandCodeApiKey(cleaned, { fetchImpl: extra.fetchImpl });
  } catch (error) {
    throw new StoreError(400, error instanceof Error ? error.message : String(error));
  }
  writeCommandCodeState(dataDir, {
    apiKey: cleaned,
    connectedAt: new Date(hooks.now?.() ?? Date.now()).toISOString(),
    userName: extra.userName,
    keyName: extra.keyName,
  });
  await refreshCommandCodeCatalog(dataDir, process.env, true).catch(() => {});
  return commandCodeStatus(dataDir);
}
