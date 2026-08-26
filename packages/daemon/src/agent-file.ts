import { parseSkillMarkdown } from "./skill-import.ts";

export type ParsedAgent = {
  name: string;
  description: string;
  instructions: string;
  model?: string;
  reasoning?: string;
  sandboxMode?: string;
  permissionMode?: string;
  readOnly: boolean;
};

const READ_ONLY_NAMES = new Set([
  "explorer",
  "explore",
  "plan",
  "librarian",
  "reviewer",
  "researcher",
]);

export function parseAgentFile(text: string, fallbackName = "agent"): ParsedAgent {
  const trimmed = String(text || "")
    .replace(/^\uFEFF/, "")
    .trim();
  const parsed = trimmed.startsWith("---")
    ? parseMarkdownAgent(trimmed, fallbackName)
    : parseTomlAgent(trimmed, fallbackName);
  return { ...parsed, readOnly: inferReadOnly(parsed) };
}

export function renderAgentToml(input: {
  name: string;
  description: string;
  instructions: string;
  readOnly?: boolean;
}): string {
  const name = input.name.trim() || "agent";
  const description = input.description.replace(/\n/g, " ").trim();
  const sandbox = input.readOnly ? 'sandbox_mode = "read-only"\n' : "";
  return (
    `name = "${escapeToml(name)}"\n` +
    `description = "${escapeToml(description)}"\n` +
    sandbox +
    `developer_instructions = """\n${input.instructions.trim()}\n"""\n`
  );
}

function parseMarkdownAgent(text: string, fallbackName: string): Omit<ParsedAgent, "readOnly"> {
  const parsed = parseSkillMarkdown(text, fallbackName);
  const fence = text.replace(/^\uFEFF/, "").match(
    /^---\r?\n([\s\S]*?)\r?\n---/,
  );
  const front = fence ? fence[1] : "";
  return {
    name: parsed.name || fallbackName,
    description: parsed.description || "",
    instructions: parsed.body.trim(),
    permissionMode: yamlBare(front, "permission_mode") || undefined,
    model: yamlBare(front, "model") || undefined,
    reasoning: yamlBare(front, "reasoning_effort") || undefined,
  };
}

function parseTomlAgent(text: string, fallbackName: string): Omit<ParsedAgent, "readOnly"> {
  const instructions =
    tomlString(text, "developer_instructions") ||
    tomlString(text, "instructions");
  return {
    name: tomlString(text, "name") || fallbackName,
    description: tomlString(text, "description"),
    instructions: instructions.trim(),
    model: tomlString(text, "model") || undefined,
    reasoning:
      tomlString(text, "model_reasoning_effort") ||
      tomlString(text, "reasoning_effort") ||
      undefined,
    sandboxMode: tomlString(text, "sandbox_mode") || undefined,
    permissionMode: tomlString(text, "permission_mode") || undefined,
  };
}

export function inferReadOnly(parsed: Omit<ParsedAgent, "readOnly">): boolean {
  const sandbox = (parsed.sandboxMode || "").toLowerCase();
  if (/\bread[-_ ]?only\b/.test(sandbox)) return true;
  if ((parsed.permissionMode || "").toLowerCase() === "plan") return true;
  const name = (parsed.name || "").toLowerCase();
  return READ_ONLY_NAMES.has(name);
}

function yamlBare(front: string, key: string): string {
  const line = front.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!line) return "";
  return line[1].trim().replace(/^["']|["']$/g, "");
}

function tomlString(source: string, key: string): string {
  const match = source.match(new RegExp(`(?:^|\\n)${key}\\s*=\\s*`));
  if (!match || match.index === undefined) return "";
  const rest = source.slice(match.index + match[0].length);
  if (rest.startsWith('"""')) {
    const end = rest.indexOf('"""', 3);
    if (end < 0) return rest.slice(3).trim();
    return rest.slice(3, end).replace(/^\n/, "").replace(/\s+$/, "");
  }
  if (rest.startsWith('"')) {
    const quoted = rest.match(/^"((?:\\.|[^"\\])*)"/);
    return quoted ? unquoteToml(quoted[1]) : "";
  }
  if (rest.startsWith("'")) {
    const quoted = rest.match(/^'([^']*)'/);
    return quoted ? quoted[1] : "";
  }
  const bare = rest.match(/^([^\s#\n]+)/);
  return bare ? bare[1] : "";
}

function unquoteToml(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function escapeToml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
