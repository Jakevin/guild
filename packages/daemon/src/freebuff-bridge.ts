import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CodebuffClientOptions } from "@codebuff/sdk";
import {
  STREAM_IDLE_TIMEOUT_MS,
  StreamIdleError,
  startStreamIdle,
} from "./oauth.ts";
import { packHistory, type HistoryItem } from "./compact.ts";
import { runAgentLoop } from "./harness.ts";
import {
  FREEBUFF_CHAT_HINT,
  FREEBUFF_CHAT_LOGIN_HINT,
  FREEBUFF_CHAT_PICKER_ID,
  FREEBUFF_COMPOSER_CHAR_BUDGET,
  FREEBUFF_COMPOSER_TOKEN_BUDGET,
  FREEBUFF_PROGRESS_QUEUE,
  FREEBUFF_PROGRESS_SEND,
  FREEBUFF_PROGRESS_WAIT,
  clearFreebuffJson,
  formatFreebuffError,
  formatStandingNotes,
  freebuffLeaseKey,
  freebuffMemoryHash,
  isFreebuffChatEnabled,
  liveOrFloorModels,
  readFreebuffState,
  sessionUsable,
  setFreebuffPluginActive,
  stableFingerprint,
  formatGuildToolResults,
  parseGuildToolsEnvelope,
  throwIfAborted,
  withFreebuffToolSystem,
  writeFreebuffState,
  type FreebuffAccessTier,
  type FreebuffLeaseParts,
} from "./freebuff-chat.ts";
import {
  resolveFreebuffAuth,
  resolveFreebuffCredentialsPath,
  setFreebuffCredentialsPathForTest,
} from "./freebuff-auth.ts";
import {
  parseFreebuffExpiryMs,
  pollFreebuffLoginCode,
  requestFreebuffLoginCode,
  saveFreebuffCredentials,
  type PendingFreebuffLogin,
} from "./freebuff-login.ts";
import {
  FreebuffSessionError,
  getFreebuffSessionManager,
  releaseFreebuffSessions,
  type ActiveFreebuffSession,
} from "./freebuff-session.ts";
import {
  denyFreebuffRemoteTools,
  freebuffRootAgentDefinitionFor,
  resolveFreebuffOfficialRoute,
} from "./freebuff-agent.ts";
import { withFreebuffRequestContext } from "./freebuff-request-context.ts";
import {
  builtinExecute,
  emitProgress,
  guildTools,
  roundSignal,
  TOOL_LOOP_WRAP,
  type ToolContext,
  type ToolOutcome,
  type ToolTrace,
} from "./tools.ts";
import { StoreError } from "./store.ts";

export type FreebuffWindowState = "open" | "closed" | "minimized";

export type FreebuffWebStatus = {
  id: typeof FREEBUFF_CHAT_PICKER_ID;
  pickerId: typeof FREEBUFF_CHAT_PICKER_ID;
  name: string;
  hint: string;
  loginHint?: string;
  kind: "web-bridge";
  connected: boolean;
  pending: boolean;
  ready: boolean;
  accessTier?: FreebuffAccessTier;
  models: { id: string; name: string }[];
  window?: FreebuffWindowState;
  loginUrl?: string;
  error?: string;
};

export type FreebuffDoctorReport = FreebuffWebStatus & {
  ok: boolean;
  chrome: "alive" | "missing" | "closed";
  sessionUsable: boolean;
  pack: number;
  phase: "login" | "sdk";
  probes: [];
  failed: string[];
  code?: string;
  detail?: string;
};

export type FreebuffLock = {
  release: () => void;
  signal: AbortSignal;
};

export type FreebuffSdkClient = {
  run: (options: {
    agent: string;
    prompt: string;
    signal?: AbortSignal;
    costMode: "free";
    handleStreamChunk?: (chunk: unknown) => void;
    handleEvent?: (event: unknown) => void;
  }) => Promise<{ output: unknown }>;
};

export type FreebuffSdkHooks = {
  fetch?: typeof fetch;
  createClient?: (options: CodebuffClientOptions) => FreebuffSdkClient;
  ensureSession?: (
    token: string,
    model: string,
    signal?: AbortSignal,
  ) => Promise<ActiveFreebuffSession>;
  credentialsPath?: string;
  cwd?: string;
  streamIdleMs?: number;
};

export type FreebuffPasteMode = "A" | "B" | "C";

export type FreebuffTurnTrace = {
  mode: FreebuffPasteMode;
  leaseKey: string;
  paste: string;
  memoryHash: string;
};

type Waiter = {
  resolve: (lock: FreebuffLock) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
  cancel: () => void;
};

let hooks: FreebuffSdkHooks | null = null;
let lastError: string | undefined;
let locked = false;
let draining = false;
let ownerAbort: AbortController | null = null;
let waiters: Waiter[] = [];
let drainWaiters: Array<() => void> = [];
let tabLease: { key: string; lastMemoryHash: string } | null = null;
let lastTurnTrace: FreebuffTurnTrace | null = null;
let pendingLogin: PendingFreebuffLogin | null = null;

export function lastFreebuffTurnForTest(): FreebuffTurnTrace | null {
  return lastTurnTrace;
}

export function setFreebuffSdkHooks(next: FreebuffSdkHooks | null): void {
  hooks = next;
  if (next?.credentialsPath) setFreebuffCredentialsPathForTest(next.credentialsPath);
}

/** @deprecated CDP launch hooks are gone; this only forwards credentialsPath. */
export function setFreebuffLaunchHooks(next: FreebuffSdkHooks | null): void {
  setFreebuffSdkHooks(next);
}

export function freebuffMutexHeld(): boolean {
  return locked;
}

function abortErr(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

function busyErr(): Error {
  return new Error("freebuff_busy");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isBusyError(error: unknown): boolean {
  return error instanceof Error && error.message === "freebuff_busy";
}

function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal {
  const parts = [a, b].filter((s): s is AbortSignal => Boolean(s));
  if (parts.length === 0) return new AbortController().signal;
  if (parts.length === 1) return parts[0]!;
  return AbortSignal.any(parts);
}

function takeLock(signal?: AbortSignal): FreebuffLock {
  locked = true;
  const owner = new AbortController();
  ownerAbort = owner;
  const combined = combineSignals(signal, owner.signal);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (ownerAbort === owner) ownerAbort = null;
    locked = false;
    const waiting = drainWaiters.splice(0);
    for (const done of waiting) done();
    const next = waiters.shift();
    if (next) {
      next.cancel();
      try {
        next.resolve(takeLock(next.signal));
      } catch (error) {
        next.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
  return { release, signal: combined };
}

export async function acquireFreebuffMutex(opts: {
  queue: boolean;
  signal?: AbortSignal;
}): Promise<FreebuffLock> {
  throwIfAborted(opts.signal);
  if (draining) throw busyErr();
  if (!locked) return takeLock(opts.signal);
  if (!opts.queue) throw busyErr();
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      reject,
      signal: opts.signal,
      cancel: () => undefined,
    };
    const onAbort = () => {
      waiters = waiters.filter((row) => row !== waiter);
      reject(abortErr());
    };
    if (opts.signal) {
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    waiter.cancel = () => {
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    };
    waiters.push(waiter);
  });
}

async function drainMutex(): Promise<void> {
  draining = true;
  for (const waiter of waiters.splice(0)) {
    waiter.cancel();
    waiter.reject(abortErr());
  }
  try {
    ownerAbort?.abort();
  } catch {
    /* ignore */
  }
  if (!locked) return;
  await new Promise<void>((resolve) => {
    drainWaiters.push(resolve);
  });
}

function endDrain(): void {
  draining = false;
}

function credentialsPath(): string {
  return resolveFreebuffCredentialsPath(hooks?.credentialsPath);
}

function authFor(): ReturnType<typeof resolveFreebuffAuth> {
  return resolveFreebuffAuth({ credentialsPath: credentialsPath() });
}

export function freebuffWebStatus(dataDir: string): FreebuffWebStatus {
  const ready = sessionUsable(dataDir);
  const state = readFreebuffState(dataDir);
  const pending = Boolean(pendingLogin) && !ready;
  return {
    id: FREEBUFF_CHAT_PICKER_ID,
    pickerId: FREEBUFF_CHAT_PICKER_ID,
    name: "Freebuff Chat",
    hint: FREEBUFF_CHAT_HINT,
    loginHint: FREEBUFF_CHAT_LOGIN_HINT,
    kind: "web-bridge",
    connected: ready,
    pending,
    ready,
    accessTier: state.accessTier,
    models: liveOrFloorModels(dataDir),
    window: "closed",
    ...(pendingLogin && !ready ? { loginUrl: pendingLogin.loginUrl } : {}),
    error: lastError,
  };
}

function connectFromToken(dataDir: string): FreebuffWebStatus {
  lastError = undefined;
  pendingLogin = null;
  writeFreebuffState(dataDir, {
    connectedAt: new Date().toISOString(),
    lastProbeAt: new Date().toISOString(),
    pending: false,
    models: liveOrFloorModels(dataDir).map((row) => row.id),
    defaultModel: liveOrFloorModels(dataDir)[0]?.id,
  });
  return freebuffWebStatus(dataDir);
}

export async function startFreebuffLogin(dataDir: string): Promise<FreebuffWebStatus> {
  lastError = undefined;
  let lock: FreebuffLock | undefined;
  try {
    lock = await acquireFreebuffMutex({ queue: false });
    if (authFor().token) return connectFromToken(dataDir);
    const pending = await requestFreebuffLoginCode({
      fetch: hooks?.fetch,
      credentialsPath: credentialsPath(),
    });
    pendingLogin = pending;
    writeFreebuffState(dataDir, { connectedAt: "", pending: true });
    return freebuffWebStatus(dataDir);
  } catch (error) {
    if (isBusyError(error)) throw new StoreError(409, "freebuff_busy");
    lastError = "freebuff_login_required";
    writeFreebuffState(dataDir, { connectedAt: "", pending: false });
    const status = freebuffWebStatus(dataDir);
    status.error = error instanceof Error ? error.message : String(error);
    return status;
  } finally {
    lock?.release();
  }
}

export async function pollFreebuffLogin(dataDir: string): Promise<FreebuffWebStatus> {
  if (locked) return freebuffWebStatus(dataDir);
  let lock: FreebuffLock | undefined;
  try {
    lock = await acquireFreebuffMutex({ queue: false });
  } catch (error) {
    if (isBusyError(error)) return freebuffWebStatus(dataDir);
    throw error;
  }
  try {
    if (authFor().token) {
      if (!sessionUsable(dataDir) || pendingLogin) return connectFromToken(dataDir);
      return freebuffWebStatus(dataDir);
    }
    if (!pendingLogin) {
      writeFreebuffState(dataDir, { lastProbeAt: new Date().toISOString() });
      return freebuffWebStatus(dataDir);
    }
    const expiresAtMs = parseFreebuffExpiryMs(pendingLogin.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      pendingLogin = null;
      lastError = "freebuff_login_required";
      writeFreebuffState(dataDir, { connectedAt: "", pending: false, lastProbeAt: new Date().toISOString() });
      return freebuffWebStatus(dataDir);
    }
    try {
      const user = await pollFreebuffLoginCode(pendingLogin, {
        fetch: hooks?.fetch,
        credentialsPath: pendingLogin.credentialsPath,
      });
      if (user) {
        saveFreebuffCredentials(pendingLogin.credentialsPath, user);
        return connectFromToken(dataDir);
      }
    } catch {
      /* keep polling through transient status failures */
    }
    writeFreebuffState(dataDir, { lastProbeAt: new Date().toISOString(), pending: true });
    return freebuffWebStatus(dataDir);
  } finally {
    lock.release();
  }
}

export async function logoutFreebuff(dataDir: string): Promise<FreebuffWebStatus> {
  await drainMutex();
  try {
    tabLease = null;
    pendingLogin = null;
    lastError = undefined;
    clearFreebuffJson(dataDir);
    await releaseFreebuffSessions();
    return freebuffWebStatus(dataDir);
  } finally {
    endDrain();
  }
}

export async function doctorFreebuff(dataDir: string): Promise<FreebuffDoctorReport> {
  let lock: FreebuffLock | undefined;
  try {
    lock = await acquireFreebuffMutex({ queue: false });
  } catch (error) {
    if (isBusyError(error)) throw new StoreError(409, "freebuff_busy");
    throw error;
  }
  try {
    const token = Boolean(authFor().token);
    if (!token && readFreebuffState(dataDir).connectedAt) {
      writeFreebuffState(dataDir, { connectedAt: "", pending: Boolean(pendingLogin) });
    }
    const usable = sessionUsable(dataDir);
    const code = usable ? undefined : "freebuff_login_required";
    if (code) lastError = undefined;
    return {
      ...freebuffWebStatus(dataDir),
      ok: usable,
      chrome: "missing",
      sessionUsable: usable,
      pack: 0,
      phase: "sdk",
      probes: [],
      failed: [],
      code,
    };
  } finally {
    lock.release();
  }
}

export async function closeFreebuffBrowser(): Promise<void> {
  pendingLogin = null;
  await releaseFreebuffSessions();
}

function codeErr(code: string): Error {
  return new Error(code);
}

function idleMs(): number {
  return hooks?.streamIdleMs ?? STREAM_IDLE_TIMEOUT_MS;
}

function lastUserText(
  messages: { role: string; content: string }[],
  lease?: FreebuffLeaseParts,
): string {
  if (lease?.userMessage) return lease.userMessage;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return messages[i]!.content;
  }
  return "";
}

function compileFull(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  steer: string | null,
): string {
  const blocks = [system.trim()];
  for (const item of messages) {
    blocks.push(`${item.role === "user" ? "User" : "Assistant"}:\n${item.content}`);
  }
  if (steer) blocks.push(steer);
  return blocks.filter(Boolean).join("\n\n");
}

function compileModeB(user: string, notes: string | null, steer: string | null): string {
  return [notes, user, steer].filter(Boolean).join("\n\n");
}

function compileSuffix(results: string, wrap: boolean, steer: string | null): string {
  return [results, wrap ? TOOL_LOOP_WRAP : "", steer ?? ""].filter(Boolean).join("\n\n");
}

function withAdvertisedTools(ctx: ToolContext): ToolContext {
  const allowed = new Set(guildTools(ctx.skills ?? [], ctx).map((tool) => tool.name));
  const orig = ctx.dispatch;
  return {
    ...ctx,
    dispatch: async (name, args, rest) => {
      if (!allowed.has(name)) {
        return { text: `unknown tool: ${name}`, isError: true };
      }
      if (orig) return orig(name, args, rest);
      return builtinExecute(name, args, rest);
    },
  };
}

function overComposerBudget(text: string): boolean {
  return String(text || "").length > FREEBUFF_COMPOSER_CHAR_BUDGET;
}

function splitPacked(messages: { role: "user" | "assistant"; content: string }[]): {
  history: HistoryItem[];
  userMessage: string;
} {
  const copy = messages.slice();
  let userMessage = "";
  if (copy.length && copy[copy.length - 1]!.role === "user") {
    userMessage = copy.pop()!.content;
  }
  return {
    history: copy.map((item, i) => ({
      id: `p${i}`,
      author: item.role === "user" ? "you" : "assistant",
      body: item.content,
    })),
    userMessage,
  };
}

async function trimToComposer(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  input: {
    dataDir: string;
    target: { providerId: string; model: string };
    toolCtx?: ToolContext;
    signal?: AbortSignal;
  },
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  if (overComposerBudget(system)) throw codeErr("freebuff_context_too_large");
  if (!overComposerBudget(compileFull(system, messages, null))) return messages;
  const split = splitPacked(messages);
  const packed = await packHistory({
    system,
    history: split.history,
    userMessage: split.userMessage,
    dataDir: input.dataDir,
    env: input.toolCtx?.env,
    prefer: { provider: input.target.providerId, model: input.target.model },
    tokenLimit: FREEBUFF_COMPOSER_TOKEN_BUDGET,
    summarize: "local",
    signal: input.signal ?? input.toolCtx?.signal,
  });
  if (
    overComposerBudget(system) ||
    overComposerBudget(compileFull(system, packed.messages, null))
  ) {
    throw codeErr("freebuff_context_too_large");
  }
  return packed.messages;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join("\n");
  const object = record(value);
  if (!object) return "";
  if (typeof object.text === "string") return object.text;
  if (typeof object.thinking === "string") return object.thinking;
  if (typeof object.message === "string") return object.message;
  if (object.type === "error" && typeof object.message === "string") return object.message;
  if (object.type === "structuredOutput") {
    return object.value === null ? "null" : JSON.stringify(object.value);
  }
  if (object.type === "lastMessage" || object.type === "allMessages") {
    return textFromValue(object.value);
  }
  if (object.role === "assistant") return textFromValue(object.content);
  return "";
}

function chunkText(chunk: unknown): { text?: string; thinking?: string } {
  if (typeof chunk === "string") return chunk ? { text: chunk } : {};
  const object = record(chunk);
  if (!object) return {};
  const piece = typeof object.chunk === "string" ? object.chunk : "";
  if (object.type === "reasoning_chunk") return piece ? { thinking: piece } : {};
  return piece ? { text: piece } : {};
}

function ensureScratch(dataDir: string): string {
  const dir = hooks?.cwd?.trim() || join(dataDir, "freebuff-scratch");
  mkdirSync(dir, { recursive: true });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* Windows */
  }
  return dir;
}

async function defaultCreateClient(options: CodebuffClientOptions): Promise<FreebuffSdkClient> {
  const { CodebuffClient } = await import("@codebuff/sdk");
  return new CodebuffClient(options);
}

function failResult(
  target: { providerId: string; model: string },
  code: string,
): {
  text: string;
  provider: string;
  model: string;
  traces: ToolTrace[];
  thinking: string;
  usage: { provider: string; model: string };
} {
  lastError = code.startsWith("freebuff_") ? code.split(/\s/)[0] : lastError;
  return {
    text: formatFreebuffError(code),
    provider: target.providerId,
    model: target.model,
    traces: [],
    thinking: "",
    usage: { provider: target.providerId, model: target.model },
  };
}

function mapRunError(error: unknown): string {
  if (error instanceof FreebuffSessionError) return error.message;
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.startsWith("freebuff_")) return raw.split(/\s/)[0]!;
  if (/login was rejected|no freebuff login|finish the browser login/i.test(raw)) {
    return "freebuff_login_required";
  }
  if (/free_mode_invalid_agent_model|not available for specific agent/i.test(raw)) {
    return "freebuff_limited_mode";
  }
  return raw;
}

async function runSdkPrompt(input: {
  dataDir: string;
  prompt: string;
  route: { agent: string; providerModel: string };
  token: string;
  toolCtx: ToolContext;
  traces: ToolTrace[];
  parent: AbortSignal;
  idle: ReturnType<typeof startStreamIdle>;
}): Promise<{ text: string; thinking: string }> {
  emitProgress(input.toolCtx, input.traces, FREEBUFF_PROGRESS_WAIT);
  const session = await (hooks?.ensureSession
    ? hooks.ensureSession(input.token, input.route.providerModel, input.parent)
    : getFreebuffSessionManager().ensure(input.token, input.route.providerModel, input.parent));
  throwIfAborted(input.parent);
  if (input.idle.timedOut()) throw new StreamIdleError(idleMs());

  const rootAgentDefinition = freebuffRootAgentDefinitionFor(input.route.agent);
  const clientOptions: CodebuffClientOptions = {
    apiKey: input.token,
    cwd: ensureScratch(input.dataDir),
    maxAgentSteps: 20,
    ...(rootAgentDefinition ? { agentDefinitions: [rootAgentDefinition] } : {}),
    overrideTools: denyFreebuffRemoteTools(),
  };
  const client = hooks?.createClient
    ? hooks.createClient(clientOptions)
    : await defaultCreateClient(clientOptions);

  emitProgress(input.toolCtx, input.traces, FREEBUFF_PROGRESS_SEND);
  let text = "";
  let thinking = "";
  const handleStreamChunk = (chunk: unknown) => {
    input.idle.bump();
    const next = chunkText(chunk);
    if (next.thinking) {
      thinking = thinking ? `${thinking}${next.thinking}` : next.thinking;
      emitProgress(input.toolCtx, input.traces, thinking);
    }
    if (next.text) {
      text += next.text;
      emitProgress(input.toolCtx, input.traces, text);
    }
  };
  let result: { output: unknown };
  try {
    result = await withFreebuffRequestContext(
      { instanceId: session.instanceId, traceSessionId: randomUUID() },
      () =>
        client.run({
          agent: input.route.agent,
          prompt: input.prompt,
          signal: combineSignals(input.parent, input.idle.signal),
          costMode: "free",
          handleStreamChunk,
        }),
    );
  } catch (error) {
    if (input.idle.timedOut()) throw new StreamIdleError(idleMs());
    throw error;
  }
  throwIfAborted(input.parent);
  if (input.idle.timedOut()) throw new StreamIdleError(idleMs());
  const output = record(result.output);
  if (output?.type === "error") {
    throw new Error(typeof output.message === "string" ? output.message : "freebuff_limited_mode");
  }
  if (!text) text = textFromValue(result.output);
  return { text, thinking };
}

async function runLockedTurn(input: {
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
  const route = resolveFreebuffOfficialRoute(input.target.model);
  if (!route) throw codeErr("freebuff_limited_mode");
  const token = authFor().token;
  if (!token) throw codeErr("freebuff_login_required");

  const toolCtx = withAdvertisedTools({
    dataDir: input.dataDir,
    allowWrite: true,
    ...input.toolCtx,
    spawnDepth: 0,
    signal: input.signal ?? input.toolCtx?.signal,
  });
  const system = withFreebuffToolSystem(input.system ?? "", toolCtx);
  let messages = input.messages ?? [];
  const model = input.target.model;
  const fp = stableFingerprint({
    soul: input.lease?.soul,
    agent: input.lease?.agent,
    position: input.lease?.position,
    skillIds: input.lease?.skillIds,
    channelMd: input.lease?.channelMd,
    hallRules: input.lease?.hallRules,
  });
  const key = freebuffLeaseKey({
    roomId: input.lease?.roomId ?? toolCtx.roomId,
    botId: input.lease?.botId ?? toolCtx.botId,
    throughId: input.lease?.throughId,
    model,
    fingerprint: fp,
  });
  const memHash = freebuffMemoryHash(input.lease?.botMemory, input.lease?.channelMemory);
  const match = tabLease?.key === key;
  if (!match) {
    messages = await trimToComposer(system, messages, input);
    if (overComposerBudget(system) || overComposerBudget(compileFull(system, messages, null))) {
      throw codeErr("freebuff_context_too_large");
    }
  }

  const traces: ToolTrace[] = [];
  const thinkingChunks: string[] = [];
  let lastAskText = "";
  let pendingSteer: string | null = null;
  let pendingResults = "";
  const looped = await runAgentLoop({
    toolCtx,
    traces,
    thinkingChunks,
    emptyAfterTools: "",
    onRetry: (late) => {
      pendingSteer = late;
    },
    onTools: (calls, outcomes: ToolOutcome[]) => {
      pendingResults = formatGuildToolResults(calls, outcomes);
    },
    ask: async ({ round, wrap, steer }) => {
      const extra = steer || pendingSteer;
      pendingSteer = null;
      const mode: FreebuffPasteMode = round >= 1 ? "C" : match ? "B" : "A";
      let paste = "";
      if (mode === "C") {
        paste = compileSuffix(pendingResults, wrap, extra);
        pendingResults = "";
        if (!paste.trim()) return { calls: [], text: lastAskText, thinking: "" };
      } else if (mode === "A") {
        paste = compileFull(system, messages, extra);
        if (wrap) paste = [paste, TOOL_LOOP_WRAP].filter(Boolean).join("\n\n");
      } else {
        const notes =
          tabLease && tabLease.lastMemoryHash !== memHash
            ? formatStandingNotes(input.lease?.botMemory, input.lease?.channelMemory)
            : null;
        paste = compileModeB(lastUserText(messages, input.lease), notes, extra);
        if (wrap) paste = [paste, TOOL_LOOP_WRAP].filter(Boolean).join("\n\n");
      }
      if (!paste.trim()) throw codeErr("freebuff_composer_rejected");
      if (overComposerBudget(paste)) throw codeErr("freebuff_context_too_large");
      lastTurnTrace = { mode, leaseKey: key, paste, memoryHash: memHash };

      const parent = roundSignal(toolCtx);
      const idle = startStreamIdle(idleMs(), parent);
      try {
        const done = await runSdkPrompt({
          dataDir: input.dataDir,
          prompt: paste,
          route,
          token,
          toolCtx,
          traces,
          parent,
          idle,
        });
        tabLease = { key, lastMemoryHash: memHash };
        const parsed = parseGuildToolsEnvelope(done.text);
        if (!parsed.ok) throw codeErr("freebuff_tool_parse");
        lastAskText = parsed.text;
        if (done.thinking) thinkingChunks.push(done.thinking);
        return {
          calls: parsed.calls,
          text: parsed.text,
          thinking: done.thinking,
        };
      } finally {
        idle.dispose();
      }
    },
  });
  return {
    text: looped?.text ?? "",
    provider: input.target.providerId,
    model,
    traces: looped?.traces ?? traces,
    thinking: looped?.thinking ?? "",
    usage: { provider: input.target.providerId, model },
  };
}

export async function runFreebuffChatComplete(input: {
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
  const signal = input.signal ?? input.toolCtx?.signal;
  throwIfAborted(signal);
  const depth = input.toolCtx?.spawnDepth ?? 0;
  const env = input.toolCtx?.env ?? process.env;
  if (!isFreebuffChatEnabled(env)) {
    return failResult(input.target, "freebuff_disabled");
  }
  if (depth >= 1) return failResult(input.target, "freebuff_busy");
  let lock: FreebuffLock | undefined;
  try {
    if (freebuffMutexHeld() && input.toolCtx) {
      emitProgress(input.toolCtx, [], FREEBUFF_PROGRESS_QUEUE);
    }
    lock = await acquireFreebuffMutex({ queue: true, signal });
    throwIfAborted(lock.signal);
    if (!sessionUsable(input.dataDir)) {
      return failResult(input.target, "freebuff_login_required");
    }
    return await runLockedTurn(input);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof StreamIdleError) return failResult(input.target, "freebuff_stream_idle");
    if (isBusyError(error)) return failResult(input.target, "freebuff_busy");
    return failResult(input.target, mapRunError(error));
  } finally {
    lock?.release();
  }
}

export async function resetFreebuffBridgeForTest(): Promise<void> {
  hooks = null;
  draining = false;
  for (const waiter of waiters.splice(0)) {
    waiter.cancel();
    waiter.reject(abortErr());
  }
  drainWaiters.splice(0);
  try {
    ownerAbort?.abort();
  } catch {
    /* ignore */
  }
  ownerAbort = null;
  locked = false;
  lastError = undefined;
  tabLease = null;
  lastTurnTrace = null;
  pendingLogin = null;
  setFreebuffPluginActive(true);
  setFreebuffCredentialsPathForTest(undefined);
  await releaseFreebuffSessions();
}
