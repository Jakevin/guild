/**
 * Command Code `/alpha/generate` fallback (Pi dual-transport).
 * Used when Provider API returns 403 upgrade_required (Go accounts).
 * Stream idle is Codex-style; user Stop is the interrupt.
 */
import { homedir } from "node:os";
import type { ChatUsage } from "@guild/protocol";
import {
  STREAM_IDLE_TIMEOUT_MS,
  StreamIdleError,
  startStreamIdle,
} from "./oauth.ts";
import { runAgentLoop } from "./harness.ts";
import {
  COMMANDCODE_API_BASE,
  commandCodeRequestHeaders,
  parseCommandCodeStreamLine,
  projectSlugFromPath,
  readGenerateRound,
  type GenerateCall,
} from "./commandcode.ts";
import {
  emitProgress,
  openaiTools,
  throwIfAborted,
  TOOL_LOOP_WRAP,
  type ToolContext,
  type ToolTrace,
} from "./tools.ts";
import { estimateSendTokens, trimSendMessages } from "./send-budget.ts";
import { addUsage, blankUsage, withDuration } from "./usage.ts";

export type CommandCodeGenerateResult = {
  text: string;
  traces: ToolTrace[];
  thinking: string;
  usage?: ChatUsage;
};

type CcMessage = Record<string, unknown>;

type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolsToCc(ctx: ToolContext): unknown[] {
  return openaiTools(ctx.skills ?? [], ctx).map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

function historyToCc(
  messages: { role: "user" | "assistant"; content: string }[],
): CcMessage[] {
  return messages.map((item) => ({
    role: item.role,
    content: item.content,
  }));
}

function assistantToolMessage(calls: GenerateCall[]): CcMessage {
  return {
    role: "assistant",
    content: calls.map((call) => ({
      type: "tool-call",
      toolCallId: call.id,
      toolName: call.name,
      input: call.args,
    })),
  };
}

function toolResultMessage(calls: GenerateCall[], texts: string[]): CcMessage {
  return {
    role: "tool",
    content: calls.map((call, i) => ({
      type: "tool-result",
      toolCallId: call.id,
      toolName: call.name,
      output: { type: "text", value: texts[i] ?? "" },
    })),
  };
}

/** Go `/alpha/generate` workspace block. `date` is required (YYYY-MM-DD), same as official cmd. */
export function commandCodeGenerateConfig(
  workingDir: string,
  now = Date.now(),
): Record<string, unknown> {
  return {
    workingDir,
    date: new Date(now).toISOString().slice(0, 10),
    environment: `${process.platform}-${process.arch}, Node.js ${process.version}`,
    structure: [],
    isGitRepo: false,
    currentBranch: "",
    mainBranch: "",
    gitStatus: "",
    recentCommits: [],
  };
}

async function readGenerateStream(
  response: Response,
  idle: ReturnType<typeof startStreamIdle>,
): Promise<ReturnType<typeof readGenerateRound>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  const events: unknown[] = [];
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      idle.bump();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseCommandCodeStreamLine(line);
        if (!event) continue;
        events.push(event);
        if (isRecord(event) && event.type === "finish") finished = true;
        if (isRecord(event) && event.type === "error") {
          const message =
            (isRecord(event.error) && typeof event.error.message === "string"
              ? event.error.message
              : typeof event.message === "string"
                ? event.message
                : "Stream error");
          throw new Error(message);
        }
      }
      if (finished) break;
    }
    if (buffer.trim()) {
      const event = parseCommandCodeStreamLine(buffer);
      if (event) events.push(event);
    }
  } catch (error) {
    if (idle.timedOut()) throw new StreamIdleError(STREAM_IDLE_TIMEOUT_MS);
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (idle.timedOut()) throw new StreamIdleError(STREAM_IDLE_TIMEOUT_MS);
  return readGenerateRound(events);
}

export async function completeCommandCodeGenerate(input: {
  apiKey: string;
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  temperature: number;
  tools: boolean;
  ctx: ToolContext;
  effort?: string;
  cwd?: string;
  apiBase?: string;
  fetchImpl?: FetchLike;
}): Promise<CommandCodeGenerateResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBase = (input.apiBase ?? COMMANDCODE_API_BASE).replace(/\/+$/, "");
  const workingDir = input.cwd ?? homedir();
  const ccMessages = historyToCc(input.messages);
  const traces: ToolTrace[] = [];
  const thinkingChunks: string[] = [];
  const usage = blankUsage();
  const started = Date.now();
  const catalog = input.tools ? toolsToCc(input.ctx) : [];

  const looped = await runAgentLoop({
    toolCtx: input.ctx,
    traces,
    thinkingChunks,
    nullIfNoTraces: true,
    ask: async ({ wrap, steer }) => {
      throwIfAborted(input.ctx);
      if (wrap) ccMessages.push({ role: "user", content: TOOL_LOOP_WRAP });
      if (steer) ccMessages.push({ role: "user", content: steer });
      const extra = estimateSendTokens(input.system) + 2048;
      const fitted = trimSendMessages(
        ccMessages.map((row) => ({
          role: row.role === "assistant" ? "assistant" : "user",
          content: typeof row.content === "string" ? row.content : JSON.stringify(row.content),
        })),
        extra,
      );
      if (fitted.length < ccMessages.length) {
        ccMessages.length = 0;
        ccMessages.push(...fitted);
      }
      const body = {
        config: commandCodeGenerateConfig(workingDir),
        memory: null,
        taste: null,
        skills: null,
        params: {
          model: input.model,
          messages: ccMessages,
          tools: catalog,
          system: input.system,
          max_tokens: 64_000,
          stream: true,
          temperature: input.temperature,
          ...(input.effort && input.effort !== "none" ? { reasoning_effort: input.effort } : {}),
        },
        threadId: crypto.randomUUID(),
      };
      const idle = startStreamIdle(STREAM_IDLE_TIMEOUT_MS, input.ctx.signal);
      try {
        const response = await fetchImpl(`${apiBase}/alpha/generate`, {
          method: "POST",
          headers: {
            ...commandCodeRequestHeaders(input.apiKey, {
              "x-project-slug": projectSlugFromPath(workingDir),
              "x-taste-learning": "true",
            }),
          },
          body: JSON.stringify(body),
          signal: idle.signal,
        });
        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          throw new Error(`Command Code API error ${response.status}: ${errBody.slice(0, 240)}`);
        }
        const round = await readGenerateStream(response, idle);
        if (round.thinking) thinkingChunks.push(round.thinking);
        addUsage(usage, {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
        });
        return {
          calls: round.calls.map((call) => ({
            id: call.id,
            name: call.name,
            args: call.args,
          })),
          text: round.text,
          thinking: round.thinking,
        };
      } finally {
        idle.dispose();
      }
    },
    onTools: (calls, outcomes) => {
      const mapped: GenerateCall[] = calls.map((call) => ({
        id: call.id,
        name: call.name,
        args: call.args,
      }));
      ccMessages.push(assistantToolMessage(mapped));
      ccMessages.push(toolResultMessage(mapped, outcomes.map((row) => row?.text ?? "")));
    },
  });
  if (!looped) return { text: "", traces, thinking: thinkingChunks.join("\n\n") };
  emitProgress(input.ctx, traces, looped.thinking);
  return {
    text: looped.text,
    traces: looped.traces,
    thinking: looped.thinking,
    usage: withDuration(usage, started),
  };
}
