import type { ModelRef } from "@guild/protocol";
import { llmComplete } from "./llm.ts";

/** Cheap char/4 estimate, same ballpark Codex uses before a real tokenizer. */
export const CHARS_PER_TOKEN = 4;
/** Default working window minus output/tool reserve. */
export const DEFAULT_AUTO_COMPACT_TOKENS = 88_000;
const KEEP_RECENT_MIN = 6;
const SUMMARY_CAP = 4_000;

export type HistoryItem = {
  id?: string;
  author: string;
  body: string;
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

export function toModelMessage(item: HistoryItem): {
  role: "user" | "assistant";
  content: string;
} {
  if (item.author === "you") {
    return { role: "user", content: item.body };
  }
  return {
    role: "assistant",
    content: `${item.author}: ${item.body}`,
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
  const lines = [
    `${items.length} earlier messages compacted.`,
    users.length ? `User asked: ${users.slice(0, 10).join(" | ")}` : "",
    bots.length ? `Assistants replied in ${bots.length} turns.` : "",
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
  if (fullCost <= limit || input.history.length <= KEEP_RECENT_MIN) {
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
    if (recentCount >= KEEP_RECENT_MIN && used + cost > tailBudget) break;
    used += cost;
    recentCount += 1;
  }
  recentCount = Math.max(
    Math.min(KEEP_RECENT_MIN, input.history.length),
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
}): Promise<string> {
  const transcript = input.old
    .map((item) => {
      const who = item.author === "you" ? "User" : item.author;
      return `${who}: ${String(item.body || "").slice(0, 1_200)}`;
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
}): Promise<PackedHistory> {
  const user = { role: "user" as const, content: input.userMessage };
  const plan = planCompact({
    system: input.system,
    history: input.history,
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
    summary = await summarizeOld({
      old: plan.old,
      previous: input.checkpoint?.summary,
      dataDir: input.dataDir,
      env: input.env,
      prefer: input.prefer,
    });
    checkpoint = {
      throughId: lastId(plan.old),
      summary,
      updatedAt: new Date().toISOString(),
      messageCount: plan.old.length,
    };
  }

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
