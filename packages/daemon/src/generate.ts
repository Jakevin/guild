import type { ChatPart, ChatUsage, ModelRef } from "@guild/protocol";
import { assembleParts, bodyFromParts } from "./chat-parts.ts";
import {
  packHistory,
  type CompactCheckpoint,
  type HistoryItem,
} from "./compact.ts";
import { MEMORY_INJECT_CAP } from "./memory.ts";
import { llmComplete } from "./llm.ts";
import { policyFor, type Sandbox } from "./harness.ts";
import { listMcpToolRefs, type McpToolRef } from "./mcp.ts";
import { CHANNEL_ROSTER_CAP, StoreError } from "./store.ts";
import {
  hostContext,
  TOOL_SYSTEM,
  type SkillRef,
  type SubAgentRef,
  type ToolContext,
  type ToolProgress,
  type ToolTrace,
} from "./tools.ts";

export type ChatReply = {
  body: string;
  parts: ChatPart[];
  source: "llm" | "local";
  system: string;
  thinking?: string;
  traces?: ToolTrace[];
  model?: { provider: string; model: string } | null;
  usage?: ChatUsage;
};

export type GenerateKind = "soul" | "agent" | "position" | "skill" | "subagent";

export type GeneratedMarkdown = {
  name: string;
  body: string;
  source: "llm" | "local";
};

const TITLES: Record<GenerateKind, string> = {
  soul: "SOUL.md",
  agent: "AGENTS.md",
  position: "POSITION.md",
  skill: "SKILL.md",
  subagent: "SUBAGENT.toml",
};

export function localGenerate(
  kind: GenerateKind,
  prompt: string,
): GeneratedMarkdown {
  const idea = prompt.trim();
  if (!idea) {
    throw new StoreError(400, "prompt is required");
  }
  const name = nameFromPrompt(idea);
  if (kind === "soul") {
    return {
      name,
      source: "local",
      body: `# ${name}\n\n${idea}\n\n## Voice\n- Speak in this stance: ${idea}\n- Be specific. No filler.\n\n## Values\n- Prefer truth over comfort.\n- Leave the workspace better than you found it.\n\n## Boundaries\n- Do not invent facts.\n- Ask before destructive actions.\n- Do not do another seat's job. Hand off with a spec.\n`,
    };
  }
  if (kind === "agent") {
    return {
      name,
      source: "local",
      body: `# ${name}\n\nOperating procedure for: ${idea}\n\n## Memory\n- Channel.md is the task. MEMORY.md is standing notes. Do not recap the whole thread.\n\n## Plan\n- One local directive: goal + done when + a short checklist. Revise it when evidence changes.\n\n## Act\n- Inspect the workspace, make the smallest change, verify, stop.\n- Work that belongs to another seat: line-start @handle with Goal / Done when / out of scope / files.\n\n## Skills\n- The catalog is availability, not a todo. Call \`skill\` only when this turn's directive matches.\n\n## Quality bar\n- No untested guesses.\n- Cite files you touched.\n- No status theater.\n`,
    };
  }
  if (kind === "skill") {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "skill";
    return {
      name,
      source: "local",
      body: `---\nname: ${slug}\ndescription: ${idea.replace(/\n/g, " ").slice(0, 280)}\n---\n\n# ${name}\n\n${idea}\n\n## When to use\nUse this skill when the task matches: ${idea}\n\n## Steps\n1. Restate the user goal.\n2. Follow the procedure above.\n3. Return a concise result with evidence.\n`,
    };
  }
  if (kind === "subagent") {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "agent";
    return {
      name,
      source: "local",
      body: `name = "${slug}"\ndescription = "${idea.replace(/\n/g, " ").replace(/"/g, '\\"').slice(0, 280)}"\ndeveloper_instructions = """\nRole: ${name}.\n\n${idea}\n\nStay inside the assignment. Return a concise summary with evidence (paths, commands, outcomes).\n"""\n`,
    };
  }
  return {
    name,
    source: "local",
    body: `# ${name}\n\nJob: ${idea}\n\n## Duties\n- Own this role: ${idea}\n- Do not cover another seat. Hand off with a spec (goal, done when, constraints, files).\n\n## Definition of done\n- The assigned task is complete or blocked with a reason.\n- Reviewer (if any) can reproduce the result.\n\n## Tools\nsandbox: workspace_write\n`,
  };
}

export async function generateMarkdown(
  kind: GenerateKind,
  prompt: string,
  env: NodeJS.ProcessEnv = process.env,
  dataDir?: string,
): Promise<GeneratedMarkdown> {
  if (!prompt.trim()) {
    throw new StoreError(400, "prompt is required");
  }
  const llm = await tryLlmGenerate(kind, prompt, env, dataDir);
  if (llm) return llm;
  return localGenerate(kind, prompt);
}

function nameFromPrompt(prompt: string): string {
  const line = prompt.split(/\n/)[0]?.trim() ?? "Untitled";
  return line.slice(0, 48);
}

async function tryLlmGenerate(
  kind: GenerateKind,
  prompt: string,
  env: NodeJS.ProcessEnv,
  dataDir?: string,
): Promise<GeneratedMarkdown | null> {
  if (!dataDir) return null;
  const bodyHint =
    kind === "subagent"
      ? "body must be Codex-style TOML with name, description, and developer_instructions."
      : kind === "agent"
        ? `body must be Markdown with sections:
## Memory — Channel.md is the task; MEMORY.md is standing notes; do not recap the whole thread
## Plan — one local directive: goal, done when, short checklist
## Act — inspect, smallest change, verify, stop; hand off other seats with a line-start @handle spec
## Skills — catalog is availability, not a todo; call skill only when this turn matches`
        : kind === "soul"
          ? "body must be Markdown: voice, values, boundaries. Not an operating procedure."
          : kind === "position"
            ? "body must be Markdown: duties, definition of done, and a Tools sandbox: line."
            : "body must be Markdown.";
  const system = `You write ${TITLES[kind]} for an AI bot in Guild.
Return JSON only: {"name": string, "body": string}.
${bodyHint}
name is a short title. Keep it short. Language: follow the user's prompt.`;
  const result = await llmComplete({
    dataDir,
    env,
    system,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    role: "generate",
  });
  if (!result) return null;
  const parsed = extractJson(result.text);
  if (!parsed?.name || !parsed?.body) return null;
  return { name: parsed.name, body: parsed.body, source: "llm" };
}

export type SkillPickItem = {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  slug?: string;
};

export type SkillPickInput = {
  name?: string;
  handle?: string;
  oneLiner?: string;
  soul?: string;
  agent?: string;
  position?: string;
  skills: SkillPickItem[];
};

export type SkillPickResult = {
  skillIds: string[];
  source: "llm" | "local";
};

const PICK_MAX = 8;
const PICK_CATALOG_MAX = 200;
const PICK_DESC_CAP = 180;
const PICK_MD_CAP = 1600;

export async function pickSkills(
  input: SkillPickInput,
  env: NodeJS.ProcessEnv = process.env,
  dataDir?: string,
): Promise<SkillPickResult> {
  const catalog = normalizePickCatalog(input.skills);
  if (!catalog.length) {
    throw new StoreError(400, "skills catalog is required");
  }
  const brief = seatBrief(input);
  if (!brief.trim()) {
    throw new StoreError(400, "markdown is required");
  }
  if (dataDir) {
    const llm = await tryLlmPick(brief, catalog, env, dataDir);
    if (llm?.skillIds.length) return llm;
  }
  return localPick(brief, catalog);
}

function normalizePickCatalog(skills: SkillPickItem[]): SkillPickItem[] {
  const out: SkillPickItem[] = [];
  const seen = new Set<string>();
  for (const item of skills || []) {
    const id = String(item?.id || "").trim();
    const name = String(item?.name || "").trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      slug: String(item.slug || "").trim(),
      description: String(item.description || "").slice(0, PICK_DESC_CAP),
      tags: Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 8)
        : [],
    });
    if (out.length >= PICK_CATALOG_MAX) break;
  }
  return out;
}

function seatBrief(input: SkillPickInput): string {
  const clip = (value: string, cap: number) => value.trim().slice(0, cap);
  const parts = [
    input.name?.trim() ? `Name: ${clip(input.name, 80)}` : "",
    input.handle?.trim() ? `Handle: ${clip(input.handle, 40)}` : "",
    input.oneLiner?.trim() ? `One-liner: ${clip(input.oneLiner, 240)}` : "",
    input.soul?.trim() ? `SOUL.md\n${clip(input.soul, PICK_MD_CAP)}` : "",
    input.agent?.trim() ? `AGENTS.md\n${clip(input.agent, PICK_MD_CAP)}` : "",
    input.position?.trim() ? `POSITION.md\n${clip(input.position, PICK_MD_CAP)}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

function filterPickIds(ids: string[], catalog: SkillPickItem[]): string[] {
  const allowed = new Set(catalog.map((item) => item.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= PICK_MAX) break;
  }
  return out;
}

async function tryLlmPick(
  brief: string,
  catalog: SkillPickItem[],
  env: NodeJS.ProcessEnv,
  dataDir: string,
): Promise<SkillPickResult | null> {
  const compact = catalog.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description || "",
    tags: item.tags || [],
  }));
  const system = `You staff skills onto one AI bot seat.
Return JSON only: {"skillIds": string[]}.
Pick 3-8 ids from the catalog this seat actually needs, matching Soul / Agent / Position.
Prefer specific skills over generic ones. Do not invent ids. Do not pick everything.`;
  const result = await llmComplete({
    dataDir,
    env,
    system,
    messages: [
      {
        role: "user",
        content: `${brief}\n\nCatalog:\n${JSON.stringify(compact)}`,
      },
    ],
    temperature: 0.2,
    role: "skills",
  });
  if (!result) return null;
  const ids = extractSkillIds(result.text);
  if (!ids) return null;
  const skillIds = filterPickIds(ids, catalog);
  if (!skillIds.length) return null;
  return { skillIds, source: "llm" };
}

function localPick(brief: string, catalog: SkillPickItem[]): SkillPickResult {
  const toks = pickTokens(brief);
  const ranked = catalog
    .map((item) => ({ id: item.id, n: pickScore(item, toks) }))
    .filter((item) => item.n > 0)
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  return {
    skillIds: ranked.slice(0, PICK_MAX).map((item) => item.id),
    source: "local",
  };
}

function pickTokens(text: string): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const word of lower.match(/[a-z][a-z0-9-]{1,}|[0-9]{2,}/g) || []) {
    out.add(word);
  }
  const cjk = lower.match(/[\u3400-\u9fff]+/g) || [];
  for (const run of cjk) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

function pickScore(item: SkillPickItem, toks: string[]): number {
  const hay = (
    `${item.name} ${item.slug || ""} ${item.description || ""} ${(item.tags || []).join(" ")}`
  ).toLowerCase();
  let n = 0;
  for (const tok of toks) {
    if (hay.includes(tok)) n += tok.length > 3 ? 2 : 1;
  }
  return n;
}

function extractSkillIds(content: string): string[] | null {
  const fenced = content.match(/\{[\s\S]*\}/);
  if (!fenced) return null;
  try {
    const value = JSON.parse(fenced[0]) as { skillIds?: unknown };
    if (!Array.isArray(value.skillIds)) return null;
    return value.skillIds.filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

/** Seat exclusivity, spec handoffs, quiet unless blocked. */
export const HALL_RULES = `# Hall
Own this seat. Do not do another staffed bot's job.
When work belongs to someone else, put @handle at the start of a line with a written spec, not a suggestion in prose:
- Goal (one sentence)
- Done when
- Constraints / out of scope
- Files or evidence
Each line-start @handle on this quest starts that seat. A markdown numbered list that names a teammate (1. @design) also starts them, even if the handle is wrapped in backticks. Mentions that are only commentary in a sentence do not dispatch.
Do not @all unless the human did. Do not recruit extra people; the human staffs the roster (max ${CHANNEL_ROSTER_CAP} on a quest).
You may @handle any staffed teammate whose job is the next step, even if the human only named you this turn. That is how the hall continues. Do not dump the same work on every seat. If two seats must run in order, only @ the seat that can start now — a numbered list that names later seats starts them this turn too. Do not write a plan and stop.
Stay quiet: no status theater, no "I'll start now." Speak when you finish, block, or need a decision. Money, sends, and destructive actions wait for the human.

Harness this turn (Memory → Plan → Skills → Act):
- Memory: Channel.md is the task. MEMORY.md is standing notes. The compact log is working memory — do not recap the whole thread.
- Plan: one local directive (goal + done when) before tools. Revise it when evidence changes.
- Skills: the catalog is availability, not a todo. Call \`skill\` only when this directive matches. Do not load every skill.
- Act: you coordinate this seat. Spawn first when the work is a repo survey (\`explorer\` / luna-explore), a critique (\`reviewer\`), or a bounded isolated patch (\`worker\` / luna-general); then verify the child's evidence and decide. Independent surveys: spawn background=true, keep working, then read_spawn before you answer. Sequential: background=false and wait. Do not spawn for one known file, a one-line change, or a question that needs no repo. Do not let children commit, push, or make the architecture call. Do not skip spawn just because you can do the work yourself. Do not spawn to do another staffed bot's job — @handle them instead.`;

export function buildChatSystem(input: {
  botName: string;
  handle: string;
  soul: string;
  agent: string;
  position: string;
  skills?: SkillRef[];
  subagents?: SubAgentRef[];
  wantSpawn?: SubAgentRef[];
  channelMd?: string;
  botMemory?: string;
  channelMemory?: string;
}): string {
  const skills = input.skills ?? [];
  const subagents = input.subagents ?? [];
  const wantSpawn = input.wantSpawn ?? [];
  const skillLine = skills.length
    ? [
        "<system-reminder>",
        "A skill is a reusable set of task-specific instructions. The following skills are available this turn (staffed on this bot, or invoked with /name):",
        "",
        "<available_skills>",
        ...skills.map((item) => {
          const key = item.slug || item.name;
          const desc = (item.description || item.name)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500);
          return `- \`${key}\`: ${desc}`;
        }),
        "</available_skills>",
        "",
        "If the user names a skill, or the task clearly matches a description, call the skill tool with the exact name before taking task actions. Load applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer a skill's steps until it has been loaded.",
        "</system-reminder>",
      ].join("\n")
    : "";
  const spawnCatalog: Array<{
    slug?: string;
    name: string;
    description?: string;
    readOnly?: boolean;
  }> = subagents.length
    ? subagents
    : [
        {
          slug: "explorer",
          name: "explorer",
          description:
            "Read-only codebase search. Returns absolute paths and a direct answer.",
          readOnly: true,
        },
        {
          slug: "reviewer",
          name: "reviewer",
          description: "Read-only review of correctness, risk, and missing tests.",
          readOnly: true,
        },
        {
          slug: "worker",
          name: "worker",
          description:
            "Implementation executor. Smallest correct change, then verify.",
          readOnly: false,
        },
      ];
  const spawnLine = [
    "<available_subagents>",
    ...spawnCatalog.slice(0, 40).map((item) => {
      const key = item.slug || item.name;
      const desc = (item.description || item.name)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220);
      const mode = item.readOnly ? "read-only" : "read-write";
      return `- \`${key}\` (${mode}): ${desc}`;
    }),
    "</available_subagents>",
    "Call spawn with the exact name (or slug) and a self-contained prompt (Pi: agent+task). Default: explorer to orient across unknown files, reviewer to critique a change, worker for an isolated patch. Independent slices: several spawn calls in this round, or tasks: [{name, prompt}]. You stay this seat's coordinator. Skipping spawn and reading the whole tree yourself is the wrong default.",
    "If the user writes /name matching a subagent, spawn that one. The child has a fresh context and returns a summary.",
    wantSpawn.length
      ? `This turn the user invoked ${wantSpawn
          .map((item) => "`/" + (item.slug || item.name) + "`")
          .join(", ")}. Call spawn with that exact name first, with a self-contained prompt covering their request. Do not skip this and do the work yourself.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const channel = (input.channelMd ?? "").trim();
  const channelBlock = channel
    ? `# Channel.md\nThis channel's operating notes written by the user. Follow them for this room. They outrank MEMORY.md.\n\n${channel.slice(0, 4000)}`
    : "";
  const botMem = (input.botMemory ?? "").trim();
  const botMemBlock = botMem
    ? `# MEMORY.md\nStanding notes this bot has learned. Auto-updated after useful turns. Not a transcript.\n\n${botMem.slice(0, MEMORY_INJECT_CAP)}`
    : "";
  const roomMem = (input.channelMemory ?? "").trim();
  const roomMemBlock = roomMem
    ? `# Channel MEMORY.md\nStanding notes for this channel, shared by everyone here. Auto-updated.\n\n${roomMem.slice(0, MEMORY_INJECT_CAP)}`
    : "";
  return [
    `You are ${input.botName} (@${input.handle}), a staffed bot in Guild.`,
    "Reply in the user's language. Be brief. Stay in character.",
    HALL_RULES,
    hostContext(),
    TOOL_SYSTEM,
    skillLine,
    spawnLine,
    channelBlock,
    botMemBlock,
    roomMemBlock,
    input.soul.slice(0, 2400),
    input.agent.slice(0, 1600),
    input.position.slice(0, 800),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function chatReply(input: {
  botName: string;
  handle: string;
  soul: string;
  agent: string;
  position: string;
  history: HistoryItem[];
  userMessage: string;
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  model?: ModelRef | null;
  skills?: SkillRef[];
  subagents?: SubAgentRef[];
  wantSpawn?: SubAgentRef[];
  channelMd?: string;
  botMemory?: string;
  channelMemory?: string;
  compact?: CompactCheckpoint | null;
  onCompact?: (checkpoint: CompactCheckpoint) => void;
  onProgress?: (update: ToolProgress) => void;
  pullSteers?: () => string[];
  signal?: AbortSignal;
  mcpTools?: McpToolRef[];
  sandbox?: Sandbox;
  workspace?: string;
  dispatch?: ToolContext["dispatch"];
}): Promise<ChatReply> {
  const env = input.env ?? process.env;
  const system = buildChatSystem({
    botName: input.botName,
    handle: input.handle,
    soul: input.soul,
    agent: input.agent,
    position: input.position,
    skills: input.skills ?? [],
    subagents: input.subagents ?? [],
    wantSpawn: input.wantSpawn ?? [],
    channelMd: input.channelMd,
    botMemory: input.botMemory,
    channelMemory: input.channelMemory,
  });
  const llm = input.dataDir
    ? await tryChatLlm(input, env, input.dataDir, input.model, input.skills ?? [])
    : null;
  if (llm) return { ...llm, source: "llm", system: llm.system || system };
  const body = localChatReply(input.botName, input.handle, input.userMessage);
  return {
    body,
    parts: [{ type: "text", text: body }],
    source: "local",
    system,
    traces: [],
    thinking: "",
    model: null,
    usage: { estimated: true, rounds: 0, durationMs: 0, totalTokens: 0 },
  };
}

export function localChatReply(
  botName: string,
  handle: string,
  userMessage: string,
): string {
  const clip = userMessage.trim().slice(0, 120);
  return `【${botName} @${handle}】收到。「${clip}」\n\n沒有可用模型，本機工具還沒辦法跑。到模型頁（/settings）連接訂閱或填 API key，套用主模型後再問。`;
}

async function tryChatLlm(
  input: {
    botName: string;
    handle: string;
    soul: string;
    agent: string;
    position: string;
    history: HistoryItem[];
    userMessage: string;
    skills?: SkillRef[];
    subagents?: SubAgentRef[];
    wantSpawn?: SubAgentRef[];
    channelMd?: string;
    botMemory?: string;
    channelMemory?: string;
    compact?: CompactCheckpoint | null;
    onCompact?: (checkpoint: CompactCheckpoint) => void;
    onProgress?: (update: ToolProgress) => void;
    pullSteers?: () => string[];
    signal?: AbortSignal;
    mcpTools?: McpToolRef[];
    sandbox?: Sandbox;
    workspace?: string;
    dispatch?: ToolContext["dispatch"];
  },
  env: NodeJS.ProcessEnv,
  dataDir: string,
  prefer: ModelRef | null | undefined,
  skills: SkillRef[],
): Promise<Omit<ChatReply, "source"> | null> {
  const system = buildChatSystem({
    botName: input.botName,
    handle: input.handle,
    soul: input.soul,
    agent: input.agent,
    position: input.position,
    skills,
    subagents: input.subagents ?? [],
    wantSpawn: input.wantSpawn ?? [],
    channelMd: input.channelMd,
    botMemory: input.botMemory,
    channelMemory: input.channelMemory,
  });
  const packed = await packHistory({
    system,
    history: input.history,
    userMessage: input.userMessage,
    dataDir,
    env,
    prefer,
    checkpoint: input.compact,
    onProgress: input.onProgress,
    signal: input.signal,
  });
  if (packed.compacted && packed.checkpoint && input.onCompact) {
    input.onCompact(packed.checkpoint);
  }
  const result = await llmComplete({
    dataDir,
    env,
    system,
    messages: packed.messages,
    temperature: 0.5,
    role: "chat",
    prefer,
    tools: true,
    skills,
    toolCtx: {
      skills,
      subagents: input.subagents ?? [],
      dataDir,
      env,
      spawnDepth: 0,
      allowWrite: true,
      onProgress: input.onProgress,
      pullSteers: input.pullSteers,
      signal: input.signal,
      mcpTools: input.mcpTools ?? (await listMcpToolRefs(dataDir)),
      spawnHandles: new Map(),
      ...policyFor(env, {
        sandbox: input.sandbox,
        workspace: input.workspace,
        position: input.position,
      }),
      ...(input.dispatch ? { dispatch: input.dispatch } : {}),
    },
  });
  if (!result) return null;
  const parts = assembleParts({
    thinking: result.thinking,
    traces: result.traces,
    text: result.text,
  });
  return {
    body: bodyFromParts(parts, result.text),
    parts,
    system,
    thinking: result.thinking,
    traces: result.traces,
    model: { provider: result.provider, model: result.model },
    usage: result.usage
      ? {
          ...result.usage,
          provider: result.provider,
          model: result.model,
        }
      : {
          provider: result.provider,
          model: result.model,
        },
  };
}

function extractJson(
  content: string,
): { name: string; body: string } | null {
  const fenced = content.match(/\{[\s\S]*\}/);
  if (!fenced) return null;
  try {
    const value = JSON.parse(fenced[0]) as { name?: unknown; body?: unknown };
    if (typeof value.name !== "string" || typeof value.body !== "string") {
      return null;
    }
    return { name: value.name, body: value.body };
  } catch {
    return null;
  }
}
