/**
 * Hermes-shaped usage accounting (agent/usage_anchor.py + turn_preflight).
 * Provider `usage.prompt_tokens` is the context size. Local char estimates
 * cover only messages appended since that reading, or decide whether to wait
 * one request when no real count exists. Not a wall-clock fuse.
 */

export const COMPACT_THRESHOLD_TOKENS = 88_000;

export type UsageAnchor = {
  promptTokens: number;
  completionTokens: number;
  baseCount: number;
  baseLastRole: string | null;
  baseLastFp: string;
};

export type PressureSource = "anchor" | "real" | "rough";

export type ContextPressure = {
  tokens: number;
  source: PressureSource;
};

export type RoomUsageState = {
  lastPromptTokens: number;
  lastCompletionTokens: number;
  waitedOnce: boolean;
  awaitingAfterCompact: boolean;
  anchor: UsageAnchor | null;
};

const rooms = new Map<string, RoomUsageState>();

function emptyState(): RoomUsageState {
  return {
    lastPromptTokens: 0,
    lastCompletionTokens: 0,
    waitedOnce: false,
    awaitingAfterCompact: false,
    anchor: null,
  };
}

export function peekRoomUsage(roomId: string): RoomUsageState | undefined {
  return rooms.get(roomId);
}

export function resetRoomUsageForTests(): void {
  rooms.clear();
}

function stateOf(roomId: string): RoomUsageState {
  const current = rooms.get(roomId);
  if (current) return current;
  const next = emptyState();
  rooms.set(roomId, next);
  return next;
}

export function messageFingerprint(msg: unknown): string | null {
  if (!msg || typeof msg !== "object") return null;
  const row = msg as Record<string, unknown>;
  const payload = {
    role: row.role ?? null,
    content: row.content ?? null,
    tool_call_id: row.tool_call_id ?? null,
    tool_calls: row.tool_calls ?? null,
  };
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

export function captureUsageAnchor(
  promptTokens: number,
  completionTokens: number,
  messages: unknown[],
): UsageAnchor | null {
  const pt = Math.floor(Number(promptTokens) || 0);
  const ct = Math.max(0, Math.floor(Number(completionTokens) || 0));
  if (pt <= 0 || !Array.isArray(messages) || !messages.length) return null;
  const last = messages[messages.length - 1];
  const fp = messageFingerprint(last);
  if (!fp) return null;
  const role =
    last && typeof last === "object"
      ? String((last as { role?: unknown }).role || "") || null
      : null;
  return {
    promptTokens: pt,
    completionTokens: ct,
    baseCount: messages.length,
    baseLastRole: role,
    baseLastFp: fp,
  };
}

function anchorMatches(messages: unknown[], anchor: UsageAnchor): boolean {
  if (!Array.isArray(messages) || messages.length < anchor.baseCount) return false;
  const base = messages[anchor.baseCount - 1];
  if (!base || typeof base !== "object") return false;
  const role = String((base as { role?: unknown }).role || "") || null;
  if (role !== anchor.baseLastRole) return false;
  return messageFingerprint(base) === anchor.baseLastFp;
}

export function anchoredContextTokens(
  messages: unknown[],
  anchor: UsageAnchor | null | undefined,
  estimateDelta: (delta: unknown[]) => number,
): number | null {
  if (!anchor || !Array.isArray(messages) || !anchorMatches(messages, anchor)) {
    return null;
  }
  let total = anchor.promptTokens + anchor.completionTokens;
  let delta = messages.slice(anchor.baseCount);
  if (delta.length && roleOf(delta[0]) === "assistant") delta = delta.slice(1);
  if (delta.length) total += estimateDelta(delta);
  return total;
}

function roleOf(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  return String((msg as { role?: unknown }).role || "");
}

export function resolvePressure(input: {
  rough: number;
  lastPromptTokens?: number;
  lastCompletionTokens?: number;
  extraSince?: number;
  awaitingAfterCompact?: boolean;
  anchored?: number | null;
}): ContextPressure {
  if (input.awaitingAfterCompact && (input.lastPromptTokens ?? 0) < 0) {
    return { tokens: 0, source: "real" };
  }
  if (input.anchored != null && input.anchored >= 0) {
    return { tokens: input.anchored, source: "anchor" };
  }
  const last = input.lastPromptTokens ?? 0;
  if (last > 0) {
    return {
      tokens: last + (input.lastCompletionTokens ?? 0) + (input.extraSince ?? 0),
      source: "real",
    };
  }
  return { tokens: Math.max(0, input.rough), source: "rough" };
}

/**
 * Hermes preflight: an anchored/real figure is never deferred. A whole-context
 * rough estimate over threshold waits ONE request. Provider-omitted usage,
 * real-over-threshold, and rough past the whole window compress immediately.
 */
export function shouldDeferToRealUsage(input: {
  source: PressureSource;
  tokens: number;
  threshold: number;
  window: number;
  alreadyWaited: boolean;
}): boolean {
  if (input.source === "anchor" || input.source === "real") return false;
  if (input.tokens <= input.threshold) return false;
  if (input.alreadyWaited) return false;
  if (input.tokens >= input.window) return false;
  return true;
}

export function shouldCompress(tokens: number, threshold: number): boolean {
  return tokens > threshold;
}

export function noteProviderUsage(
  roomId: string | undefined,
  messages: unknown[],
  usage: { input?: number; output?: number },
): void {
  if (!roomId) return;
  const pt = Math.floor(Number(usage.input) || 0);
  const state = stateOf(roomId);
  if (pt <= 0) return;
  state.lastPromptTokens = pt;
  state.lastCompletionTokens = Math.max(0, Math.floor(Number(usage.output) || 0));
  state.awaitingAfterCompact = false;
  state.waitedOnce = false;
  state.anchor = captureUsageAnchor(pt, state.lastCompletionTokens, messages);
}

export function markCompactDeferred(roomId: string | undefined): void {
  if (!roomId) return;
  stateOf(roomId).waitedOnce = true;
}

export function markCompacted(roomId: string | undefined): void {
  if (!roomId) return;
  const state = stateOf(roomId);
  state.lastPromptTokens = -1;
  state.awaitingAfterCompact = true;
  state.waitedOnce = false;
  state.anchor = null;
}

export function restoreUsageAnchor(
  roomId: string | undefined,
  anchor: UsageAnchor | null | undefined,
): void {
  if (!roomId || !anchor || peekRoomUsage(roomId)?.anchor) return;
  const state = stateOf(roomId);
  state.anchor = anchor;
  if (anchor.promptTokens > 0 && state.lastPromptTokens <= 0) {
    state.lastPromptTokens = anchor.promptTokens;
    state.lastCompletionTokens = anchor.completionTokens;
  }
}

export function parseUsageAnchor(raw: unknown): UsageAnchor | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const promptTokens = Math.floor(Number(rec.promptTokens) || 0);
  const baseCount = Math.floor(Number(rec.baseCount) || 0);
  const fp = typeof rec.baseLastFp === "string" ? rec.baseLastFp : "";
  if (promptTokens <= 0 || baseCount <= 0 || !fp) return null;
  return {
    promptTokens,
    completionTokens: Math.max(0, Math.floor(Number(rec.completionTokens) || 0)),
    baseCount,
    baseLastRole: typeof rec.baseLastRole === "string" ? rec.baseLastRole : null,
    baseLastFp: fp,
  };
}
