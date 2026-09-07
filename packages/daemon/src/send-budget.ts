import {
  COMPACT_THRESHOLD_TOKENS,
  anchoredContextTokens,
  markCompactDeferred,
  markCompacted,
  peekRoomUsage,
  resolvePressure,
  shouldCompress,
  shouldDeferToRealUsage,
} from "./usage-anchor.ts";

/** Grok 4.6 is 500k. Stay under, and count CJK/code denser than char/4. */
export const SEND_TOKEN_BUDGET = 400_000;
const SEND_CHARS_PER_TOKEN = 1.5;
const KEEP_FLOOR = 2;
const SEND_SUMMARY_CAP = 4_000;

export function estimateSendTokens(text: string): number {
  return Math.ceil(String(text || "").length / SEND_CHARS_PER_TOKEN);
}

function payloadChars(message: unknown): number {
  if (message == null) return 0;
  if (typeof message === "string") return message.length;
  if (typeof message === "object" && message && "content" in message) {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content.length;
    try {
      return JSON.stringify(content ?? "").length;
    } catch {
      return 0;
    }
  }
  try {
    const copy = { ...(message as Record<string, unknown>) };
    delete copy.reasoning;
    delete copy.reasoning_content;
    delete copy.codex_reasoning_items;
    return JSON.stringify(copy).length;
  } catch {
    return 0;
  }
}

type WireMsg = {
  role?: string;
  content?: unknown;
  type?: string;
  tool_calls?: unknown;
};

function asWire(message: unknown): WireMsg | null {
  if (!message || typeof message !== "object") return null;
  return message as WireMsg;
}

function partsHaveType(content: unknown, types: string | string[]): boolean {
  if (!Array.isArray(content)) return false;
  const want = typeof types === "string" ? [types] : types;
  return content.some((part) => {
    const type = part && typeof part === "object" ? (part as { type?: string }).type : "";
    return Boolean(type && want.includes(type));
  });
}

export function isToolRole(message: unknown): boolean {
  const row = asWire(message);
  if (!row) return false;
  if (row.role === "tool" || row.role === "toolResult") return true;
  if (row.type === "function_call_output" || row.type === "function_call") return true;
  if (row.role === "user" && partsHaveType(row.content, ["tool_result", "tool-result"])) {
    return true;
  }
  return false;
}

function isAssistantToolTurn(message: unknown): boolean {
  const row = asWire(message);
  if (!row) return false;
  if (row.type === "function_call") return true;
  if (row.role === "assistant" && Array.isArray(row.tool_calls) && row.tool_calls.length) {
    return true;
  }
  if (row.role === "assistant" && partsHaveType(row.content, ["tool_use", "tool-call"])) {
    return true;
  }
  return false;
}

function isPinnedSystem(message: unknown): boolean {
  return asWire(message)?.role === "system";
}

function isSafeSendCut(message: unknown): boolean {
  if (isToolRole(message)) return false;
  const role = asWire(message)?.role;
  return role === "user" || role === "assistant" || role === "system";
}

function tokenCost(message: unknown): number {
  return Math.ceil(payloadChars(message) / SEND_CHARS_PER_TOKEN) + 16;
}

function messagePreview(message: unknown): string {
  const row = asWire(message);
  const role = row?.type || row?.role || "msg";
  let text = "";
  if (typeof row?.content === "string") text = row.content;
  else {
    try {
      text = JSON.stringify(row?.content ?? message ?? "");
    } catch {
      text = "";
    }
  }
  return `${role}: ${text.replace(/\s+/g, " ").trim().slice(0, 200)}`;
}

export function localSendSummary(dropped: unknown[]): string {
  const lines = dropped.slice(0, 40).map(messagePreview).filter(Boolean);
  return `${dropped.length} earlier tool-loop messages compacted.\n${lines.join("\n")}`.slice(
    0,
    SEND_SUMMARY_CAP,
  );
}

export const COMPACT_REFERENCE_PREFIX =
  "[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the summary below. Treat it as background, not as the live task. Respond only to the latest user message (including @handle specs) after this summary. Your tools stay available for that live task.";

export function compactPrefix(summary: string): { role: "user"; content: string }[] {
  const body = String(summary || "").trim() || "(empty compact)";
  return [
    {
      role: "user",
      content: `${COMPACT_REFERENCE_PREFIX}\n\n${body}`,
    },
  ];
}

function stampPrefix<T>(messages: T[], prefix: { role: string; content: string }[]): T[] {
  const sample = messages.find((item) => item && typeof item === "object") as
    | Record<string, unknown>
    | undefined;
  return prefix.map((row) => {
    if (sample && "timestamp" in sample) {
      return { ...row, timestamp: Date.now() } as T;
    }
    return row as T;
  });
}

function splitPinned<T>(messages: T[]): { pinned: T[]; rest: T[] } {
  let i = 0;
  while (i < messages.length && isPinnedSystem(messages[i])) i += 1;
  return { pinned: messages.slice(0, i), rest: messages.slice(i) };
}

function pairToolBoundary<T>(dropped: T[], kept: T[]): void {
  while (kept.length && (isToolRole(kept[0]) || isAssistantToolTurn(kept[0]))) {
    const prev = dropped[dropped.length - 1];
    if (prev && (isAssistantToolTurn(prev) || isToolRole(prev))) {
      kept.unshift(dropped.pop() as T);
      continue;
    }
    if (isToolRole(kept[0])) {
      kept.shift();
      continue;
    }
    break;
  }
  while (kept.length > 1 && !isSafeSendCut(kept[0])) kept.shift();
}

/**
 * Keep a suffix that fits under budget. Pins leading `system`, and never
 * starts the suffix on an orphan tool result.
 */
export function trimSendMessages<T>(
  messages: T[],
  extraTokens = 0,
  budget = SEND_TOKEN_BUDGET,
): T[] {
  return fitSendMessages(messages, extraTokens, { budget, compact: false });
}

/**
 * Hermes post-tool / pre-API gate on the send list: real usage first, rough
 * estimate waits one request, then compact at the working-window threshold.
 */
export function fitSendWithUsage<T>(
  messages: T[],
  extraTokens = 0,
  opts?: { wrap?: boolean; roomId?: string },
): T[] {
  const wrap = Boolean(opts?.wrap);
  const roomId = opts?.roomId;
  const state = roomId ? peekRoomUsage(roomId) : undefined;
  const rough =
    extraTokens + messages.reduce((sum, row) => sum + tokenCost(row), 0);
  const anchored = state?.anchor
    ? anchoredContextTokens(messages, state.anchor, (delta) =>
        delta.reduce((sum, row) => sum + tokenCost(row), 0),
      )
    : null;
  const pressure = resolvePressure({
    rough,
    lastPromptTokens: state?.lastPromptTokens,
    lastCompletionTokens: state?.lastCompletionTokens,
    awaitingAfterCompact: state?.awaitingAfterCompact,
    anchored,
  });
  if (
    shouldDeferToRealUsage({
      source: pressure.source,
      tokens: pressure.tokens,
      threshold: COMPACT_THRESHOLD_TOKENS,
      window: SEND_TOKEN_BUDGET,
      alreadyWaited: Boolean(state?.waitedOnce),
    })
  ) {
    markCompactDeferred(roomId);
    return fitSendMessages(messages, extraTokens, {
      budget: SEND_TOKEN_BUDGET,
      compact: false,
    });
  }
  const compact =
    !wrap &&
    shouldCompress(pressure.tokens, COMPACT_THRESHOLD_TOKENS) &&
    !state?.awaitingAfterCompact;
  const fitted = fitSendMessages(messages, extraTokens, {
    budget: compact ? COMPACT_THRESHOLD_TOKENS : SEND_TOKEN_BUDGET,
    compact,
  });
  if (compact && fitted.length < messages.length) markCompacted(roomId);
  return fitted;
}

/**
 * `compact: true` (non-wrap asks) replaces a dropped prefix with a
 * reference-only summary instead of silent trim. Skip on wrap.
 */
export function fitSendMessages<T>(
  messages: T[],
  extraTokens = 0,
  opts?: { budget?: number; compact?: boolean },
): T[] {
  const budget = opts?.budget ?? SEND_TOKEN_BUDGET;
  const { pinned, rest } = splitPinned(messages);
  if (rest.length <= KEEP_FLOOR) return messages.slice();
  let used = extraTokens;
  for (const row of pinned) used += tokenCost(row);
  const kept: T[] = [];
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const cost = tokenCost(rest[i]);
    if (kept.length >= KEEP_FLOOR && used + cost > budget) break;
    used += cost;
    kept.push(rest[i]);
  }
  kept.reverse();
  const dropped = rest.slice(0, rest.length - kept.length);
  pairToolBoundary(dropped, kept);
  if (!kept.length) return [...pinned, ...rest.slice(-KEEP_FLOOR)];
  if (!opts?.compact || !dropped.length) return [...pinned, ...kept];
  const prefix = stampPrefix(messages, compactPrefix(localSendSummary(dropped)));
  return [...pinned, ...prefix, ...kept];
}
