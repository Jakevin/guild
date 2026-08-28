/** Grok 4.6 is 500k. Stay under, and count CJK/code denser than char/4. */
export const SEND_TOKEN_BUDGET = 400_000;
const SEND_CHARS_PER_TOKEN = 1.5;
const KEEP_FLOOR = 2;

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
    return JSON.stringify(message).length;
  } catch {
    return 0;
  }
}

function isSafeSendCut(message: unknown): boolean {
  const role = (message as { role?: string } | null)?.role;
  return role === "user" || role === "assistant" || role === "system";
}

/** Keep a suffix of messages that fits under budget. Drops oldest tool noise first. */
export function trimSendMessages<T>(
  messages: T[],
  extraTokens = 0,
  budget = SEND_TOKEN_BUDGET,
): T[] {
  if (messages.length <= KEEP_FLOOR) return messages;
  let used = extraTokens;
  const kept: T[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const cost = Math.ceil(payloadChars(messages[i]) / SEND_CHARS_PER_TOKEN) + 16;
    if (kept.length >= KEEP_FLOOR && used + cost > budget) break;
    used += cost;
    kept.push(messages[i]);
  }
  const out = kept.reverse();
  while (out.length > KEEP_FLOOR && !isSafeSendCut(out[0])) out.shift();
  return out;
}
