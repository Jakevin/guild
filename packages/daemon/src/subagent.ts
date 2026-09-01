import { randomUUID } from "node:crypto";
import { parseAgentFile } from "./agent-file.ts";
import { listHostAgents, type HostAgent } from "./host-agents.ts";
import type { LibraryItem } from "@guild/protocol";
import { parseSandbox, type Sandbox } from "./harness.ts";
import {
  hostContext,
  type SpawnHandle,
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

/** Parent read_only cannot escalate via spawn. Explorer from full_access keeps run. */
export function childSpawnPolicy(
  parentSandbox: ToolContext["sandbox"],
  agentReadOnly: boolean,
): { sandbox: Sandbox; allowWrite: boolean } {
  const parent = parseSandbox(parentSandbox);
  if (parent === "read_only") {
    return { sandbox: "read_only", allowWrite: false };
  }
  return { sandbox: parent, allowWrite: !agentReadOnly };
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
Never say you cannot access this machine. Check [exit code: N] on every run.
Independent searches: emit multiple tool calls in one round; they run in parallel.`;

const CHILD_TOOLS_RO = `You ARE already running on the user's local computer (Guild).
Tools: run, read, list, skill. You cannot write files and cannot spawn subagents.
Read-only. Never edit, patch, or create files. Check [exit code: N] on every run.
Independent searches: emit multiple tool calls in one round; they run in parallel.`;

export const SPAWN_MAX_PARALLEL = 8;
export const SPAWN_CONCURRENCY = 4;

export type SpawnJob = {
  prompt: string;
  name: string;
  description: string;
};

/** Devin luna-explore / Pi scout → Guild explorer. */
export function spawnProfile(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return "";
  if (key === "luna-explore" || key === "explore" || key === "scout") {
    return "explorer";
  }
  if (key === "luna-general" || key === "general") return "worker";
  if (key === "luna-reviewer") return "reviewer";
  return raw.trim();
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function flagTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function flagFalse(value: unknown): boolean {
  return value === false || value === "false";
}

function oneJob(raw: Record<string, unknown>): SpawnJob {
  const prompt = String(raw.prompt || raw.task || "").trim();
  const name = spawnProfile(
    String(raw.profile || raw.name || raw.agent || raw.subagent_type || ""),
  );
  const description = String(raw.title || raw.description || "").trim();
  return { prompt, name, description };
}

function handlesOf(ctx: ToolContext) {
  if (!ctx.spawnHandles) ctx.spawnHandles = new Map();
  return ctx.spawnHandles;
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name: string }).name === "AbortError",
  );
}

function startBackground(job: SpawnJob, ctx: ToolContext) {
  const id = randomUUID();
  const title = job.description || job.name || "worker";
  const profile = job.name || "worker";
  const abort = new AbortController();
  const parent = ctx.signal;
  if (parent) {
    if (parent.aborted) abort.abort();
    else parent.addEventListener("abort", () => abort.abort(), { once: true });
  }
  const childCtx: ToolContext = {
    ...ctx,
    signal: abort.signal,
    spawnHandles: undefined,
  };
  const handle: SpawnHandle = {
    id,
    title,
    profile,
    abort,
    done: Promise.resolve({ text: "", isError: false }),
  };
  handle.done = spawnSubagent({ ...job, ctx: childCtx })
    .then((outcome) => {
      handle.outcome = outcome;
      return outcome;
    })
    .catch((error: unknown) => {
      const outcome: ToolOutcome = {
        text:
          isAbortError(error) || abort.signal.aborted
            ? "aborted"
            : error instanceof Error
              ? error.message
              : String(error),
        isError: true,
      };
      handle.outcome = outcome;
      return outcome;
    });
  handlesOf(ctx).set(id, handle);
  return handle;
}

function ackBackground(
  rows: { id: string; title: string; profile: string }[],
): string {
  return rows
    .map(
      (row) =>
        `agent_id: ${row.id}\ntitle: ${row.title}\nprofile: ${row.profile}\nstatus: running\nCall read_spawn with this agent_id (block=true) before the final reply.`,
    )
    .join("\n\n");
}

/** Pi subagent: single {prompt|task, name|agent} or parallel tasks[]. */
export function spawnJobs(args: Record<string, unknown>): SpawnJob[] {
  if (Array.isArray(args.tasks) && args.tasks.length) {
    return args.tasks.map((item) => oneJob(recordOf(item) || {}));
  }
  return [oneJob(args)];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export async function runSpawnJobs(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const jobs = spawnJobs(args);
  if (!jobs.length || jobs.some((job) => !job.prompt)) {
    return { text: "spawn needs a prompt or task", isError: true };
  }
  if (jobs.length > SPAWN_MAX_PARALLEL) {
    return {
      text: `Too many parallel tasks (${jobs.length}). Max is ${SPAWN_MAX_PARALLEL}.`,
      isError: true,
    };
  }
  const background = flagTrue(args.background) || flagTrue(args.is_background);
  if (background) {
    const started = jobs.map((job) => startBackground(job, ctx));
    return { text: ackBackground(started), isError: false };
  }
  if (jobs.length === 1) {
    return spawnSubagent({ ...jobs[0], ctx });
  }
  const results = await mapWithConcurrency(jobs, SPAWN_CONCURRENCY, (job) =>
    spawnSubagent({ ...job, ctx }),
  );
  const failed = results.filter((row) => row.isError).length;
  const body = results
    .map((row, i) => {
      const label = jobs[i].description || jobs[i].name || "worker";
      const status = row.isError ? "failed" : "completed";
      return `### [${label}] ${status}\n\n${row.text}`;
    })
    .join("\n\n---\n\n");
  return {
    text: `Parallel: ${results.length - failed}/${results.length} succeeded\n\n${body}`,
    isError: failed === results.length,
  };
}

export async function readSpawn(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const id = String(args.agent_id || args.id || "").trim();
  if (!id) return { text: "read_spawn needs agent_id", isError: true };
  const handle = handlesOf(ctx).get(id);
  if (!handle) {
    return {
      text: `unknown agent_id ${id}. It must come from a background spawn in this turn.`,
      isError: true,
    };
  }
  if (flagFalse(args.block) && !handle.outcome) {
    return {
      text: `agent_id: ${handle.id}\ntitle: ${handle.title}\nprofile: ${handle.profile}\nstatus: running`,
      isError: false,
    };
  }
  const outcome = await handle.done;
  return {
    text: `# ${handle.title}\nagent_id: ${handle.id}\nprofile: ${handle.profile}\nstatus: ${
      outcome.isError ? "failed" : "completed"
    }\n\n${outcome.text}`,
    isError: outcome.isError,
  };
}

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
  const child = childSpawnPolicy(input.ctx.sandbox, agent.readOnly);
  const { llmComplete } = await import("./llm.ts");
  const label = (input.description || agent.name).trim();
  const system = [
    agent.instructions,
    hostContext(),
    child.allowWrite ? CHILD_TOOLS : CHILD_TOOLS_RO,
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await llmComplete({
    dataDir,
    env: input.ctx.env,
    system,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    role: "spawn",
    tools: true,
    skills: input.ctx.skills,
    toolCtx: {
      skills: input.ctx.skills,
      subagents: agents,
      dataDir,
      env: input.ctx.env,
      spawnDepth: 1,
      allowWrite: child.allowWrite,
      sandbox: child.sandbox,
      workspace: input.ctx.workspace,
      dispatch: input.ctx.dispatch,
      signal: input.ctx.signal,
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
