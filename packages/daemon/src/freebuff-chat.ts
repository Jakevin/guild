import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ModelEntry } from "@guild/protocol";
import { resolveFreebuffAuth } from "./freebuff-auth.ts";
import {
  guildTools,
  hostContext,
  TOOL_SYSTEM,
  type ToolContext,
  type ToolTrace,
} from "./tools.ts";

export const FREEBUFF_CHAT_PROVIDER_ID = "freebuff-chat";
export const FREEBUFF_CHAT_PICKER_ID = "freebuff-chat";
export const WEB_BRIDGE_PICKER_IDS = new Set([FREEBUFF_CHAT_PICKER_ID]);

export const FREEBUFF_CHAT_ORIGIN = "https://freebuff.com";
export const FREEBUFF_CHAT_URL = "https://freebuff.com/chat";
/** Conservative per-message limit from the official Codex Freebuff bridge. */
export const FREEBUFF_COMPOSER_CHAR_BUDGET = 32_000;
/** Kept for tests; generate no longer clips to this. */
export const FREEBUFF_PASTE_CHAR_BUDGET = 8_000;
/** packHistory window that fits the character cap (CHARS_PER_TOKEN = 4). */
export const FREEBUFF_COMPOSER_TOKEN_BUDGET = Math.floor(FREEBUFF_COMPOSER_CHAR_BUDGET / 4);

const MEMORY_HASH_CAP = 3_500;
const TOOL_RESULT_CAP = 16_000;
const FREEBUFF_TOOL_MARKER =
  "You ARE the model behind a Guild seat. Guild executes tools on the user's machine.";

const DEFAULT_FREEBUFF_TOOL_NAMES = [
  "run",
  "read",
  "write",
  "list",
  "skill",
  "spawn",
  "read_spawn",
  "browser",
  "cronjob",
  "image_gen",
] as const;

export type FreebuffToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type FreebuffToolParse =
  | { ok: true; calls: FreebuffToolCall[]; text: string }
  | { ok: false; code: "freebuff_tool_parse" };

export function allowedFreebuffToolNames(ctx: ToolContext = {}): string[] {
  const names = guildTools(ctx.skills ?? [], ctx).map((tool) => tool.name);
  return names.length ? names : [...DEFAULT_FREEBUFF_TOOL_NAMES];
}

/** Fence-only system prompt for Freebuff Chat. */
export function buildFreebuffToolSystem(
  names: readonly string[] = DEFAULT_FREEBUFF_TOOL_NAMES,
): string {
  const listed = (names.length ? names : DEFAULT_FREEBUFF_TOOL_NAMES).join(", ");
  return `${FREEBUFF_TOOL_MARKER}
Do not emit OpenAI tool_calls, Anthropic tool_use, XML <tool>, or prose like "I'll run …".
When you need a tool, output exactly one markdown fence and stop. No prose after the fence.
Allowed names: ${listed},
and any mcp__* advertised in <available_skills> / host context this turn.

\`\`\`guild_tools
[{"id":"c1","name":"run","args":{"command":"df -h"}}]
\`\`\``;
}

export const FREEBUFF_TOOL_SYSTEM = buildFreebuffToolSystem(
  allowedFreebuffToolNames(),
);

export type FreebuffLeaseParts = {
  roomId?: string;
  botId?: string;
  throughId?: string;
  soul?: string;
  agent?: string;
  position?: string;
  skillIds?: string[];
  channelMd?: string;
  botMemory?: string;
  channelMemory?: string;
  userMessage?: string;
  hallRules?: string;
};

export function withFreebuffToolSystem(
  system: string,
  ctx: ToolContext = {},
): string {
  const next = buildFreebuffToolSystem(allowedFreebuffToolNames(ctx));
  const src = String(system || "");
  if (src.includes(TOOL_SYSTEM)) return src.split(TOOL_SYSTEM).join(next);
  if (src.includes(FREEBUFF_TOOL_MARKER)) return src;
  return src.trim() ? `${next}\n\n${src}` : next;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Tool calls from assistant text, or `{ ok: false, code: "freebuff_tool_parse" }`. */
export function parseGuildToolsEnvelope(raw: string): FreebuffToolParse {
  const src = String(raw ?? "");
  let sawOpener = false;
  let winner: { start: number; value: unknown[] } | null = null;
  const re = /```guild_tools\b/g;
  for (const match of src.matchAll(re)) {
    sawOpener = true;
    const value = parseObjectArrayAfter(src, (match.index ?? 0) + match[0].length);
    if (value) winner = { start: match.index ?? 0, value };
  }
  if (!sawOpener) return { ok: true, calls: [], text: src };
  if (!winner) return { ok: false, code: "freebuff_tool_parse" };

  const calls: FreebuffToolCall[] = winner.value.map((item, index) => {
    const rec = item as { id?: unknown; name?: unknown; args?: unknown };
    const id =
      typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `c${index}`;
    const name = typeof rec.name === "string" ? rec.name : "";
    const args = isObjectRecord(rec.args) ? rec.args : {};
    return { id, name, args };
  });
  return { ok: true, calls, text: src.slice(0, winner.start).trim() };
}

function parseObjectArrayAfter(src: string, from: number): unknown[] | null {
  let i = from;
  while (i < src.length && (src[i] === " " || src[i] === "\t")) i++;
  if (src[i] !== "[") {
    while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++;
    while (i < src.length && /\s/.test(src[i]!)) i++;
  }
  if (src[i] !== "[") return null;
  const end = endOfJsonArray(src, i);
  if (end < 0) return null;
  try {
    const value = JSON.parse(src.slice(i, end)) as unknown;
    if (!Array.isArray(value) || !value.every(isObjectRecord)) return null;
    return value;
  } catch {
    return null;
  }
}

function endOfJsonArray(src: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

export function formatGuildToolResults(
  calls: { id: string; name: string }[],
  outcomes: { text?: string }[],
): string {
  return calls
    .map((call, index) => {
      let body = String(outcomes[index]?.text ?? "");
      if (body.length > TOOL_RESULT_CAP) {
        body = `${body.slice(0, TOOL_RESULT_CAP)}\n… truncated …`;
      }
      return `<guild_tool_result id="${call.id}" name="${call.name}">\n${body}\n</guild_tool_result>`;
    })
    .join("\n\n");
}

function sha32(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Tab lease fingerprint; MEMORY.md is not included. */
export function stableFingerprint(parts: {
  soul?: string;
  agent?: string;
  position?: string;
  skillIds?: string[];
  channelMd?: string;
  hallRules?: string;
}): string {
  return sha32(
    [
      FREEBUFF_TOOL_SYSTEM,
      parts.soul ?? "",
      parts.agent ?? "",
      parts.position ?? "",
      (parts.skillIds ?? []).join("\n"),
      parts.channelMd ?? "",
      parts.hallRules ?? "",
      hostContext(),
    ].join("\n\0"),
  );
}

export function freebuffLeaseKey(input: {
  roomId?: string;
  botId?: string;
  throughId?: string;
  model: string;
  fingerprint: string;
}): string {
  return [
    input.roomId || "none",
    input.botId || "none",
    input.throughId || "none",
    input.model,
    input.fingerprint,
  ].join(":");
}

export function freebuffMemoryHash(botMemory?: string, channelMemory?: string): string {
  return sha32(
    `${String(botMemory ?? "").slice(0, MEMORY_HASH_CAP)}\n\0${String(channelMemory ?? "").slice(0, MEMORY_HASH_CAP)}`,
  );
}

export function formatStandingNotes(botMemory?: string, channelMemory?: string): string | null {
  const bot = String(botMemory ?? "").trim().slice(0, MEMORY_HASH_CAP);
  const channel = String(channelMemory ?? "").trim().slice(0, MEMORY_HASH_CAP);
  if (!bot && !channel) return null;
  const lines = ["<guild_standing_notes>"];
  if (bot) lines.push("# MEMORY.md", bot);
  if (channel) lines.push("# Channel MEMORY.md", channel);
  lines.push("</guild_standing_notes>");
  return lines.join("\n");
}

/** Official free session routes. Other Chat floor ids fail closed. */
export const FREEBUFF_CHAT_FLOOR: { id: string; name: string }[] = [
  { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash 07/31" },
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
];

export const FREEBUFF_CHAT_DEFAULT_MODEL = FREEBUFF_CHAT_FLOOR[0]!.id;

export const FREEBUFF_CHAT_HINT =
  "用 Freebuff 官方免費 session 當模型（@codebuff/sdk，costMode=free）。Guild 大廳仍跑工具。連接會走官方裝置登入，憑證寫入 ~/.config/manicode/credentials.json（可與 Codex 共用）。摘要 / spawn / Studio 生成不會進這個分頁。";

export const FREEBUFF_CHAT_LOGIN_HINT =
  "廣告、地區 limited-mode、服務條款都由 Freebuff 決定。不要在不信任的機器登入。";

export type FreebuffErrorCode =
  | "freebuff_login_required"
  | "freebuff_no_browser"
  | "freebuff_ui_drift"
  | "freebuff_waiting_room"
  | "freebuff_ad_unresolved"
  | "freebuff_limited_mode"
  | "freebuff_session_cap"
  | "freebuff_composer_rejected"
  | "freebuff_context_too_large"
  | "freebuff_tool_parse"
  | "freebuff_remote_agent"
  | "freebuff_stream_idle"
  | "freebuff_busy"
  | "freebuff_disabled"
  | "freebuff_role_unsupported"
  | "freebuff_window_closed"
  | "freebuff_unreachable_dispatch";

export const FREEBUFF_ERROR_ZH: Record<FreebuffErrorCode, string> = {
  freebuff_login_required: "尚未登入官方 Freebuff session，或工作階段已過期。請到模型頁連接。",
  freebuff_no_browser: "無法開啟官方登入頁。請手動開啟回傳的網址。",
  freebuff_ui_drift: "網頁介面已變更，無法繼續。",
  freebuff_waiting_room: "排隊沒有進展。",
  freebuff_ad_unresolved: "廣告擋住輸入框。",
  freebuff_limited_mode: "目前地區沒有這個模型，或官方免費 session 不收這個模型。",
  freebuff_session_cap: "今日或本次工作階段額度用盡。",
  freebuff_composer_rejected: "無法送出這則提示。",
  freebuff_context_too_large: "內容超過 Freebuff 輸入上限。",
  freebuff_tool_parse: "工具呼叫格式無法解析。",
  freebuff_remote_agent: "網頁端代理關不掉。",
  freebuff_stream_idle: "太久沒有可見進度。",
  freebuff_busy: "另一個回合正在使用 Freebuff。",
  freebuff_disabled: "Freebuff 已停用。",
  freebuff_role_unsupported: "這個用途不能走 Freebuff，也沒有其他可用模型。",
  freebuff_window_closed: "瀏覽器視窗已關閉。",
  freebuff_unreachable_dispatch: "內部路徑錯誤，沒有對官方 session 送出請求。",
};

const ERROR_PREFIX = "模型請求失敗：Freebuff Chat:";
export const FREEBUFF_PROGRESS_WAIT = "Freebuff：等待官方 session…";
export const FREEBUFF_PROGRESS_QUEUE = "Freebuff：排隊中…";
export const FREEBUFF_PROGRESS_PASTE = "Freebuff：準備提示詞…";
export const FREEBUFF_PROGRESS_SEND = "Freebuff：呼叫 SDK…";
const CODE_RE = /^(freebuff_[a-z0-9_]+)\b/;

export function isWebBridgeTarget(target: {
  providerId: string;
  transport?: string;
}): boolean {
  return (
    target.transport === "web-bridge" ||
    WEB_BRIDGE_PICKER_IDS.has(target.providerId)
  );
}

export function freebuffJsonPath(dataDir: string): string {
  return join(dataDir, "freebuff.json");
}

export function freebuffProfileDir(dataDir: string): string {
  return join(dataDir, "freebuff-profile");
}

export type FreebuffAccessTier = "full" | "limited" | "unknown";

export type FreebuffState = {
  connectedAt?: string;
  lastProbeAt?: string;
  selectorPack?: number;
  accessTier?: FreebuffAccessTier;
  models?: string[];
  defaultModel?: string;
  pending?: boolean;
};

let pluginActive = true;

export function setFreebuffPluginActive(active: boolean): void {
  pluginActive = active;
}

export function isFreebuffChatEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (String(env.GUILD_FREEBUFF_CHAT ?? "").trim() === "0") return false;
  return pluginActive;
}

export function readFreebuffState(dataDir: string): FreebuffState {
  try {
    const raw = JSON.parse(readFileSync(freebuffJsonPath(dataDir), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw as FreebuffState;
  } catch {
    return {};
  }
}

export function writeFreebuffState(
  dataDir: string,
  patch: Partial<FreebuffState>,
): FreebuffState {
  mkdirSync(dataDir, { recursive: true });
  const next: FreebuffState = { ...readFreebuffState(dataDir), ...patch };
  const path = freebuffJsonPath(dataDir);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows */
  }
  return next;
}

export function ensureFreebuffProfile(dataDir: string): string {
  const dir = freebuffProfileDir(dataDir);
  mkdirSync(dir, { recursive: true });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* Windows */
  }
  return dir;
}

export function clearFreebuffJson(dataDir: string): void {
  rmSync(freebuffJsonPath(dataDir), { force: true });
}

export function sessionUsable(dataDir: string): boolean {
  const jsonPath = freebuffJsonPath(dataDir);
  if (!existsSync(jsonPath)) return false;
  try {
    const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      connectedAt?: unknown;
    };
    if (typeof raw.connectedAt !== "string" || !raw.connectedAt.trim()) return false;
  } catch {
    return false;
  }
  return Boolean(resolveFreebuffAuth().token);
}

export function stripWebBridgePicker<
  T extends { picker: { kind: string }[]; webBridges?: unknown },
>(body: T): T {
  return {
    ...body,
    webBridges: [],
    picker: body.picker.filter((row) => row.kind !== "web-bridge"),
  };
}

export function liveOrFloorModels(dataDir: string): ModelEntry[] {
  try {
    const raw = JSON.parse(readFileSync(freebuffJsonPath(dataDir), "utf8")) as {
      models?: unknown;
    };
    if (Array.isArray(raw.models)) {
      const models: ModelEntry[] = [];
      const seen = new Set<string>();
      for (const item of raw.models) {
        const parsed = parseFloorModel(item);
        if (!parsed || seen.has(parsed.id)) continue;
        seen.add(parsed.id);
        models.push(parsed);
      }
      if (models.length) return models;
    }
  } catch {
    /* floor */
  }
  return FREEBUFF_CHAT_FLOOR.map((row) => ({ id: row.id, name: row.name }));
}

function parseFloorModel(item: unknown): ModelEntry | null {
  if (typeof item === "string") {
    const id = item.trim();
    if (!id) return null;
    const floor = FREEBUFF_CHAT_FLOOR.find((row) => row.id === id);
    return { id, name: floor?.name ?? id };
  }
  if (!item || typeof item !== "object") return null;
  const rec = item as { id?: unknown; name?: unknown };
  if (typeof rec.id !== "string") return null;
  const id = rec.id.trim();
  if (!id) return null;
  const name =
    typeof rec.name === "string" && rec.name.trim()
      ? rec.name.trim()
      : (FREEBUFF_CHAT_FLOOR.find((row) => row.id === id)?.name ?? id);
  return { id, name };
}

export function formatFreebuffError(error: unknown): string {
  if (typeof error === "string" && error.startsWith(ERROR_PREFIX)) return error;
  const raw =
    typeof error === "string"
      ? error.trim()
      : error instanceof Error
        ? error.message.trim()
        : String(error ?? "").trim();
  if (raw.startsWith(ERROR_PREFIX)) return raw;
  const fromBody = raw.match(/Freebuff Chat:\s*(freebuff_[a-z0-9_]+)/);
  const codeMatch = raw.match(CODE_RE);
  const code = (fromBody?.[1] ?? codeMatch?.[1] ?? "") as FreebuffErrorCode | "";
  if (code && code in FREEBUFF_ERROR_ZH) {
    return `${ERROR_PREFIX} ${code} — ${FREEBUFF_ERROR_ZH[code]}`;
  }
  const fallback = raw || "發生錯誤";
  return `${ERROR_PREFIX} error — ${fallback}`;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const err = new Error("aborted");
  err.name = "AbortError";
  throw err;
}

export async function completeFreebuffChat(input: {
  dataDir: string;
  target: { providerId: string; model: string; transport?: string };
  system?: string;
  messages?: { role: "user" | "assistant"; content: string }[];
  toolCtx?: ToolContext;
  signal?: AbortSignal;
  lease?: FreebuffLeaseParts;
}): Promise<{
  text: string;
  provider: string;
  model: string;
  traces: ToolTrace[];
  thinking: string;
  usage: { provider: string; model: string };
}> {
  const { runFreebuffChatComplete } = await import("./freebuff-bridge.ts");
  return runFreebuffChatComplete(input);
}
