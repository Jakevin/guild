import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseSkillMarkdown } from "./skill-import.ts";

export type HostSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
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
  { id: "claude", name: "Claude", dirs: [".claude/skills"] },
  { id: "codex", name: "Codex", dirs: [".codex/skills", ".agents/skills"] },
  { id: "pi", name: "Pi", dirs: [".pi/agent/skills", ".pi/skills"] },
  { id: "grok", name: "Grok", dirs: [".grok/skills", ".grok/bundled/skills"] },
  { id: "cursor", name: "Cursor", dirs: [".cursor/skills", ".cursor/skills-cursor"] },
  { id: "dsh", name: "DSH", dirs: [".dsh/skills"] },
];

const BODY_CAP = 80_000;
const LIST_CAP = 400;

function skillFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  const found: string[] = [];
  const direct = join(dir, "SKILL.md");
  try {
    if (existsSync(direct) && statSync(direct).isFile()) found.push(direct);
  } catch {
    /* skip */
  }
  let entries: { name: string; isDirectory: () => boolean }[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      const skill = join(dir, entry.name, "SKILL.md");
      try {
        if (existsSync(skill) && statSync(skill).isFile()) found.push(skill);
      } catch {
        /* skip */
      }
      continue;
    }
    if (entry.isFile() && /\.md$/i.test(entry.name) && entry.name.toLowerCase() !== "skill.md") {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function readSkill(file: string, tool: HostTool, home: string): HostSkill | null {
  try {
    const raw = readFileSync(file, "utf8");
    const fileName = basename(file);
    const isBundle = fileName.toLowerCase() === "skill.md";
    const slug = isBundle
      ? basename(dirname(file))
      : fileName.replace(/\.md$/i, "");
    const parsed = parseSkillMarkdown(raw, slug);
    const st = statSync(file);
    const rel = file.startsWith(home)
      ? `~${file.slice(home.length)}`
      : file;
    const body = parsed.body.length > BODY_CAP
      ? parsed.body.slice(0, BODY_CAP)
      : parsed.body;
    return {
      id: `host:${tool.id}:${slug}`,
      slug,
      name: parsed.name || slug,
      description: parsed.description || "",
      body,
      source: "host",
      host: tool.id,
      hostName: tool.name,
      path: rel,
      tags: [tool.id],
      createdAt: st.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

export function listHostSkills(opts?: {
  home?: string;
  cwd?: string;
  includeBody?: boolean;
}): HostSkill[] {
  const home = opts?.home || homedir();
  const cwd = opts?.cwd || process.cwd();
  const includeBody = opts?.includeBody !== false;
  const seen = new Set<string>();
  const out: HostSkill[] = [];
  for (const tool of HOST_TOOLS) {
    const dirs = tool.dirs.flatMap((rel) => [join(home, rel), join(cwd, rel)]);
    for (const dir of dirs) {
      for (const file of skillFilesIn(dir)) {
        let key = file;
        try {
          key = realpathSync(file);
        } catch {
          /* keep file */
        }
        if (seen.has(key)) continue;
        const item = readSkill(file, tool, home);
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

export function hostSkillTools(): { id: string; name: string }[] {
  return HOST_TOOLS.map((tool) => ({ id: tool.id, name: tool.name }));
}
