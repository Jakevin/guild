import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ToolContext, ToolOutcome, ToolTrace } from "./tools.ts";

/**
 * Codex-shaped sandbox names. Default is full_access (today's unsandboxed tools).
 * This is the first Harness cut: a gate around executeTool, not Codex app-server.
 */
export const SANDBOX_MODES = [
  "read_only",
  "workspace_write",
  "full_access",
] as const;

export type Sandbox = (typeof SANDBOX_MODES)[number];

export type HarnessPolicy = {
  sandbox: Sandbox;
  workspace: string;
};

export type SandboxRefusal = { text: string; isError: true };

const HOME = homedir();
/** `packages/daemon` (this file lives in `src/`). */
const DAEMON_DIR = fileURLToPath(new URL("..", import.meta.url));

/** Guild checkout (parent of `packages/`). */
export function defaultWorkspace(): string {
  return resolve(DAEMON_DIR, "..", "..");
}

export function parseSandbox(raw: unknown): Sandbox {
  if (raw === "read_only" || raw === "workspace_write" || raw === "full_access") {
    return raw;
  }
  return "full_access";
}

/** Set `GUILD_SANDBOX` wins. Unset is undefined, not full_access. */
export function envSandbox(env: NodeJS.ProcessEnv = process.env): Sandbox | undefined {
  const raw = env.GUILD_SANDBOX;
  if (raw === "read_only" || raw === "workspace_write" || raw === "full_access") {
    return raw;
  }
  return undefined;
}

export function sandboxFromEnv(env: NodeJS.ProcessEnv = process.env): Sandbox {
  return envSandbox(env) ?? "full_access";
}

/**
 * Optional `sandbox: read_only|workspace_write|full_access` line in POSITION.md.
 * Env still wins over this.
 */
export function sandboxFromPosition(body: string): Sandbox | undefined {
  const match = body.match(
    /(?:^|\n)\s*(?:[-*]\s*)?sandbox:\s*(read_only|workspace_write|full_access)\b/i,
  );
  if (!match) return undefined;
  const value = match[1].toLowerCase();
  if (value === "read_only" || value === "workspace_write" || value === "full_access") {
    return value;
  }
  return undefined;
}

export function resolveToolPath(input: string, base = HOME): string {
  const trimmed = input.trim();
  if (trimmed === "~") return HOME;
  if (trimmed.startsWith("~/")) return resolve(HOME, trimmed.slice(2));
  if (trimmed.startsWith("/")) return resolve(trimmed);
  return resolve(base, trimmed);
}

export function workspaceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fallback?: string,
): string {
  const raw = env.GUILD_WORKSPACE?.trim();
  if (raw) return resolveToolPath(raw);
  if (fallback?.trim()) return resolveToolPath(fallback);
  return defaultWorkspace();
}

export function policyFor(
  env: NodeJS.ProcessEnv = process.env,
  input: {
    sandbox?: Sandbox;
    workspace?: string;
    position?: string;
  } = {},
): HarnessPolicy {
  const sandbox =
    envSandbox(env) ??
    input.sandbox ??
    sandboxFromPosition(input.position ?? "") ??
    "full_access";
  return {
    sandbox,
    workspace: workspaceFromEnv(env, input.workspace),
  };
}

export function policyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fallbackWorkspace?: string,
): HarnessPolicy {
  return policyFor(env, { workspace: fallbackWorkspace });
}

function canonicalize(path: string): string {
  let abs = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(abs);
      return tail.length ? resolve(real, ...tail) : real;
    } catch {
      const parent = dirname(abs);
      if (parent === abs) return tail.length ? resolve(abs, ...tail) : abs;
      tail.unshift(basename(abs));
      abs = parent;
    }
  }
}

export function pathInsideWorkspace(target: string, workspace: string): boolean {
  const rel = relative(canonicalize(workspace), canonicalize(target));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function mutatingTool(name: string): boolean {
  return (
    name === "run" ||
    name === "write" ||
    name === "spawn" ||
    name === "image_gen" ||
    name === "browser" ||
    name.startsWith("mcp__")
  );
}

export function gateTool(
  name: string,
  args: Record<string, unknown>,
  input: {
    sandbox?: Sandbox;
    workspace?: string;
  } = {},
): SandboxRefusal | null {
  const sandbox = parseSandbox(input.sandbox);
  if (sandbox === "full_access") return null;

  if (sandbox === "read_only") {
    if (
      name === "read" ||
      name === "list" ||
      name === "skill" ||
      name === "spawn" ||
      name === "read_spawn"
    ) {
      return null;
    }
    return {
      text: `sandbox=read_only refused ${name}`,
      isError: true,
    };
  }

  // No explicit workspace means the guild checkout, never all of $HOME.
  const workspace = input.workspace?.trim()
    ? resolveToolPath(input.workspace)
    : defaultWorkspace();

  if (name.startsWith("mcp__")) {
    return {
      text: "sandbox=workspace_write refused mcp (unsandboxed child process); use full_access",
      isError: true,
    };
  }

  if (name === "read" || name === "list") {
    const raw = typeof args.path === "string" ? args.path : "";
    if (name === "list" && !raw.trim()) return null;
    const target = resolveToolPath(raw, workspace);
    if (!pathInsideWorkspace(target, workspace)) {
      return {
        text: `sandbox=workspace_write refused ${name} outside workspace: ${target}`,
        isError: true,
      };
    }
    return null;
  }

  if (
    name === "skill" ||
    name === "spawn" ||
    name === "read_spawn"
  ) {
    return null;
  }

  if (name === "write") {
    const raw = typeof args.path === "string" ? args.path : "";
    if (!raw.trim()) return null;
    const target = resolveToolPath(raw, workspace);
    if (!pathInsideWorkspace(target, workspace)) {
      return {
        text: `sandbox=workspace_write refused write outside workspace: ${target}`,
        isError: true,
      };
    }
    return null;
  }

  if (name === "run") {
    const workdir = typeof args.workdir === "string" ? args.workdir.trim() : "";
    const cwd = workdir ? resolveToolPath(workdir, workspace) : workspace;
    if (!pathInsideWorkspace(cwd, workspace)) {
      return {
        text: `sandbox=workspace_write refused run cwd outside workspace: ${cwd}`,
        isError: true,
      };
    }
    return null;
  }

  if (name === "image_gen") {
    return {
      text: "sandbox=workspace_write refused image_gen (writes under GUILD_HOME); use full_access",
      isError: true,
    };
  }

  // browser (CDP into the user's Chrome profile) and anything unnamed: refuse.
  return {
    text: `sandbox=workspace_write refused ${name}; use full_access`,
    isError: true,
  };
}

export type LoopCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type LoopAsk = {
  calls: LoopCall[];
  text: string;
  thinking?: string;
};

export type AgentLoopResult = {
  text: string;
  traces: ToolTrace[];
  thinking: string;
};

const EMPTY_AFTER_TOOLS = "（工具跑完了，但模型沒寫最終回覆）";

/**
 * Shared tool loop (DSH-style). Providers only implement `ask`.
 * Tool execution always goes through executeToolTraced → ctx.tools when dispatched.
 */
export async function runAgentLoop(input: {
  toolCtx: ToolContext;
  traces?: ToolTrace[];
  thinkingChunks?: string[];
  ask: (state: {
    round: number;
    wrap: boolean;
    steer: string | null;
  }) => Promise<LoopAsk | null>;
  onRetry?: (lateSteer: string) => void;
  onTools?: (calls: LoopCall[], outcomes: ToolOutcome[]) => void;
  exhausted?: string;
  emptyAfterTools?: string;
  nullIfNoTraces?: boolean;
}): Promise<AgentLoopResult | null> {
  const {
    executeToolTraced,
    nextToolRound,
    takeSteers,
    throwIfAborted,
    emitProgress,
    TOOL_LOOP_EXHAUSTED,
  } = await import("./tools.ts");
  const traces = input.traces ?? [];
  const thinkingChunks = input.thinkingChunks ?? [];
  const exhausted = input.exhausted ?? TOOL_LOOP_EXHAUSTED;
  const emptyAfterTools = input.emptyAfterTools ?? EMPTY_AFTER_TOOLS;
  const thinkingOf = () => thinkingChunks.join("\n\n");

  for (let round = 0; ; round++) {
    throwIfAborted(input.toolCtx);
    const phase = nextToolRound(round);
    if (phase === "stop") {
      if (!traces.length && input.nullIfNoTraces) return null;
      return { text: exhausted, traces, thinking: thinkingOf() };
    }
    emitProgress(input.toolCtx, traces, thinkingOf());
    const asked = await input.ask({
      round,
      wrap: phase === "wrap",
      steer: takeSteers(input.toolCtx),
    });
    if (!asked) return null;
    if (asked.thinking?.trim()) {
      thinkingChunks.push(asked.thinking.trim());
      emitProgress(input.toolCtx, traces, thinkingOf());
    }
    const thinking = thinkingOf();
    if (!asked.calls.length) {
      const late = takeSteers(input.toolCtx);
      if (late) {
        input.onRetry?.(late);
        continue;
      }
      const text = asked.text.trim();
      if (text) return { text, traces, thinking };
      if (traces.length) return { text: emptyAfterTools, traces, thinking };
      return input.nullIfNoTraces ? null : { text: emptyAfterTools, traces, thinking };
    }
    const outcomes = await Promise.all(
      asked.calls.map((call) =>
        executeToolTraced(
          call.name,
          call.args,
          input.toolCtx,
          traces,
          thinking,
        ),
      ),
    );
    input.onTools?.(asked.calls, outcomes);
  }
}
