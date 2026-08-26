import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseAgentFile } from "./agent-file.ts";

export type HostAgent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  instructions: string;
  readOnly: boolean;
  model?: string;
  reasoning?: string;
  source: "host";
  host: string;
  hostName: string;
  path: string;
  tags: string[];
  createdAt: string;
};

type HostTool = {
  id: string;
  name: string;
  dirs: string[];
};

const HOST_TOOLS: HostTool[] = [
  { id: "codex", name: "Codex", dirs: [".codex/agents"] },
  { id: "grok", name: "Grok", dirs: [".grok/agents", ".grok/bundled/agents"] },
  { id: "claude", name: "Claude", dirs: [".claude/agents"] },
  { id: "cursor", name: "Cursor", dirs: [".cursor/agents"] },
];

const BODY_CAP = 80_000;
const LIST_CAP = 400;
const AGENT_FILE = /\.(toml|md)$/i;

function agentFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  let entries: { name: string; isFile: () => boolean; isDirectory: () => boolean }[] =
    [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) continue;
    if (entry.isFile() && AGENT_FILE.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function readAgent(file: string, tool: HostTool, home: string): HostAgent | null {
  try {
    const raw = readFileSync(file, "utf8");
    const slug = basename(file).replace(/\.(toml|md)$/i, "");
    const parsed = parseAgentFile(raw, slug);
    if (!parsed.instructions.trim()) return null;
    const st = statSync(file);
    const rel = file.startsWith(home) ? `~${file.slice(home.length)}` : file;
    const body = raw.length > BODY_CAP ? raw.slice(0, BODY_CAP) : raw;
    return {
      id: `host:${tool.id}:${slug}`,
      slug,
      name: parsed.name || slug,
      description: parsed.description || "",
      body,
      instructions: parsed.instructions,
      readOnly: parsed.readOnly,
      model: parsed.model,
      reasoning: parsed.reasoning,
      source: "host",
      host: tool.id,
      hostName: tool.name,
      path: rel,
      tags: [tool.id, ...(parsed.readOnly ? ["read-only"] : [])],
      createdAt: st.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

export function listHostAgents(opts?: {
  home?: string;
  cwd?: string;
  includeBody?: boolean;
}): HostAgent[] {
  const home = opts?.home || homedir();
  const cwd = opts?.cwd || process.cwd();
  const includeBody = opts?.includeBody !== false;
  const seen = new Set<string>();
  const out: HostAgent[] = [];
  for (const tool of HOST_TOOLS) {
    const dirs = tool.dirs.flatMap((rel) => [join(home, rel), join(cwd, rel)]);
    for (const dir of dirs) {
      for (const file of agentFilesIn(dir)) {
        let key = file;
        try {
          key = realpathSync(file);
        } catch {
          /* keep file */
        }
        if (seen.has(key)) continue;
        const item = readAgent(file, tool, home);
        if (!item) continue;
        if (!includeBody) item.body = "";
        seen.add(key);
        const clash = out.some((row) => row.id === item.id);
        if (clash) item.id = `${item.id}:${out.length}`;
        out.push(item);
        if (out.length >= LIST_CAP) return out;
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.hostName.localeCompare(b.hostName) || a.name.localeCompare(b.name),
  );
}

export function hostAgentTools(): { id: string; name: string }[] {
  return HOST_TOOLS.map((tool) => ({ id: tool.id, name: tool.name }));
}
