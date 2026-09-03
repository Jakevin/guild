import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { Type, type Tool } from "@earendil-works/pi-ai";
import { listHostSkills } from "./host-skills.ts";
import type { McpToolRef } from "./mcp.ts";
import {
  defaultWorkspace,
  gateTool,
  parseSandbox,
  resolveToolPath,
  type Sandbox,
} from "./harness.ts";

const execFileAsync = promisify(execFile);
const HOME = homedir();
const OUTPUT_CAP = 16_000;
const RUN_TIMEOUT_MS = 45_000;
const TRACE_CAP = 1_200;

export type SkillRef = {
  name: string;
  slug?: string;
  body: string;
  description?: string;
  path?: string;
};

export type SubAgentRef = {
  name: string;
  slug: string;
  description?: string;
  instructions: string;
  readOnly: boolean;
  path?: string;
  source?: "catalog" | "user" | "host";
};

export type ToolTrace = {
  name: string;
  args: Record<string, unknown>;
  text: string;
  isError: boolean;
  running?: boolean;
};

export type ToolProgress = {
  thinking: string;
  traces: ToolTrace[];
};

export type ToolOutcome = { text: string; isError: boolean };

export type ToolContext = {
  skills?: SkillRef[];
  subagents?: SubAgentRef[];
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Grok depth-1: children cannot spawn. */
  spawnDepth?: number;
  allowWrite?: boolean;
  onProgress?: (update: ToolProgress) => void;
  /** Drain user steers injected mid-turn (Codex-style). */
  pullSteers?: () => string[];
  signal?: AbortSignal;
  mcpTools?: McpToolRef[];
  /** Codex-shaped. Default full_access. */
  sandbox?: Sandbox;
  /** Root for workspace_write. Relative tool paths resolve here. */
  workspace?: string;
  /** DSH-style: live daemon routes through ctx.tools.execute. */
  dispatch?: (
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolOutcome>;
  /** Devin-style background spawn handles for this turn. Same Map across dispatch clones. */
  spawnHandles?: Map<string, SpawnHandle>;
  /** Channel or DM this turn is in. Cron jobs default here. */
  roomId?: string;
  /** Seat running this turn. cronjob create defaults here. */
  botId?: string;
  /** Hermes: cron child sessions cannot manage cron. */
  cronRun?: boolean;
};

export type SpawnHandle = {
  id: string;
  title: string;
  profile: string;
  done: Promise<ToolOutcome>;
  outcome?: ToolOutcome;
  abort?: AbortController;
};

/** Pin the turn's handle Map before dispatch spreads a rest clone. */
export function attachSpawnHandles(ctx: ToolContext): Map<string, SpawnHandle> {
  if (!ctx.spawnHandles) ctx.spawnHandles = new Map();
  return ctx.spawnHandles;
}

const BASE_TOOLS: Tool[] = [
  {
    name: "run",
    description:
      "Run a shell command on the user's local computer. Prefer workdir over cd. Check the [exit code: N] marker after every call; nonzero is a command failure, not a tool crash. Do not tell the user to run the command themselves.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command" }),
      description: Type.Optional(
        Type.String({
          description: "One-line, 5–10 word summary of what this command does, for the UI only",
        }),
      ),
      workdir: Type.Optional(
        Type.String({
          description: "Working directory. Absolute, or ~. Defaults to the user's home.",
        }),
      ),
    }),
  },
  {
    name: "read",
    description: "Read a UTF-8 text file from the user's computer.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute path, or ~ for home" }),
    }),
  },
  {
    name: "write",
    description: "Write a UTF-8 text file on the user's computer. Creates parent folders.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute path, or ~ for home" }),
      content: Type.String({ description: "File contents" }),
    }),
  },
  {
    name: "list",
    description: "List files in a directory on the user's computer.",
    parameters: Type.Object({
      path: Type.String({ description: "Directory path" }),
    }),
  },
  {
    name: "image_gen",
    description:
      "Generate an image from a text prompt (Grok Imagine / OpenAI Images). Use this instead of searching for an image_gen skill. Returns a local file and markdown the user can see in chat.",
    parameters: Type.Object({
      prompt: Type.String({
        description: "Image description. Be specific about subject, style, and composition.",
      }),
      aspect_ratio: Type.Optional(
        Type.String({
          description:
            "auto, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3. Default auto.",
        }),
      ),
    }),
  },
  {
    name: "browser",
    description:
      "Drive a local Chromium-family browser via CDP. Default snapshots the user's active Chrome profile (Local State last_used; cookies/logins via sqlite backup) into ~/.guild/browser-profile/chrome and drives that copy — never the live profile. Set GUILD_BROWSER_REAL_PROFILE=0 for a throwaway profile (logged into nothing); off deletes the snapshot. Actions: open, snapshot, click, type, press, screenshot, close.",
    parameters: Type.Object({
      action: Type.String({
        description: "open | snapshot | click | type | press | screenshot | close",
      }),
      url: Type.Optional(Type.String({ description: "URL for action=open" })),
      ref: Type.Optional(
        Type.String({ description: "Snapshot ref like @e1 for click/type" }),
      ),
      text: Type.Optional(
        Type.String({ description: "Text to type, or key name for press" }),
      ),
    }),
  },
];

export function guildTools(
  skills: SkillRef[] = [],
  ctx: ToolContext = {},
): Tool[] {
  const names = skills.map((item) => item.name).filter(Boolean);
  const available = names.length ? ` Available: ${names.join(", ")}.` : "";
  const allowWrite = ctx.allowWrite !== false;
  const sandbox = parseSandbox(ctx.sandbox);
  let tools: Tool[] = allowWrite
    ? [...BASE_TOOLS]
    : BASE_TOOLS.filter((tool) => tool.name !== "write");
  if (sandbox === "read_only") {
    tools = tools.filter(
      (tool) => tool.name === "read" || tool.name === "list",
    );
  } else if (sandbox === "workspace_write") {
    tools = tools.filter(
      (tool) => tool.name !== "image_gen" && tool.name !== "browser",
    );
  }
  if (!ctx.cronRun) {
    tools.push({
      name: "cronjob",
      description:
        "Schedule a later hall turn (Hermes cronjob). Fresh @handle turn with a self-contained prompt. Actions: create, list, pause, resume, run, remove. schedule may be natural language (每10分鐘, 10分鐘後, 每天9點, in 30 minutes, every 2h, 0 9 * * *, ISO). Split when vs task: schedule is the time phrase, prompt is the work. bot_id defaults to this seat. Do not create cron jobs from a cron run.",
      parameters: Type.Object({
        action: Type.String({
          description: "create | list | pause | resume | run | remove",
        }),
        schedule: Type.Optional(
          Type.String({
            description:
              "Natural language or Hermes form: 每10分鐘, in 30m, every 2h, 每天9點, 0 9 * * *, ISO",
          }),
        ),
        prompt: Type.Optional(
          Type.String({ description: "Self-contained task for the seat" }),
        ),
        name: Type.Optional(Type.String({ description: "Short job name" })),
        job_id: Type.Optional(Type.String({ description: "Job id or name" })),
        bot_id: Type.Optional(Type.String({ description: "Seat to run" })),
        room_id: Type.Optional(
          Type.String({ description: "Room id. Defaults to this hall." }),
        ),
      }),
    });
  }
  tools.push({
    name: "skill",
    description: `Load a staffed skill's full instructions by name.${available}`,
    parameters: Type.Object({
      name: Type.String({ description: "Skill name or slug" }),
    }),
  });
  if ((ctx.spawnDepth ?? 0) < 1) {
    const agents = ctx.subagents ?? [];
    const listed = agents
      .slice(0, 40)
      .map((item) => {
        const hint = item.description ? ` — ${item.description}` : "";
        return `${item.name}${hint}`;
      })
      .join("; ");
    const catalog = listed ? ` Available: ${listed}.` : "";
    tools.push({
      name: "spawn",
      description: `Delegate to a specialist (Devin run_subagent / Pi subagent / Codex spawn_agent). Fresh context; returns a summary, not a transcript. You stay coordinator. Single: title + task + profile (aliases: description/prompt, name/agent). Profiles: explorer (read-only survey), reviewer (read-only critique), worker (bounded patch). luna-explore maps to explorer, luna-general to worker. Independent surveys: background=true (is_background), then read_spawn with the agent_id before the final reply. Parallel: several spawn calls this round, or tasks: [{title, task, profile}, ...] (max 8, 4 at a time). Do not spawn for one known file or a one-line change.${catalog} A read_only parent still spawns; the child stays read_only. Subagents cannot spawn children.`,
      parameters: Type.Object({
        prompt: Type.Optional(
          Type.String({
            description: "Self-contained task. Same as task.",
          }),
        ),
        task: Type.Optional(
          Type.String({ description: "Alias of prompt (Devin/Pi)" }),
        ),
        name: Type.Optional(
          Type.String({
            description: "Subagent name or slug. Default worker.",
          }),
        ),
        agent: Type.Optional(
          Type.String({ description: "Alias of name (Pi)" }),
        ),
        profile: Type.Optional(
          Type.String({
            description:
              "Devin profile: explorer | reviewer | worker. luna-explore → explorer, luna-general → worker.",
          }),
        ),
        description: Type.Optional(
          Type.String({
            description: "Short 3–8 word label for the chat UI",
          }),
        ),
        title: Type.Optional(
          Type.String({ description: "Alias of description (Devin title)" }),
        ),
        background: Type.Optional(
          Type.Boolean({
            description:
              "If true, return agent_id immediately and keep working. Then call read_spawn.",
          }),
        ),
        is_background: Type.Optional(
          Type.Boolean({ description: "Alias of background (Devin)" }),
        ),
        tasks: Type.Optional(
          Type.Array(
            Type.Object({
              prompt: Type.Optional(Type.String()),
              task: Type.Optional(Type.String()),
              name: Type.Optional(Type.String()),
              agent: Type.Optional(Type.String()),
              profile: Type.Optional(Type.String()),
              description: Type.Optional(Type.String()),
              title: Type.Optional(Type.String()),
            }),
            {
              description:
                "Pi parallel: run these subagents concurrently (max 8, 4 at a time).",
            },
          ),
        ),
      }),
    });
    tools.push({
      name: "read_spawn",
      description:
        "Read a background spawn started with background=true (Devin read_subagent). Pass agent_id from spawn. block=true (default) waits; block=false returns running or the summary.",
      parameters: Type.Object({
        agent_id: Type.Optional(
          Type.String({ description: "Id returned by background spawn" }),
        ),
        id: Type.Optional(Type.String({ description: "Alias of agent_id" })),
        block: Type.Optional(
          Type.Boolean({
            description: "Wait for the child. Default true.",
          }),
        ),
      }),
    });
  }
  for (const mcp of sandbox === "full_access" ? ctx.mcpTools ?? [] : []) {
    tools.push({
      name: mcp.callName,
      description: mcp.description,
      parameters: Type.Object({}, { additionalProperties: true }),
    });
  }
  return tools;
}

export const GUILD_TOOLS: Tool[] = guildTools();

function openaiParameters(name: string): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
} {
  if (name === "run") {
    return {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command" },
        description: {
          type: "string",
          description: "One-line summary of the command, UI only",
        },
        workdir: { type: "string", description: "Working directory" },
      },
      required: ["command"],
    };
  }
  if (name === "write") {
    return {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    };
  }
  if (name === "skill") {
    return {
      type: "object",
      properties: { name: { type: "string", description: "Skill name or slug" } },
      required: ["name"],
    };
  }
  if (name === "spawn") {
    const job = {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Self-contained task. Same as task." },
        task: { type: "string", description: "Alias of prompt" },
        name: { type: "string", description: "Subagent name or slug" },
        agent: { type: "string", description: "Alias of name" },
        profile: { type: "string", description: "explorer | reviewer | worker" },
        description: { type: "string", description: "Short UI label" },
        title: { type: "string", description: "Alias of description" },
      },
    };
    return {
      type: "object",
      properties: {
        ...job.properties,
        background: { type: "boolean", description: "Return agent_id immediately" },
        is_background: { type: "boolean", description: "Alias of background" },
        tasks: {
          type: "array",
          description: "Pi parallel: [{name, prompt}, ...] max 8, 4 at a time",
          items: job,
        },
      },
      required: [],
    };
  }
  if (name === "read_spawn") {
    return {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Id from background spawn" },
        id: { type: "string", description: "Alias of agent_id" },
        block: { type: "boolean", description: "Wait. Default true." },
      },
      required: [],
    };
  }
  if (name === "image_gen") {
    return {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image description" },
        aspect_ratio: {
          type: "string",
          description: "auto, 1:1, 16:9, 9:16, …",
        },
      },
      required: ["prompt"],
    };
  }
  if (name === "cronjob") {
    return {
      type: "object",
      properties: {
        action: { type: "string", description: "create | list | pause | resume | run | remove" },
        schedule: { type: "string" },
        prompt: { type: "string" },
        name: { type: "string" },
        job_id: { type: "string" },
        bot_id: { type: "string" },
        room_id: { type: "string" },
      },
      required: ["action"],
    };
  }
  if (name === "browser") {
    return {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "open | snapshot | click | type | press | screenshot | close",
        },
        url: { type: "string", description: "URL for open" },
        ref: { type: "string", description: "Snapshot ref @e1" },
        text: { type: "string", description: "Typed text or key name" },
      },
      required: ["action"],
    };
  }
  return {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  };
}

export function openaiTools(skills: SkillRef[] = [], ctx: ToolContext = {}) {
  return guildTools(skills, ctx).map((tool) => {
    const mcp = (ctx.mcpTools ?? []).find((item) => item.callName === tool.name);
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: mcp
          ? mcp.inputSchema
          : openaiParameters(tool.name),
      },
    };
  });
}

export const OPENAI_TOOLS = openaiTools();

export const BUILTIN_TOOL_NAMES = [
  "run",
  "read",
  "write",
  "list",
  "skill",
  "spawn",
  "read_spawn",
  "image_gen",
  "browser",
  "cronjob",
] as const;

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext = {},
): Promise<ToolOutcome> {
  try {
    const refused = gateTool(name, args, ctx);
    if (refused) return refused;
    attachSpawnHandles(ctx);
    if (ctx.dispatch) {
      const { dispatch, ...rest } = ctx;
      return await dispatch(name, args, rest);
    }
    return await builtinExecute(name, args, ctx);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return {
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

export async function builtinExecute(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext = {},
): Promise<ToolOutcome> {
  try {
    // workspace_write resolves relative paths from the workspace root, which
    // defaults to the guild checkout (same root gateTool checks against).
    const pathBase =
      parseSandbox(ctx.sandbox) === "workspace_write"
        ? resolveToolPath(ctx.workspace?.trim() || defaultWorkspace())
        : HOME;
    if (name === "run") {
      return await runCommand(
        asString(args.command),
        typeof args.workdir === "string" ? args.workdir : "",
        pathBase,
      );
    }
    if (name === "read") return readFile(asString(args.path), pathBase);
    if (name === "write") {
      if (ctx.allowWrite === false) {
        return { text: "this subagent is read-only; write is disabled", isError: true };
      }
      return writeFile(
        asString(args.path),
        asString(args.content, true),
        pathBase,
      );
    }
    if (name === "list") return listDir(asString(args.path), pathBase);
    if (name === "skill") return loadSkill(asString(args.name), ctx.skills ?? []);
    if (name === "spawn") {
      const { runSpawnJobs } = await import("./subagent.ts");
      return runSpawnJobs(args, ctx);
    }
    if (name === "read_spawn") {
      const { readSpawn } = await import("./subagent.ts");
      return readSpawn(args, ctx);
    }
    if (name === "image_gen") {
      const { generateImage } = await import("./image-gen.ts");
      return generateImage({
        prompt: asString(args.prompt),
        aspectRatio:
          typeof args.aspect_ratio === "string" ? args.aspect_ratio : "",
        dataDir: ctx.dataDir,
        env: ctx.env,
      });
    }
    if (name === "cronjob") {
      return {
        text: "cronjob needs guildd (the cron plugin)",
        isError: true,
      };
    }
    if (name === "browser") {
      const { runBrowser } = await import("./browser.ts");
      return runBrowser(args, {
        dataDir: ctx.dataDir,
        env: ctx.env,
        signal: ctx.signal,
      });
    }
    if (name.startsWith("mcp__")) {
      const { callMcpTool } = await import("./mcp.ts");
      if (!ctx.dataDir) return { text: "mcp needs a dataDir", isError: true };
      return callMcpTool(ctx.dataDir, name, args, ctx.mcpTools ?? []);
    }
    return { text: `unknown tool: ${name}`, isError: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return {
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

export function emitProgress(
  ctx: ToolContext,
  traces: ToolTrace[],
  thinking = "",
): void {
  ctx.onProgress?.({ traces, thinking });
}

export function throwIfAborted(ctx: ToolContext): void {
  if (!ctx.signal?.aborted) return;
  const err = new Error("aborted");
  err.name = "AbortError";
  throw err;
}

/** User Stop only. No wall-clock round fuse — Pi/Codex/Hermes wait on the stream. */
export function roundSignal(ctx: ToolContext): AbortSignal | undefined {
  return ctx.signal;
}

export function takeSteers(ctx: ToolContext): string | null {
  const kept = (ctx.pullSteers?.() ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (!kept.length) return null;
  return [
    "The user sent this while you were already working. Incorporate it without dropping the unfinished task. If it changes priority, follow it; otherwise address it and then resume.",
    "",
    "<user_steer>",
    kept.join("\n\n"),
    "</user_steer>",
  ].join("\n");
}

export async function executeToolTraced(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  traces: ToolTrace[],
  thinking = "",
): Promise<ToolOutcome> {
  throwIfAborted(ctx);
  const row: ToolTrace = {
    name,
    args,
    text: "",
    isError: false,
    running: true,
  };
  traces.push(row);
  emitProgress(ctx, traces, thinking);
  const outcome = await executeTool(name, args, ctx);
  row.text = outcome.text;
  row.isError = outcome.isError;
  delete row.running;
  emitProgress(ctx, traces, thinking);
  return outcome;
}

function asString(value: unknown, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error("expected a string argument");
  if (!allowEmpty && !value.trim()) throw new Error("empty argument");
  return value;
}

function resolveUserPath(input: string, base = HOME): string {
  return resolveToolPath(input, base);
}

function clip(text: string): string {
  if (text.length <= OUTPUT_CAP) return text;
  return `${text.slice(0, OUTPUT_CAP)}\n… truncated …`;
}

function formatRunOutput(input: {
  stdout?: string;
  stderr?: string;
  extra?: string[];
}): string {
  const stdout = String(input.stdout ?? "").trim();
  const stderr = String(input.stderr ?? "").trim();
  const chunks = [stdout || ""];
  if (stderr) chunks.push(`[stderr]\n${stderr}`);
  const body = chunks.join("\n").trim() || "(no output)";
  const extra = (input.extra ?? []).filter(Boolean);
  return clip([body, ...extra].join("\n"));
}

async function runCommand(
  command: string,
  workdir = "",
  defaultCwd = HOME,
): Promise<ToolOutcome> {
  const cmd = command.trim();
  if (!cmd) return { text: "empty command", isError: true };
  if (/rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+\/(\s|$)/.test(cmd) || /^mkfs\b/.test(cmd)) {
    return { text: "refused destructive command", isError: true };
  }
  const cwd = workdir.trim() ? resolveUserPath(workdir, defaultCwd) : defaultCwd;
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const { stdout, stderr } = await execFileAsync(shell, ["-lc", cmd], {
      cwd,
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: OUTPUT_CAP * 2,
      env: process.env,
    });
    return {
      text: formatRunOutput({ stdout, stderr, extra: ["[exit code: 0]"] }),
      isError: false,
    };
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
      code?: number | string;
    };
    if (err.killed) {
      return {
        text: formatRunOutput({
          stdout: err.stdout,
          stderr: err.stderr,
          extra: [`[timed out after ${RUN_TIMEOUT_MS}ms]`],
        }),
        isError: true,
      };
    }
    if (typeof err.code === "number") {
      return {
        text: formatRunOutput({
          stdout: err.stdout,
          stderr: err.stderr,
          extra: [`[exit code: ${err.code}]`],
        }),
        isError: false,
      };
    }
    return {
      text: clip(err.message || "command failed"),
      isError: true,
    };
  }
}

function readFile(path: string, base = HOME): ToolOutcome {
  const target = resolveUserPath(path, base);
  const raw = readFileSync(target);
  if (raw.includes(0)) {
    return { text: "binary file", isError: true };
  }
  return { text: clip(raw.toString("utf8")), isError: false };
}

function writeFile(path: string, content: string, base = HOME): ToolOutcome {
  const target = resolveUserPath(path, base);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return { text: `wrote ${target} (${content.length} bytes)`, isError: false };
}

function listDir(path: string, base = HOME): ToolOutcome {
  const target = resolveUserPath(path, base);
  const entries = readdirSync(target, { withFileTypes: true }).slice(0, 200);
  const lines = entries.map((entry) => {
    const kind = entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "link" : "file";
    let extra = "";
    try {
      if (entry.isFile()) extra = ` ${statSync(resolve(target, entry.name)).size}`;
    } catch {
      /* ignore */
    }
    return `${kind}\t${entry.name}${extra}`;
  });
  return { text: lines.join("\n") || "(empty)", isError: false };
}

export function hostContext(): string {
  return `Runtime: ${process.platform}/${process.arch} Node ${process.versions.node}, home=${HOME}.`;
}

export function formatToolTranscript(traces: ToolTrace[]): string {
  if (!traces.length) return "";
  const blocks = traces.map((trace) => {
    const header =
      trace.name === "run"
        ? `$ ${String(trace.args.command ?? "").trim()}`
        : trace.name === "write"
          ? `write ${String(trace.args.path ?? "")}`
          : `${trace.name} ${String(trace.args.path ?? "")}`;
    const body =
      trace.text.length > TRACE_CAP
        ? `${trace.text.slice(0, TRACE_CAP)}\n… truncated …`
        : trace.text;
    return `${header}\n${body}`;
  });
  return `本機\n${blocks.join("\n\n")}`;
}

function skillKey(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function skillBundleDir(filePath: string): string {
  return dirname(resolveUserPath(filePath));
}

function renderSkillContent(name: string, body: string, resourceDir?: string): string {
  const resources = resourceDir
    ? `Base directory for this skill: ${resourceDir}\nResolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.`
    : `Resources for this skill are managed by Guild.\nLoad referenced resources only as needed.`;
  return [
    `<skill_content name="${xmlEscape(name)}">`,
    "<skill_resources>",
    resources,
    "</skill_resources>",
    "<skill_instructions>",
    body.trim(),
    "</skill_instructions>",
    "</skill_content>",
  ].join("\n");
}

function liveHostSkill(staffed: SkillRef, want: string) {
  try {
    const slug = skillKey(staffed.slug || staffed.name);
    return listHostSkills().find((item) => {
      const id = skillKey(item.slug);
      const name = skillKey(item.name);
      return id === slug || name === slug || id === want || name === want;
    });
  } catch {
    return undefined;
  }
}

function loadSkill(name: string, skills: SkillRef[]): ToolOutcome {
  const want = skillKey(name);
  const hit = skills.find(
    (item) => skillKey(item.name) === want || skillKey(item.slug || "") === want,
  );
  if (!hit) {
    const available = skills.map((item) => item.name).join(", ") || "(none)";
    return { text: `unknown skill: ${name}. Available: ${available}`, isError: true };
  }
  const host = liveHostSkill(hit, want);
  const body = host?.body || hit.body;
  const dir = host?.path ? skillBundleDir(host.path) : undefined;
  return { text: clip(renderSkillContent(hit.name, body, dir)), isError: false };
}

/**
 * Codex interactive has no tool-round budget: a turn samples until the model
 * emits an assistant message (context is managed by compact, not a round cap).
 * This number is only a runaway fuse so a stuck tool loop cannot hang guildd.
 */
export const MAX_TOOL_ROUNDS = 128;

export const TOOL_LOOP_WRAP =
  "Stop calling tools now and write the user a final reply with what you already have. If you cannot finish, say what is still missing.";

export const TOOL_LOOP_EXHAUSTED =
  "這輪工具還在繼續，先停在這裡以免卡住。再送一次即可接著做。";

export type ToolRoundPhase = "continue" | "wrap" | "stop";

export function nextToolRound(round: number): ToolRoundPhase {
  if (round >= MAX_TOOL_ROUNDS) return "stop";
  if (round === MAX_TOOL_ROUNDS - 1) return "wrap";
  return "continue";
}

export const TOOL_SYSTEM = `You ARE already running on the user's local computer (Guild, same design as Pi / DeepSeek Harness).
Tools: run, read, write, list, skill, spawn, image_gen, browser, cronjob, plus any connected MCP tools (names start with mcp__).
You can inspect RAM, disk, CPU, processes, files, and run shell commands.
Never say you cannot access this machine. Never tell the user to run the command themselves.
When the question is about this computer, call tools first, then answer with evidence from the output.
To generate an image, call image_gen with a prompt. Do not search the disk or load skills looking for Imagine. After it returns, include the markdown image in your reply.
To use a real website in a browser, call browser with action=open and a url, then snapshot/click/type using refs like @e1. Default is a Hermes-shaped snapshot of the user's last_used Chrome profile (never the live profile). Set GUILD_BROWSER_REAL_PROFILE=0 for a throwaway empty profile.
You stay coordinator. Spawn is the specialist, not a last resort (Devin run_subagent / Pi subagent / Codex spawn_agent). Call spawn for a survey (explorer / luna-explore), a critique (reviewer), or a bounded patch (worker / luna-general) instead of stuffing that work into this turn with list/read/run. Do not spawn for one known file or a one-line change. Independent surveys: spawn with background=true, keep working, then read_spawn {agent_id, block:true} before the final reply. Or several spawn calls / tasks: [{title, task, profile}] this round. Task must be self-contained (child has a fresh context). Do not let a child commit, push, or decide architecture. A read_only seat can still spawn; the child stays read_only. Subagents cannot spawn children.
Independent tool calls in one round also run in parallel — fire several reads/searches together.
Check the [exit code: N] marker on every run result; investigate failures before moving on. Prefer the workdir argument over cd.
To follow a staffed skill, call skill with its exact name (or slug) before applying it. Relative paths in a skill resolve against that skill's base directory.
When the user asks to 排程 / schedule a later hall turn — including natural-language times like 每10分鐘, 10分鐘後, tomorrow 9am — call cronjob create. schedule is the time phrase; prompt is the self-contained task (the job will not see this live turn). bot_id defaults to you. Also accepts in 30m, every 2h, 0 9 * * *, ISO. A cron run cannot create more cron jobs.
Prefer small commands. macOS RAM: sysctl hw.memsize ; memory_pressure. Disk: df -h.`;
