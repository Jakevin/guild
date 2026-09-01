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
  | "spawn"
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
  /** In-progress turn; not persisted. */
  live?: boolean;
};

export type TrajectoryDraft = Omit<TrajectoryEvent, "seq">;

const CLIP = 140;
const FIELD_CAP = 32_000;

export function clip(text: string, n = CLIP): string {
  const one = String(text || "").replace(/\s+/g, " ").trim();
  if (one.length <= n) return one;
  return one.slice(0, n - 1) + "…";
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Old rows logged spawn as TOOL "spawn spawn". Present them as spawn. */
export function promoteSpawnEvent<T extends { kind: string; summary: string; payload?: unknown }>(
  event: T,
): T & { kind: TrajectoryKind; summary: string } {
  if (event.kind === "spawn") return event as T & { kind: TrajectoryKind; summary: string };
  const payload = recordOf(event.payload);
  const toolName = String(payload?.name || "");
  const looksSpawn =
    event.kind === "tool" &&
    (toolName === "spawn" ||
      toolName === "read_spawn" ||
      /^\s*spawn(\s+spawn)?\s*$/i.test(event.summary || ""));
  if (!looksSpawn) return event as T & { kind: TrajectoryKind; summary: string };
  const args = recordOf(payload?.args) || payload || {};
  if (toolName === "read_spawn") {
    const waitId = String(args.agent_id || args.id || "").trim();
    return {
      ...event,
      kind: "spawn",
      summary: clip(`read ${waitId}`),
    };
  }
  const agent = String(args.name || args.profile || "worker").trim() || "worker";
  const label = String(args.title || args.description || "")
    .replace(/\s+/g, " ")
    .trim();
  const prompt = String(args.prompt || args.task || "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    ...event,
    kind: "spawn",
    summary: clip(
      `${agent}${label ? " · " + label : ""}${prompt ? " — " + prompt : ""}`,
    ),
  };
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
        summary: `${name}${trace.running ? " …" : ""}`,
        payload: cap(trace.args),
        result: String(cap(trace.text ?? "")),
        isError: trace.isError,
      });
      continue;
    }
    if (trace.name === "spawn" || trace.name === "read_spawn") {
      const agent =
        String(
          trace.args.profile ||
            trace.args.name ||
            trace.args.agent ||
            "worker",
        ).trim() || "worker";
      const label = String(trace.args.title || trace.args.description || "")
        .replace(/\s+/g, " ")
        .trim();
      const prompt = String(trace.args.prompt || trace.args.task || "")
        .replace(/\s+/g, " ")
        .trim();
      const bg =
        trace.args.background === true || trace.args.is_background === true
          ? " (bg)"
          : "";
      const waitId = String(trace.args.agent_id || trace.args.id || "").trim();
      events.push({
        ts,
        turnId,
        botId,
        kind: "spawn",
        summary: clip(
          trace.name === "read_spawn"
            ? `read ${waitId || agent}${trace.running ? " …" : ""}`
            : `${agent}${bg}${label ? " · " + label : ""}${prompt ? " — " + prompt : ""}${trace.running ? " …" : ""}`,
        ),
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
      summary: clip(`${trace.name} ${detail}${trace.running ? " …" : ""}`),
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

export function liveTrajectoryEvents(input: {
  botId: string;
  thinking?: string;
  traces?: Array<{
    name: string;
    args?: Record<string, unknown>;
    text?: string;
    isError?: boolean;
    running?: boolean;
  }>;
  startedAt?: string;
}): TrajectoryDraft[] {
  const traces: ToolTrace[] = (input.traces ?? []).map((tr) => ({
    name: tr.name,
    args: tr.args ?? {},
    text: tr.text ?? "",
    isError: Boolean(tr.isError),
    running: tr.running,
  }));
  const events = turnTrajectoryEvents({
    turnId: `live-${input.botId}`,
    botId: input.botId,
    ts: input.startedAt,
    thinking: input.thinking,
    traces,
    text: "",
  }).filter((event) => event.kind !== "assistant");
  return events.map((event) => ({ ...event, live: true }));
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
        const spawnish = part.name === "spawn" || part.name === "read_spawn";
        events.push({
          seq: seq++,
          ts,
          turnId,
          botId: msg.author,
          kind: spawnish ? "spawn" : "tool",
          summary: clip(
            part.name === "read_spawn"
              ? `read ${part.detail || ""}`
              : part.name === "spawn"
                ? part.detail || part.label || "spawn"
                : `${part.name} ${part.detail}`,
          ),
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
