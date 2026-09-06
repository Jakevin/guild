import type { ChatPart } from "@guild/protocol";
import type { ToolTrace } from "./tools.ts";

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
              : String(trace.args.path ?? ""),
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
