import type { ChatPart, ModelRef } from "@guild/protocol";
import { llmComplete } from "./llm.ts";
import { StoreError, type GuildStore } from "./store.ts";

export const MEMORY_FILE_CAP = 8_000;
export const MEMORY_INJECT_CAP = 3_500;
export const MEMORY_LIVE_TASK_NOTE =
  "Dated standing notes (Updated / YYYY-MM-DD). Not the live task. The latest user message outranks Channel.md, which outranks this file. Do not revive Closed, contradicted, or wait-for-human bullets as this-turn Goal once the human already asked.";

const UPDATED_LINE = /^Updated:\s*\S+[^\n]*\n*/;

const GREETING =
  /^(hi|hello|hey|yo|sup|早安|午安|晚安|大家好|哈囉|嗨|你好)[\s!！。.~…]*$/i;

export function clipMemory(text: string, cap = MEMORY_FILE_CAP): string {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (raw.length <= cap) return raw;
  return raw.slice(0, cap - 1).trimEnd() + "…";
}

export function memoryTimestamp(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function stampMemoryUpdated(text: string, now = new Date()): string {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  const stripped = raw.replace(UPDATED_LINE, "").trim();
  if (!stripped) return `Updated: ${memoryTimestamp(now)}\n`;
  return `Updated: ${memoryTimestamp(now)}\n\n${stripped}`;
}

export function redactSecrets(text: string): string {
  return String(text || "")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._\-]{8,}\b/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

const ACT_TOOLS = new Set([
  "run",
  "write",
  "computer",
  "browser",
  "cronjob",
  "spawn",
  "image_gen",
  "tts",
]);
const EVIDENCE_CAP = 1_600;
const EVIDENCE_TOOLS = 8;
const EVIDENCE_BLOCK = 12_000;
const EXIT_TAIL = /\n\[(?:exit code: [^\]]+|timed out after [^\]]+)\]\s*$/;

export type MemoryVerdict = "pass" | "fail" | "unresolved";

function isActName(name: string): boolean {
  return ACT_TOOLS.has(name) || name.startsWith("mcp__");
}

function tailText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const mark = "… truncated …\n";
  const room = cap - mark.length;
  if (room < 1) return text.slice(-cap);
  return mark + text.slice(-room);
}

function splitRunTail(before: string): { head: string; stderr: string } {
  const at = before.lastIndexOf("\n[stderr]\n");
  if (at >= 0) return { head: before.slice(0, at), stderr: before.slice(at + 1) };
  if (before.startsWith("[stderr]\n")) return { head: "", stderr: before };
  return { head: before, stderr: "" };
}

function clipEvidence(text: string): string {
  const raw = String(text || "");
  if (raw.length <= EVIDENCE_CAP) return raw;
  const exit = raw.match(EXIT_TAIL);
  if (!exit || exit.index == null) {
    return `${raw.slice(0, EVIDENCE_CAP)}\n… truncated …`;
  }
  const exitLine = exit[0].trim();
  const { head, stderr } = splitRunTail(raw.slice(0, exit.index));
  const stderrKeep =
    !stderr ? "" : stderr.length > 400 ? `…\n${stderr.slice(-400)}` : stderr;
  const tail = stderrKeep ? `${stderrKeep}\n${exitLine}` : exitLine;
  const mark = "\n… truncated …\n";
  const room = EVIDENCE_CAP - tail.length - mark.length;
  if (room < 40) return tail.slice(-EVIDENCE_CAP);
  if (head.length <= room) return head ? `${head}\n${tail}` : tail;
  return `${head.slice(0, room)}${mark}${tail}`;
}

export function shouldVerifyMemory(parts?: ChatPart[]): boolean {
  return (parts || []).some(
    (part) => part.type === "tool" && isActName(part.name),
  );
}

export function formatTurnEvidence(parts?: ChatPart[]): string {
  const tools = (parts || [])
    .filter((part): part is Extract<ChatPart, { type: "tool" }> => part.type === "tool")
    .map((part, index) => ({ part, index }));
  if (!tools.length) return "";
  const acts = tools.filter(({ part }) => isActName(part.name));
  const spare = Math.max(0, EVIDENCE_TOOLS - acts.length);
  const filler = tools
    .filter(({ part }) => !isActName(part.name))
    .slice(-spare);
  const chosen = [...acts, ...filler].sort((a, b) => a.index - b.index);
  const block = chosen
    .map(({ part }) => {
      const head = `${part.name} ${part.detail || ""}`.trim();
      const err = part.isError ? " error" : "";
      const out = clipEvidence(String(part.output || "").trim());
      return out ? `${head}${err}\n${out}` : `${head}${err}`;
    })
    .join("\n\n");
  return tailText(block, EVIDENCE_BLOCK);
}

export function parseVerifyVerdict(text: string): MemoryVerdict | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const verdictOf = (value: unknown): MemoryVerdict | null => {
    const v = String(value || "").toLowerCase().trim();
    if (v === "pass" || v === "fail" || v === "unresolved") return v;
    return null;
  };
  if (raw.includes("{")) {
    const fenced = raw.match(/\{[\s\S]*\}/);
    if (!fenced) return null;
    try {
      const rec = JSON.parse(fenced[0]) as { verdict?: unknown };
      return verdictOf(rec.verdict);
    } catch {
      return null;
    }
  }
  return verdictOf(raw);
}

export function allowMemoryHarvest(hasAct: boolean, verdict: MemoryVerdict | null): boolean {
  if (!hasAct) return true;
  return verdict === "pass";
}

export async function verifyTurn(input: {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  userMessage: string;
  evidence: string;
}): Promise<MemoryVerdict> {
  const evidence = String(input.evidence || "").trim();
  if (!evidence) return "pass";
  const result = await llmComplete({
    dataDir: input.dataDir,
    env: input.env,
    role: "classifier",
    tools: false,
    temperature: 0,
    fast: true,
    system:
      "You independently verify whether observed tool results satisfy the user's ask. You cannot see the actor's plan, thinking, or MEMORY.md. JSON only. Do not think out loud.",
    messages: [
      {
        role: "user",
        content: `User ask:
<<<
${String(input.userMessage || "").trim()}
>>>

Observed tool results (not the actor's narration):
<<<
${tailText(evidence, EVIDENCE_BLOCK)}
>>>

Reply JSON only: {"verdict":"pass"|"fail"|"unresolved","why":"one line"}
pass = results show the ask was done.
fail = results show it was not done, refused, or contradicted.
unresolved = evidence is insufficient.`,
      },
    ],
  });
  return parseVerifyVerdict(result?.text || "") || "unresolved";
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
  const today = memoryTimestamp().slice(0, 10);
  return `You maintain MEMORY.md for ${who}.
Standing notes only: names, preferences, decisions, recurring work, conventions, ownership, tech.
Today (UTC) is ${today}. Start the file with one line: Updated: <ISO-8601 UTC>.
Prefix fact bullets with YYYY-MM-DD (keep existing dates; new or changed facts use ${today}).
Put cancelled, shipped, or do-not-revive items under ## Closed. Closed is not this-turn Goal.
The latest user message outranks Channel.md, which outranks these notes. Do not treat Closed or contradicted bullets as the live task.
If the latest human message asked to push / 上版 / commit / tag / 發布, record that as authorized Act — do not keep a wait-for-human blocker.
Shipped or withdrawn version cuts belong under ## Closed (one line). Do not keep them as Current Goal.
Do not record greetings, one-off questions, secrets, passwords, or API keys.
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
  parts?: ChatPart[];
  env?: NodeJS.ProcessEnv;
  prefer?: ModelRef | null;
}): Promise<{ updated: boolean; body: string; skipped?: MemoryVerdict }> {
  const current = input.store.readBotMemory(input.botId);
  if (!shouldHarvestMemory(input.userMessage, input.reply)) {
    return { updated: false, body: current };
  }
  const hasAct = shouldVerifyMemory(input.parts);
  const evidence = formatTurnEvidence(input.parts);
  let verdict: MemoryVerdict | null = null;
  if (hasAct) {
    verdict = await verifyTurn({
      dataDir: input.store.dataDir,
      env: input.env,
      userMessage: input.userMessage,
      evidence,
    });
    if (!allowMemoryHarvest(true, verdict)) {
      return { updated: false, body: current, skipped: verdict };
    }
  }
  const turn = hasAct
    ? `User: ${input.userMessage}\nObserved:\n${evidence}`
    : `User: ${input.userMessage}\nAssistant: ${input.reply}`;
  const extracted = await extractMemory({
    dataDir: input.store.dataDir,
    env: input.env,
    prefer: input.prefer,
    scope: "bot",
    current,
    turn,
  });
  const next = applyMemoryUpdate(current, extracted);
  if (next == null) return { updated: false, body: current };
  return {
    updated: true,
    body: input.store.writeBotMemory(input.botId, stampMemoryUpdated(next)),
  };
}

export function localMergeQuestMemory(
  parent: string,
  child: string,
  questName: string,
): string | null {
  const from = redactSecrets(String(child || "").replace(/\r\n/g, "\n")).trim();
  if (!from) return null;
  const into = String(parent || "").replace(/\r\n/g, "\n").trim();
  const heading = String(questName || "side quest").replace(/\s+/g, " ").trim() || "side quest";
  if (!into) return clipMemory(from);
  if (into.includes(from)) return null;
  return clipMemory(`${into}\n\n## ${heading}\n\n${from}`);
}

function mergeQuestPrompt(parent: string, child: string, questName: string): string {
  const today = memoryTimestamp().slice(0, 10);
  return `You merge a closed side quest's MEMORY.md into the parent channel MEMORY.md.
Standing notes only: names, preferences, decisions, recurring work, conventions, ownership, tech.
Today (UTC) is ${today}. Start the file with one line: Updated: <ISO-8601 UTC>.
Prefix fact bullets with YYYY-MM-DD (keep existing dates; new facts use ${today}).
Put cancelled, shipped, or do-not-revive items under ## Closed. Closed is not this-turn Goal.
Keep useful bullets from both. Drop stale, duplicated, or contradicted ones. Max 80 lines.
Do not copy the whole transcript. Do not mention this merge.

Parent MEMORY.md:
<<<
${parent.trim() || "(empty)"}
>>>

Closed quest "${questName}" MEMORY.md:
<<<
${child.trim()}
>>>

Reply with the complete updated parent MEMORY.md, or exactly NO_CHANGE.`;
}

export async function mergeQuestMemory(input: {
  store: GuildStore;
  parentId: string;
  childId: string;
  questName: string;
  env?: NodeJS.ProcessEnv;
  prefer?: ModelRef | null;
}): Promise<{ updated: boolean; body: string }> {
  const parent = input.store.readChannelMemory(input.parentId);
  const child = input.store.readChannelMemory(input.childId);
  if (!child.trim()) return { updated: false, body: parent };
  const result = await llmComplete({
    dataDir: input.store.dataDir,
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
        content: mergeQuestPrompt(parent, child, input.questName),
      },
    ],
  });
  const fromModel = applyMemoryUpdate(parent, result?.text ?? null);
  const next = fromModel ?? localMergeQuestMemory(parent, child, input.questName);
  if (next == null) return { updated: false, body: parent };
  return {
    updated: true,
    body: input.store.writeChannelMemory(
      input.parentId,
      stampMemoryUpdated(next),
    ),
  };
}

export async function harvestChannelMemory(input: {
  store: GuildStore;
  roomId: string;
  userMessage: string;
  replies: { handle?: string; author: string; body: string }[];
  parts?: ChatPart[];
  env?: NodeJS.ProcessEnv;
  prefer?: ModelRef | null;
}): Promise<{ updated: boolean; body: string; skipped?: MemoryVerdict }> {
  const current = input.store.readChannelMemory(input.roomId);
  const lines = input.replies
    .map((item) => `@${item.handle || item.author}: ${item.body}`)
    .join("\n");
  if (!shouldHarvestMemory(input.userMessage, lines)) {
    return { updated: false, body: current };
  }
  const hasAct = shouldVerifyMemory(input.parts);
  const evidence = formatTurnEvidence(input.parts);
  if (hasAct) {
    const verdict = await verifyTurn({
      dataDir: input.store.dataDir,
      env: input.env,
      userMessage: input.userMessage,
      evidence,
    });
    if (!allowMemoryHarvest(true, verdict)) {
      return { updated: false, body: current, skipped: verdict };
    }
  }
  const turn = hasAct
    ? `User: ${input.userMessage}\nObserved:\n${evidence}`
    : `User: ${input.userMessage}\n${lines}`;
  const extracted = await extractMemory({
    dataDir: input.store.dataDir,
    env: input.env,
    prefer: input.prefer,
    scope: "channel",
    current,
    turn,
  });
  const next = applyMemoryUpdate(current, extracted);
  if (next == null) return { updated: false, body: current };
  return {
    updated: true,
    body: input.store.writeChannelMemory(
      input.roomId,
      stampMemoryUpdated(next),
    ),
  };
}

export type TidyMemoryResult = {
  body: string;
  plan: string;
  needs: string[];
  dropped: string[];
  proposal: string;
};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function stripFence(text: string): string {
  const raw = String(text || "").trim();
  const fenced = raw.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : raw;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const raw = stripFence(text);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function formatTidyProposal(input: {
  plan?: string;
  needs?: string[];
  dropped?: string[];
}): string {
  const plan = String(input.plan || "").trim();
  const needs = (input.needs || []).filter(Boolean);
  const dropped = (input.dropped || []).filter(Boolean);
  const lines: string[] = [];
  if (plan) lines.push(plan);
  if (needs.length) lines.push(`Needs:\n- ${needs.join("\n- ")}`);
  if (dropped.length) lines.push(`Dropped:\n- ${dropped.join("\n- ")}`);
  return lines.join("\n\n");
}

export function parseTidyMemory(
  text: string,
  now = new Date(),
): TidyMemoryResult | null {
  const rec = parseJsonObject(text);
  const bodyRaw = rec && typeof rec.body === "string" ? rec.body : rec ? "" : text;
  const body = stampMemoryUpdated(stripFence(bodyRaw), now);
  if (body.length < 8) return null;
  const plan = rec && typeof rec.plan === "string" ? rec.plan.trim() : "";
  const needs = rec ? stringList(rec.needs) : [];
  const dropped = rec ? stringList(rec.dropped) : [];
  return {
    body,
    plan,
    needs,
    dropped,
    proposal: formatTidyProposal({ plan, needs, dropped }),
  };
}

export const TIDY_ASK_CAP = 500;

export function clipTidyAsk(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TIDY_ASK_CAP);
}

export function buildTidyPrompt(input: {
  scope: "bot" | "channel";
  current: string;
  channelMd?: string;
  ask?: string;
}): string {
  const who =
    input.scope === "bot"
      ? "this bot and the user"
      : "this channel (shared by everyone in the room)";
  const channel = String(input.channelMd || "").trim();
  const today = memoryTimestamp().slice(0, 10);
  const ask = clipTidyAsk(input.ask || "");
  const channelBlock = channel
    ? `Channel.md (outranks MEMORY.md; do not copy it into MEMORY.md):\n<<<\n${channel.slice(0, 4000)}\n>>>\n\n`
    : "";
  const askBlock = ask
    ? `Live task (human ask — this is the Plan directive; do it):\n<<<\n${ask}\n>>>\n\n`
    : "";
  const plan = ask
    ? `Plan: one local directive. Goal: ${ask}. Also date remaining notes and keep Closed from looking like the live Goal. Done when the ask is reflected in MEMORY.md.`
    : "Plan: one local directive. Goal: keep current standing facts, drop stale/duplicated/contradicted bullets, date what remains. Done when the file is short, dated, and Closed items cannot be mistaken for the live Goal.";
  return `Tidy MEMORY.md for ${who}. Follow the Guild harness this turn.
Today (UTC) is ${today}.

Memory: the latest human ask is the live task when present. Channel.md is room procedure. MEMORY.md is dated standing notes, not the live task. Do not recap a transcript. Closed bullets stay closed. Do not keep a wait-for-human blocker after the human already asked.

${plan}

Skills: none. Do not call tools. Do not inspect the repo. Do not commit, push, or tag.

Act: rewrite MEMORY.md. Then list remaining needs (open questions that still need a human or a seat) — propose them, do not execute.

Rules:
- First line: Updated: <ISO-8601 UTC>
- Fact bullets start with YYYY-MM-DD (keep old dates; new or changed facts use ${today})
- Sections: Current, Closed, Conventions (omit empty)
- Closed = cancelled, shipped-and-done, do-not-revive. Never phrase Closed as a Goal.
- Drop status theater, PID trivia, and repeated void-rituals of old versions once recorded as Closed.
- A shipped or withdrawn version cut (old tag / republish / downgrade) is Closed history. One Closed line is enough. Never a Current Goal.
- If the live task asks to delete or drop a topic, remove it from Current. Do not leave it as a Goal. A one-line Closed note is enough if the fact still matters (shipped / do not revive).
- Max 80 lines. Language: follow the current file.

${askBlock}${channelBlock}Current MEMORY.md:
<<<
${input.current.trim()}
>>>

Return JSON only:
{"plan":"goal + done when","needs":["still open…"],"dropped":["removed or moved to Closed…"],"body":"<full MEMORY.md>"}`;
}

export async function tidyMemory(input: {
  store: GuildStore;
  scope: "bot" | "channel";
  current: string;
  channelMd?: string;
  ask?: string;
  env?: NodeJS.ProcessEnv;
  prefer?: ModelRef | null;
}): Promise<TidyMemoryResult> {
  const current = String(input.current || "").replace(/\r\n/g, "\n").trim();
  if (!current) throw new StoreError(400, "memory is empty");
  const result = await llmComplete({
    dataDir: input.store.dataDir,
    env: input.env,
    role: "compression",
    prefer: input.prefer,
    tools: false,
    temperature: 0.1,
    system:
      "You tidy MEMORY.md with the Guild harness (Memory → Plan → Skills → Act). Output JSON only. No preamble.",
    messages: [{ role: "user", content: buildTidyPrompt({ ...input, current }) }],
  });
  if (!result?.text?.trim()) {
    throw new StoreError(400, "no model connected");
  }
  if (looksLikeError(result.text)) throw new StoreError(400, "tidy failed");
  const parsed = parseTidyMemory(result.text);
  if (!parsed) throw new StoreError(400, "tidy failed");
  return parsed;
}
