import type { ChatPart } from "@guild/protocol";
import type { ToolTrace } from "./tools.ts";

const DETAIL_CAP = 400;
const WRITE_BODY_CAP = 500;

function argText(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function oneLine(text: string, cap = DETAIL_CAP): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= cap) return flat;
  return `${flat.slice(0, cap - 1)}…`;
}

export function toolArgDetail(
  name: string,
  args: Record<string, unknown> | undefined,
  opts?: { writeBody?: boolean },
): string {
  const rec = args || {};
  if (name === "browser") {
    return oneLine(
      [argText(rec, "action"), argText(rec, "url") || argText(rec, "ref"), argText(rec, "text")]
        .filter(Boolean)
        .join(" "),
    );
  }
  if (name === "computer") {
    return oneLine(
      [
        argText(rec, "action"),
        argText(rec, "app") || argText(rec, "query") || argText(rec, "window") || argText(rec, "ref"),
        argText(rec, "text"),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  if (name === "cronjob") {
    const head = [argText(rec, "action"), argText(rec, "name") || argText(rec, "schedule")]
      .filter(Boolean)
      .join(" ");
    const prompt = argText(rec, "prompt");
    const clip =
      prompt.length > WRITE_BODY_CAP ? `${prompt.slice(0, WRITE_BODY_CAP)}…` : prompt;
    return [oneLine(head, 80), clip].filter(Boolean).join(clip ? "\n" : "");
  }
  if (name === "write") {
    const path = argText(rec, "path");
    if (!opts?.writeBody) return path;
    const content = argText(rec, "content");
    if (!content) return path;
    const body =
      content.length > WRITE_BODY_CAP ? `${content.slice(0, WRITE_BODY_CAP)}…` : content;
    return path ? `${path}\n${body}` : body;
  }
  return "";
}

export function stripModelDump(text: string): string {
  return String(text || "")
    .replace(/<skill_content\b[\s\S]*?<\/skill_content>/gi, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<available_skills>[\s\S]*?<\/available_skills>/gi, "")
    .trim();
}

function traceParts(traces: ToolTrace[]): ChatPart[] {
  const parts: ChatPart[] = [];
  for (const trace of traces) {
    if (trace.name === "skill") {
      parts.push({
        type: "skill",
        name: String(trace.args.name ?? "").trim() || "skill",
        output: trace.text,
      });
      continue;
    }
    const label =
      trace.name === "run" && typeof trace.args.description === "string"
        ? trace.args.description.trim()
        : "";
    parts.push({
      type: "tool",
      name: trace.name,
      detail:
        trace.name === "run"
          ? String(trace.args.command ?? "")
          : trace.name === "image_gen"
            ? String(trace.args.prompt ?? "")
            : trace.name === "tts"
              ? String(trace.args.text ?? "")
              : trace.name === "spawn"
              ? String(
                  trace.args.title ||
                    trace.args.description ||
                    trace.args.profile ||
                    trace.args.name ||
                    trace.args.task ||
                    trace.args.prompt ||
                    "",
                )
              : trace.name === "read_spawn"
                ? String(trace.args.agent_id || trace.args.id || "")
              : toolArgDetail(trace.name, trace.args, { writeBody: true }) ||
                String(trace.args.path ?? ""),
      output: trace.text,
      isError: trace.isError,
      ...(label ? { label } : {}),
    });
  }
  return parts;
}

export function assembleParts(input: {
  thinking?: string;
  traces?: ToolTrace[];
  text?: string;
  /** Recap / tool / recap order from the loop. Falls back to traces-then-text. */
  beats?: Array<{ text?: string; traces?: ToolTrace[] }>;
}): ChatPart[] {
  const parts: ChatPart[] = [];
  const thinking = input.thinking?.trim();
  if (thinking) parts.push({ type: "thinking", text: thinking });
  const pushText = (raw?: string) => {
    const text = stripModelDump(raw ?? "");
    if (text) parts.push({ type: "text", text });
  };
  if (input.beats?.length) {
    for (const beat of input.beats) {
      pushText(beat.text);
      if (beat.traces?.length) parts.push(...traceParts(beat.traces));
    }
    if (!parts.some((part) => part.type === "text")) pushText(input.text);
  } else {
    parts.push(...traceParts(input.traces ?? []));
    pushText(input.text);
  }
  return parts;
}

export function bodyFromParts(parts: ChatPart[], fallback = "…"): string {
  const text = parts
    .filter((part): part is Extract<ChatPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  return stripModelDump(text) || fallback;
}
