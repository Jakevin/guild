import { parseAgentFile } from "./agent-file.ts";
import { listHostAgents, type HostAgent } from "./host-agents.ts";
import type { LibraryItem } from "@guild/protocol";
import {
  hostContext,
  type SubAgentRef,
  type ToolContext,
  type ToolOutcome,
} from "./tools.ts";

const OUTPUT_CAP = 16_000;
const DEFAULT_WORKER: SubAgentRef = {
  name: "worker",
  slug: "worker",
  description: "Implementation executor. Smallest correct change, then verify.",
  instructions:
    "Role: implementation executor. Make the smallest correct change. Verify before claiming done. Stay inside the assignment.",
  readOnly: false,
};

export function refFromLibrary(item: LibraryItem): SubAgentRef {
  const parsed = parseAgentFile(item.body, item.slug || item.name);
  return {
    name: item.name || parsed.name,
    slug: item.slug || parsed.name,
    description: item.description || parsed.description,
    instructions: parsed.instructions || item.body,
    readOnly: parsed.readOnly,
    source: item.source === "catalog" ? "catalog" : "user",
  };
}

export function refFromHost(item: HostAgent): SubAgentRef {
  return {
    name: item.name,
    slug: item.slug,
    description: item.description,
    instructions: item.instructions,
    readOnly: item.readOnly,
    path: item.path,
    source: "host",
  };
}

export function mergeSpawnRefs(
  guild: SubAgentRef[],
  host: SubAgentRef[],
): SubAgentRef[] {
  const user = guild.filter((item) => item.source === "user");
  const catalog = guild.filter((item) => item.source !== "user");
  const seen = new Set<string>();
  const out: SubAgentRef[] = [];
  for (const item of [...user, ...host, ...catalog]) {
    const key = item.slug.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function listSpawnRefs(guildItems: LibraryItem[]): SubAgentRef[] {
  return mergeSpawnRefs(
    guildItems.map(refFromLibrary),
    listHostAgents().map(refFromHost),
  );
}

function agentKey(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

export function resolveSubagent(
  name: string,
  agents: SubAgentRef[],
): SubAgentRef {
  const want = agentKey(name || "worker");
  const hit = agents.find(
    (item) => agentKey(item.name) === want || agentKey(item.slug) === want,
  );
  if (hit) return hit;
  if (!name.trim() || want === "worker" || want === "default") return DEFAULT_WORKER;
  return {
    ...DEFAULT_WORKER,
    name: name.trim() || DEFAULT_WORKER.name,
    instructions: `${DEFAULT_WORKER.instructions}\n\nThe caller asked for agent "${name.trim()}". No matching library entry; work as a general worker.`,
  };
}

const CHILD_TOOLS = `You ARE already running on the user's local computer (Guild).
Tools: run, read, write, list, skill, image_gen. You cannot spawn subagents.
Never say you cannot access this machine. Check [exit code: N] on every run.`;

const CHILD_TOOLS_RO = `You ARE already running on the user's local computer (Guild).
Tools: run, read, list, skill. You cannot write files and cannot spawn subagents.
Read-only. Never edit, patch, or create files. Check [exit code: N] on every run.`;

export async function spawnSubagent(input: {
  prompt: string;
  name?: string;
  description?: string;
  ctx: ToolContext;
}): Promise<ToolOutcome> {
  if ((input.ctx.spawnDepth ?? 0) >= 1) {
    return {
      text: "subagents cannot spawn subagents (depth 1, same as Grok)",
      isError: true,
    };
  }
  const prompt = input.prompt.trim();
  if (!prompt) return { text: "spawn needs a prompt", isError: true };
  const dataDir = input.ctx.dataDir;
  if (!dataDir) return { text: "spawn needs a dataDir", isError: true };
  const agents = input.ctx.subagents?.length
    ? input.ctx.subagents
    : listSpawnRefs([]);
  const agent = resolveSubagent(input.name || "worker", agents);
  const { llmComplete } = await import("./llm.ts");
  const label = (input.description || agent.name).trim();
  const system = [
    agent.instructions,
    hostContext(),
    agent.readOnly ? CHILD_TOOLS_RO : CHILD_TOOLS,
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await llmComplete({
    dataDir,
    env: input.ctx.env,
    system,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    role: "chat",
    tools: true,
    skills: input.ctx.skills,
    toolCtx: {
      skills: input.ctx.skills,
      subagents: agents,
      dataDir,
      env: input.ctx.env,
      spawnDepth: 1,
      allowWrite: !agent.readOnly,
    },
  });
  if (!result) {
    return { text: "subagent had no model available", isError: true };
  }
  const body = result.text.trim() || "(empty)";
  const clipped =
    body.length > OUTPUT_CAP ? `${body.slice(0, OUTPUT_CAP)}\n… truncated …` : body;
  return {
    text: `# ${label}\nagent: ${agent.name}${agent.readOnly ? " · read-only" : ""}\nmodel: ${result.model}\n\n${clipped}`,
    isError: false,
  };
}
