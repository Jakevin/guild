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
      body: `# ${name}\n\nOperating procedure for: ${idea}\n\n## How you work\n1. Restate the goal in one sentence.\n2. Inspect the workspace before editing.\n3. Make the smallest change that satisfies the goal.\n4. Verify with a command or test.\n5. Summarize what changed and what is still open.\n6. Work that belongs to another seat: @handle with Goal / Done when / out of scope / files.\n\n## Quality bar\n- No untested guesses.\n- Cite files you touched.\n- No status theater.\n`,
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
      : "body must be Markdown.";
  const system = `You write ${TITLES[kind]} for an AI bot.
Return JSON only: {"name": string, "body": string}.
${bodyHint} name is a short title. Language: follow the user's prompt.`;
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

/** Seat exclusivity, spec handoffs, quiet unless blocked. */
export const HALL_RULES = `# Hall
Own this seat. Do not do another staffed bot's job.
When work belongs to someone else, @handle them with a written spec, not a suggestion:
- Goal (one sentence)
- Done when
- Constraints / out of scope
- Files or evidence
Do not @all unless the human did. Do not recruit extra people; the human staffs the roster (max ${CHANNEL_ROSTER_CAP} on a quest).
Stay quiet: no status theater, no "I'll start now." Speak when you finish, block, or need a decision. Money, sends, and destructive actions wait for the human.`;

export function buildChatSystem(input: {
  botName: string;
  handle: string;
  soul: string;
  agent: string;
  position: string;
  skills?: SkillRef[];
  subagents?: SubAgentRef[];
  channelMd?: string;
  botMemory?: string;
  channelMemory?: string;
}): string {
  const skills = input.skills ?? [];
  const subagents = input.subagents ?? [];
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
  const spawnLine = subagents.length
    ? [
        "<available_subagents>",
        ...subagents.slice(0, 40).map((item) => {
          const key = item.slug || item.name;
          const desc = (item.description || item.name)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 220);
          const mode = item.readOnly ? "read-only" : "read-write";
          return `- \`${key}\` (${mode}): ${desc}`;
        }),
        "</available_subagents>",
        "Call spawn with the exact name (or slug) and a self-contained prompt. If the user writes /name matching a subagent, spawn that one. The child has a fresh context and returns a summary.",
      ].join("\n")
    : "";
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
  return `【${botName} @${handle}】收到。「${clip}」\n\n沒有可用模型，本機工具還沒辦法跑。到私訊幫我選一個模型後再問。`;
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
