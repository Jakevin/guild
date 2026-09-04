import type { ChatPart, ModelRef } from "@guild/protocol";
import { llmComplete } from "./llm.ts";
import type { ToolProgress } from "./tools.ts";

/** Cheap char/4 estimate, same ballpark Codex uses before a real tokenizer. */
export const CHARS_PER_TOKEN = 4;
/** Default working window minus output/tool reserve. */
export const DEFAULT_AUTO_COMPACT_TOKENS = 88_000;
const KEEP_RECENT_MIN = 6;
const KEEP_RECENT_FLOOR = 2;
const HISTORY_BODY_CAP = 12_000;
const PART_OUTPUT_CAP = 2_000;
const PARTS_BLOCK_CAP = 8_000;
const MAX_TOOL_PARTS = 8;
const THINK_CAP = 400;
const SUMMARY_CAP = 4_000;

export {
  SEND_TOKEN_BUDGET,
  estimateSendTokens,
  trimSendMessages,
} from "./send-budget.ts";

export type HistoryItem = {
  id?: string;
  author: string;
  body: string;
  parts?: ChatPart[];
};

export type CompactCheckpoint = {
  throughId: string;
  summary: string;
  updatedAt: string;
  messageCount: number;
};

export type PackedHistory = {
  messages: { role: "user" | "assistant"; content: string }[];
  compacted: boolean;
  checkpoint: CompactCheckpoint | null;
};

export function estimateTokens(text: string): number {
  return Math.ceil(String(text || "").length / CHARS_PER_TOKEN);
}

function clipText(text: string, cap: number): string {
  const value = String(text || "");
  if (value.length <= cap) return value;
  return `${value.slice(0, cap)}\n… truncated …`;
}

export function clipHistoryItem(item: HistoryItem): HistoryItem {
  const body = clipText(item.body, HISTORY_BODY_CAP);
  if (!item.parts?.length) {
    return body === item.body ? item : { ...item, body };
  }
  const tools = item.parts.filter(
    (part) => part.type === "tool" || part.type === "skill",
  );
  const thinking = item.parts.find((part) => part.type === "thinking");
  const textParts = item.parts.filter((part) => part.type === "text");
  const clippedTools = tools.slice(-MAX_TOOL_PARTS).map((part) => {
    if (part.type === "skill") {
      return {
        ...part,
        output: part.output ? clipText(part.output, PART_OUTPUT_CAP) : part.output,
      };
    }
    return { ...part, output: clipText(part.output, PART_OUTPUT_CAP) };
  });
  const parts: ChatPart[] = [];
  if (thinking?.text) {
    parts.push({
      type: "thinking",
      text: clipText(thinking.text, THINK_CAP),
    });
  }
  parts.push(...clippedTools, ...textParts);
  return { ...item, body, parts };
}

export function formatPartsForModel(parts: ChatPart[] | undefined): string {
  if (!parts?.length) return "";
  const lines: string[] = [];
  for (const part of parts) {
    if (part.type === "thinking") continue;
    if (part.type === "text") continue;
    if (part.type === "skill") {
      lines.push(`skill ${part.name}`.trim());
      continue;
    }
    const head = `${part.name} ${part.detail || ""}`.trim();
    const out = String(part.output || "").trim();
    lines.push(out ? `${head}\n${out}` : head);
  }
  const block = lines.join("\n\n");
  if (block.length <= PARTS_BLOCK_CAP) return block;
  return `${block.slice(0, PARTS_BLOCK_CAP)}\n… truncated …`;
}

export function toHistoryItem(message: {
  id?: string;
  author: string;
  body: string;
  parts?: ChatPart[];
}): HistoryItem {
  return {
    id: message.id,
    author: message.author,
    body: message.body,
    ...(message.parts && message.parts.length ? { parts: message.parts } : {}),
  };
}

export function toModelMessage(item: HistoryItem): {
  role: "user" | "assistant";
  content: string;
} {
  const tools = formatPartsForModel(item.parts);
  if (item.author === "you") {
    return {
      role: "user",
      content: tools ? `${item.body}\n\n<tools>\n${tools}\n</tools>` : item.body,
    };
  }
  const text = `${item.author}: ${item.body}`;
  return {
    role: "assistant",
    content: tools ? `${text}\n\n<tools>\n${tools}\n</tools>` : text,
  };
}

function messagesTokens(
  messages: { role: string; content: string }[],
): number {
  return messages.reduce((sum, item) => sum + estimateTokens(item.content) + 8, 0);
}

export function localCompactSummary(items: HistoryItem[]): string {
  const users = items
    .filter((item) => item.author === "you")
    .map((item) => String(item.body || "").replace(/\s+/g, " ").trim().slice(0, 160))
    .filter(Boolean);
  const bots = items.filter((item) => item.author !== "you");
  const tools = [
    ...new Set(
      items.flatMap((item) =>
        (item.parts || [])
          .filter(
            (part): part is Extract<ChatPart, { type: "tool" }> =>
              part.type === "tool",
          )
          .map((part) => `${part.name} ${part.detail || ""}`.trim()),
      ),
    ),
  ].slice(0, 24);
  const lines = [
    `${items.length} earlier messages compacted.`,
    users.length ? `User asked: ${users.slice(0, 10).join(" | ")}` : "",
    bots.length ? `Assistants replied in ${bots.length} turns.` : "",
    tools.length ? `Tools: ${tools.join("; ")}` : "",
  ].filter(Boolean);
  return lines.join("\n").slice(0, SUMMARY_CAP);
}

export function compactPrefix(summary: string): {
  role: "user" | "assistant";
  content: string;
}[] {
  const body = String(summary || "").trim() || "(empty compact)";
  return [
    {
      role: "user",
      content:
        "# Conversation so far (compacted)\n" +
        "Use this summary as prior context. Messages after it are the recent turns at full fidelity.\n\n" +
        body,
    },
    {
      role: "assistant",
      content: "Understood. I'll continue from this summary plus the recent turns.",
    },
  ];
}

function lastId(items: HistoryItem[]): string {
  return items[items.length - 1]?.id || `count:${items.length}`;
}

export function canReuseCheckpoint(
  checkpoint: CompactCheckpoint | null | undefined,
  old: HistoryItem[],
): boolean {
  if (!checkpoint || !old.length) return false;
  if (!checkpoint.summary.trim()) return false;
  if (checkpoint.messageCount !== old.length) return false;
  return checkpoint.throughId === lastId(old);
}

export function planCompact(input: {
  system: string;
  history: HistoryItem[];
  userMessage: string;
  tokenLimit?: number;
}): { mode: "full" | "compact"; old: HistoryItem[]; recent: HistoryItem[] } {
  const limit = input.tokenLimit ?? DEFAULT_AUTO_COMPACT_TOKENS;
  const mapped = input.history.map(toModelMessage);
  const user = { role: "user" as const, content: input.userMessage };
  const fullCost =
    estimateTokens(input.system) + messagesTokens([...mapped, user]);
  if (fullCost <= limit) {
    return { mode: "full", old: [], recent: input.history };
  }
  if (input.history.length <= 1) {
    return { mode: "full", old: [], recent: input.history };
  }

  const prefixBudget =
    estimateTokens(input.system) +
    estimateTokens(compactPrefix("x").map((item) => item.content).join("\n")) +
    200;
  const tailBudget = Math.max(512, limit - prefixBudget - estimateTokens(input.userMessage));
  let recentCount = 0;
  let used = 0;
  for (let i = input.history.length - 1; i >= 0; i -= 1) {
    const cost = estimateTokens(toModelMessage(input.history[i]).content) + 8;
    if (recentCount >= KEEP_RECENT_FLOOR && used + cost > tailBudget) break;
    if (recentCount >= KEEP_RECENT_MIN && used + cost > tailBudget) break;
    used += cost;
    recentCount += 1;
  }
  recentCount = Math.max(
    Math.min(KEEP_RECENT_FLOOR, input.history.length),
    recentCount,
  );
  const split = input.history.length - recentCount;
  if (split <= 0) {
    return { mode: "full", old: [], recent: input.history };
  }
  return {
    mode: "compact",
    old: input.history.slice(0, split),
    recent: input.history.slice(split),
  };
}

async function summarizeOld(input: {
  old: HistoryItem[];
  previous?: string;
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  prefer?: ModelRef | null;
  onProgress?: (update: ToolProgress) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const transcript = input.old
    .map((item) => {
      const who = item.author === "you" ? "User" : item.author;
      const tools = (item.parts || [])
        .filter(
          (part): part is Extract<ChatPart, { type: "tool" }> =>
            part.type === "tool",
        )
        .slice(-MAX_TOOL_PARTS)
        .map((part) => `${part.name} ${part.detail || ""}`.trim())
        .join("; ");
      const line = `${who}: ${String(item.body || "").slice(0, 400)}`;
      return tools ? `${line} [${tools}]` : line;
    })
    .join("\n")
    .slice(0, 24_000);
  const result = await llmComplete({
    dataDir: input.dataDir,
    env: input.env,
    role: "compression",
    prefer: input.prefer,
    tools: false,
    temperature: 0.1,
    toolCtx: {
      dataDir: input.dataDir,
      env: input.env,
      spawnDepth: 0,
      allowWrite: false,
      onProgress: input.onProgress,
      signal: input.signal,
    },
    system:
      "You compact a conversation so work can continue. Output only the summary.",
    messages: [
      {
        role: "user",
        content:
          "Summarize the older conversation for continuing work. Capture goals, decisions, constraints, files/tools used, and open questions. Do not mention this summarization. Be dense.\n\n" +
          (input.previous?.trim()
            ? `Previous compact:\n${input.previous.trim()}\n\n`
            : "") +
          `Older messages:\n${transcript}`,
      },
    ],
  });
  const text = result?.text?.trim() || "";
  if (text.length >= 24 && !/模型請求|unauthorized|login failed/i.test(text)) {
    return text.slice(0, SUMMARY_CAP);
  }
  return localCompactSummary(input.old);
}

export async function packHistory(input: {
  system: string;
  history: HistoryItem[];
  userMessage: string;
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  prefer?: ModelRef | null;
  checkpoint?: CompactCheckpoint | null;
  tokenLimit?: number;
  /** Local summary skips the compression LLM. Omit onCompact to skip persisting a checkpoint. */
  summarize?: "llm" | "local";
  onCompact?: (checkpoint: CompactCheckpoint) => void;
  onProgress?: (update: ToolProgress) => void;
  signal?: AbortSignal;
}): Promise<PackedHistory> {
  const user = { role: "user" as const, content: input.userMessage };
  const history = input.history.map(clipHistoryItem);
  const plan = planCompact({
    system: input.system,
    history,
    userMessage: input.userMessage,
    tokenLimit: input.tokenLimit,
  });
  if (plan.mode === "full") {
    return {
      messages: [...plan.recent.map(toModelMessage), user],
      compacted: false,
      checkpoint: input.checkpoint ?? null,
    };
  }

  let summary = "";
  let checkpoint: CompactCheckpoint;
  if (canReuseCheckpoint(input.checkpoint, plan.old)) {
    summary = input.checkpoint!.summary;
    checkpoint = input.checkpoint!;
  } else {
    input.onProgress?.({
      thinking: "整理上文…",
      traces: [
        {
          name: "context",
          args: {},
          text: "",
          isError: false,
          running: true,
        },
      ],
    });
    summary =
      input.summarize === "local"
        ? localCompactSummary(plan.old)
        : await summarizeOld({
            old: plan.old,
            previous: input.checkpoint?.summary,
            dataDir: input.dataDir,
            env: input.env,
            prefer: input.prefer,
            onProgress: input.onProgress,
            signal: input.signal,
          });
    checkpoint = {
      throughId: lastId(plan.old),
      summary,
      updatedAt: new Date().toISOString(),
      messageCount: plan.old.length,
    };
  }

  input.onCompact?.(checkpoint);
  return {
    messages: [
      ...compactPrefix(summary),
      ...plan.recent.map(toModelMessage),
      user,
    ],
    compacted: true,
    checkpoint,
  };
}
