import type { ModelRef } from "@guild/protocol";
import { llmComplete } from "./llm.ts";
import type { GuildStore } from "./store.ts";

export const MEMORY_FILE_CAP = 8_000;
export const MEMORY_INJECT_CAP = 3_500;

const GREETING =
  /^(hi|hello|hey|yo|sup|早安|午安|晚安|大家好|哈囉|嗨|你好)[\s!！。.~…]*$/i;

export function clipMemory(text: string, cap = MEMORY_FILE_CAP): string {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (raw.length <= cap) return raw;
  return raw.slice(0, cap - 1).trimEnd() + "…";
}

export function redactSecrets(text: string): string {
  return String(text || "")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._\-]{8,}\b/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

export function shouldHarvestMemory(userMessage: string, reply = ""): boolean {
  const user = String(userMessage || "").trim();
  const assistant = String(reply || "").trim();
  if (!user && !assistant) return false;
  if (GREETING.test(user) && assistant.length < 80) return false;
  if (user.length + assistant.length < 28) return false;
  if (/沒有可用模型/.test(assistant)) return false;
  return true;
}

export function applyMemoryUpdate(
  current: string,
  extracted: string | null | undefined,
): string | null {
  if (extracted == null) return null;
  const text = redactSecrets(String(extracted).replace(/\r\n/g, "\n")).trim();
  if (!text) return null;
  const first = text.split("\n")[0].trim();
  if (/^NO_CHANGE$/i.test(first) || /^NO_CHANGE$/i.test(text)) return null;
  if (looksLikeError(text)) return null;
  if (text.length < 8) return null;
  const next = clipMemory(text);
  const prev = String(current || "").trim();
  if (next === prev) return null;
  return next;
}

function looksLikeError(text: string): boolean {
  return /模型請求|訂閱.*失效|unauthorized|login failed|ECONNREFUSED/i.test(
    text.slice(0, 400),
  );
}

function extractPrompt(scope: "bot" | "channel", current: string, turn: string): string {
  const who =
    scope === "bot"
      ? "this bot and the user"
      : "this channel (shared by everyone in the room)";
  return `You maintain MEMORY.md for ${who}.
Standing notes only: names, preferences, decisions, recurring work, conventions, ownership, tech.
Do not record greetings, the current date/time, one-off questions, secrets, passwords, or API keys.
Keep useful old bullets. Drop stale or contradicted ones. Max 80 lines.

Current MEMORY.md:
<<<
${current.trim() || "(empty)"}
>>>

New turn:
${turn.trim()}

Reply with the complete updated MEMORY.md, or exactly NO_CHANGE.`;
}

export async function extractMemory(input: {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  prefer?: ModelRef | null;
  scope: "bot" | "channel";
  current: string;
  turn: string;
}): Promise<string | null> {
  const result = await llmComplete({
    dataDir: input.dataDir,
    env: input.env,
    role: "compression",
    prefer: input.prefer,
    tools: false,
    temperature: 0.1,
    system:
      "You rewrite MEMORY.md. Output markdown or NO_CHANGE. No preamble.",
    messages: [
      {
        role: "user",
        content: extractPrompt(input.scope, input.current, input.turn),
      },
    ],
  });
  return result?.text ?? null;
}

export async function harvestBotMemory(input: {
  store: GuildStore;
  botId: string;
  userMessage: string;
  reply: string;
  env?: NodeJS.ProcessEnv;
  prefer?: ModelRef | null;
}): Promise<{ updated: boolean; body: string }> {
  const current = input.store.readBotMemory(input.botId);
  if (!shouldHarvestMemory(input.userMessage, input.reply)) {
    return { updated: false, body: current };
  }
  const extracted = await extractMemory({
    dataDir: input.store.dataDir,
    env: input.env,
    prefer: input.prefer,
    scope: "bot",
    current,
    turn: `User: ${input.userMessage}\nAssistant: ${input.reply}`,
  });
  const next = applyMemoryUpdate(current, extracted);
  if (next == null) return { updated: false, body: current };
  return { updated: true, body: input.store.writeBotMemory(input.botId, next) };
}

export async function harvestChannelMemory(input: {
  store: GuildStore;
  roomId: string;
  userMessage: string;
  replies: { handle?: string; author: string; body: string }[];
  env?: NodeJS.ProcessEnv;
  prefer?: ModelRef | null;
}): Promise<{ updated: boolean; body: string }> {
  const current = input.store.readChannelMemory(input.roomId);
  const lines = input.replies
    .map((item) => `@${item.handle || item.author}: ${item.body}`)
    .join("\n");
  if (!shouldHarvestMemory(input.userMessage, lines)) {
    return { updated: false, body: current };
  }
  const extracted = await extractMemory({
    dataDir: input.store.dataDir,
    env: input.env,
    prefer: input.prefer,
    scope: "channel",
    current,
    turn: `User: ${input.userMessage}\n${lines}`,
  });
  const next = applyMemoryUpdate(current, extracted);
  if (next == null) return { updated: false, body: current };
  return {
    updated: true,
    body: input.store.writeChannelMemory(input.roomId, next),
  };
}
