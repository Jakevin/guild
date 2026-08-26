import type { ChatMessage } from "@guild/protocol";
import type { ToolTrace } from "./tools.ts";

export type TrajectoryKind =
  | "system"
  | "user"
  | "context"
  | "model"
  | "thinking"
  | "tool"
  | "skill"
  | "assistant";

export type TrajectoryEvent = {
  seq: number;
  ts: string;
  turnId: string;
  botId?: string;
  kind: TrajectoryKind;
  summary: string;
  payload?: unknown;
  result?: string;
  durationMs?: number;
  isError?: boolean;
};

export type TrajectoryDraft = Omit<TrajectoryEvent, "seq">;

const CLIP = 140;
const FIELD_CAP = 32_000;

export function clip(text: string, n = CLIP): string {
  const one = String(text || "").replace(/\s+/g, " ").trim();
  if (one.length <= n) return one;
  return one.slice(0, n - 1) + "…";
}

function cap(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > FIELD_CAP ? value.slice(0, FIELD_CAP) : value;
  }
  try {
    const raw = JSON.stringify(value);
    if (raw && raw.length > FIELD_CAP) return raw.slice(0, FIELD_CAP);
  } catch {
    /* ignore */
  }
  return value;
}

export function userTrajectoryEvent(
  messageId: string,
  body: string,
  ts = new Date().toISOString(),
): TrajectoryDraft {
  return {
    ts,
    turnId: messageId,
    kind: "user",
    summary: clip(body),
    payload: { body },
  };
}

export function turnTrajectoryEvents(input: {
  turnId: string;
  botId: string;
  ts?: string;
  system?: string;
  channelMd?: string;
  model?: { provider: string; model: string } | null;
  thinking?: string;
  traces?: ToolTrace[];
  text: string;
  source?: string;
}): TrajectoryDraft[] {
  const ts = input.ts || new Date().toISOString();
  const { turnId, botId } = input;
  const events: TrajectoryDraft[] = [];
  const modelLabel = input.model
    ? `${input.model.provider} / ${input.model.model}`
    : input.source === "local"
      ? "local"
      : "";
  if (modelLabel) {
    events.push({
      ts,
      turnId,
      botId,
      kind: "model",
      summary: modelLabel,
      payload: input.model ?? { source: "local" },
    });
  }
  if (input.system) {
    events.push({
      ts,
      turnId,
      botId,
      kind: "system",
      summary: clip(input.system),
      payload: cap(input.system),
    });
  }
  if (input.channelMd?.trim()) {
    events.push({
      ts,
      turnId,
      botId,
      kind: "context",
      summary: "Channel.md",
      payload: cap(input.channelMd),
    });
  }
  if (input.thinking?.trim()) {
    events.push({
      ts,
      turnId,
      botId,
      kind: "thinking",
      summary: clip(input.thinking),
      result: String(cap(input.thinking)),
    });
  }
  for (const trace of input.traces ?? []) {
    if (trace.name === "skill") {
      const name = String(trace.args.name ?? "skill");
      events.push({
        ts,
        turnId,
        botId,
        kind: "skill",
        summary: name,
        payload: cap(trace.args),
        result: String(cap(trace.text ?? "")),
        isError: trace.isError,
      });
      continue;
    }
    const detail =
      trace.name === "run"
        ? String(trace.args.command ?? "")
        : String(trace.args.path ?? trace.name);
    events.push({
      ts,
      turnId,
      botId,
      kind: "tool",
      summary: clip(`${trace.name} ${detail}`),
      payload: cap({ name: trace.name, args: trace.args }),
      result: String(cap(trace.text ?? "")),
      isError: trace.isError,
    });
  }
  events.push({
    ts,
    turnId,
    botId,
    kind: "assistant",
    summary: clip(input.text),
    result: String(cap(input.text)),
  });
  return events;
}

export function synthesizeTrajectory(messages: ChatMessage[]): TrajectoryEvent[] {
  const events: TrajectoryEvent[] = [];
  let seq = 0;
  for (const msg of messages) {
    const ts = msg.createdAt;
    const turnId = `derived-${msg.id}`;
    if (msg.author === "you") {
      events.push({
        seq: seq++,
        ts,
        turnId,
        kind: "user",
        summary: clip(msg.body),
        payload: { body: msg.body },
      });
      continue;
    }
    const parts = msg.parts?.length
      ? msg.parts
      : [{ type: "text" as const, text: msg.body }];
    for (const part of parts) {
      if (part.type === "thinking") {
        events.push({
          seq: seq++,
          ts,
          turnId,
          botId: msg.author,
          kind: "thinking",
          summary: clip(part.text),
          result: part.text,
        });
        continue;
      }
      if (part.type === "skill") {
        events.push({
          seq: seq++,
          ts,
          turnId,
          botId: msg.author,
          kind: "skill",
          summary: part.name,
          payload: { name: part.name },
          result: part.output || "",
        });
        continue;
      }
      if (part.type === "tool") {
        events.push({
          seq: seq++,
          ts,
          turnId,
          botId: msg.author,
          kind: "tool",
          summary: clip(`${part.name} ${part.detail}`),
          payload: { name: part.name, detail: part.detail },
          result: part.output,
          isError: part.isError,
        });
        continue;
      }
      events.push({
        seq: seq++,
        ts,
        turnId,
        botId: msg.author,
        kind: "assistant",
        summary: clip(part.text),
        result: part.text,
      });
    }
  }
  return events;
}
