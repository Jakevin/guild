import type { ChatPart } from "@guild/protocol";
import type { ToolTrace } from "./tools.ts";

export function stripModelDump(text: string): string {
  return String(text || "")
    .replace(/<skill_content\b[\s\S]*?<\/skill_content>/gi, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<available_skills>[\s\S]*?<\/available_skills>/gi, "")
    .trim();
}

export function assembleParts(input: {
  thinking?: string;
  traces?: ToolTrace[];
  text?: string;
}): ChatPart[] {
  const parts: ChatPart[] = [];
  const thinking = input.thinking?.trim();
  if (thinking) parts.push({ type: "thinking", text: thinking });
  for (const trace of input.traces ?? []) {
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
  const text = stripModelDump(input.text ?? "");
  if (text) parts.push({ type: "text", text });
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
