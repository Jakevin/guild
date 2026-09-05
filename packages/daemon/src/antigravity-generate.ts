/**
 * Spawn official `agy` stream-json for a hall turn.
 * agy owns tools on this seat. User Stop is ctx.signal (AbortError).
 * No wall-clock turn fuse — do not copy the bridge's 600s timer.
 */
import { spawn } from "node:child_process";
import {
  agyModelId,
  effortFromAgyId,
  resolveAgyPath,
} from "./antigravity.ts";
import { defaultWorkspace, parseSandbox } from "./harness.ts";
import {
  emitProgress,
  throwIfAborted,
  type ToolContext,
  type ToolTrace,
} from "./tools.ts";

export type AgyEvent =
  | { kind: "init"; conversationId?: string; raw?: unknown }
  | { kind: "step"; step: Record<string, unknown>; raw?: unknown }
  | { kind: "result"; result: Record<string, unknown>; raw?: unknown }
  | { kind: "unknown"; raw?: unknown };

export type AgyTurnResult = {
  text: string;
};

export type AgySpawnTurnInput = {
  agyPath: string;
  cwd: string;
  model: string;
  prompt: string;
  mode: "accept-edits" | "plan";
  skipPermissions: boolean;
  /** agy `--sandbox`: terminal restrictions. Used for Guild workspace_write. */
  terminalSandbox: boolean;
  effort: "low" | "medium" | "high";
  signal?: AbortSignal;
  onEvent?: (event: AgyEvent) => void;
};

type GenerateHooks = {
  spawnTurn?: (input: AgySpawnTurnInput) => Promise<AgyTurnResult>;
};

let hooks: GenerateHooks = {};

export function setAntigravityGenerateHooksForTest(next?: GenerateHooks): void {
  hooks = next ?? {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

export function parseAgyLine(line: string): AgyEvent {
  try {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value)) return { kind: "unknown", raw: value };
    if (value.event === "init") {
      return {
        kind: "init",
        raw: value,
        conversationId: typeof value.conversation_id === "string" ? value.conversation_id : undefined,
      };
    }
    if (value.event === "step_update") {
      return {
        kind: "step",
        raw: value,
        step: isRecord(value.step_update) ? value.step_update : {},
      };
    }
    if (value.event === "result") {
      return {
        kind: "result",
        raw: value,
        result: isRecord(value.result) ? value.result : {},
      };
    }
    return { kind: "unknown", raw: value };
  } catch {
    return { kind: "unknown", raw: line };
  }
}

export function buildAgyChatPrompt(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
): string {
  const blocks: string[] = [];
  const sys = system.trim();
  if (sys) blocks.push(`System instructions:\n${sys}`);
  for (const item of messages) {
    const label = item.role === "assistant" ? "Assistant" : "User";
    blocks.push(`${label}:\n${item.content}`);
  }
  return blocks.join("\n\n");
}

export function agyModeForSandbox(sandbox: unknown): {
  mode: "accept-edits" | "plan";
  skipPermissions: boolean;
  terminalSandbox: boolean;
} {
  const parsed = parseSandbox(sandbox);
  if (parsed === "read_only") {
    return { mode: "plan", skipPermissions: false, terminalSandbox: false };
  }
  // Print mode cannot prompt. Skip confirmations for seats Guild already
  // allowed to run tools. workspace_write also sets agy --sandbox.
  if (parsed === "workspace_write") {
    return { mode: "accept-edits", skipPermissions: true, terminalSandbox: true };
  }
  return { mode: "accept-edits", skipPermissions: true, terminalSandbox: false };
}

function resultText(result: Record<string, unknown> | undefined): string {
  if (!result) return "";
  if (typeof result.response === "string") return result.response;
  if (typeof result.text === "string") return result.text;
  if (typeof result.message === "string") return result.message;
  if (typeof result.output === "string") return result.output;
  return "";
}

function kill(child: ReturnType<typeof spawn> | undefined): void {
  if (!child || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}

function spawnAgyTurn(input: AgySpawnTurnInput): Promise<AgyTurnResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--model",
      agyModelId(input.model),
      "--mode",
      input.mode,
    ];
    if (input.skipPermissions) args.push("--dangerously-skip-permissions");
    if (input.terminalSandbox) args.push("--sandbox");
    if (input.mode !== "plan") args.push("--disable-slash-commands");
    args.push("--effort", input.effort);
    if (input.cwd.trim()) args.push("--add-dir", input.cwd);

    let child: ReturnType<typeof spawn> | undefined;
    try {
      child = spawn(input.agyPath, args, {
        cwd: input.cwd || undefined,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      reject(
        new Error(
          `cannot start ${input.agyPath}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }

    let stdoutBuffer = "";
    let stderr = "";
    let result: Record<string, unknown> | undefined;
    let settled = false;

    const cleanup = () => {
      input.signal?.removeEventListener("abort", onAbort);
    };
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      kill(child);
      reject(error);
    };
    const finishSuccess = (value: AgyTurnResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      kill(child);
      resolve(value);
    };
    const onAbort = () => finishError(abortError());

    const handleLine = (line: string) => {
      const parsed = parseAgyLine(line);
      try {
        input.onEvent?.(parsed);
      } catch (error) {
        finishError(error instanceof Error ? error : new Error(String(error)));
        return false;
      }
      if (parsed.kind === "result") {
        result = parsed.result;
        const status = typeof result.status === "string" ? result.status : "";
        if (status && status !== "SUCCESS" && status !== "OK") {
          const detail =
            (typeof result.error === "string" && result.error) ||
            `AGY returned ${status}`;
          finishError(new Error(detail));
          return false;
        }
        finishSuccess({ text: resultText(result) });
        return false;
      }
      return true;
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!handleLine(line)) return;
        newline = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.once("error", (error) => {
      finishError(new Error(`AGY process failed: ${error.message}`));
    });
    child.once("close", (code, closeSignal) => {
      if (settled) return;
      if (input.signal?.aborted) {
        finishError(abortError());
        return;
      }
      if (stdoutBuffer.trim()) {
        if (!handleLine(stdoutBuffer.trim())) return;
      }
      const detail = stderr.trim().split("\n").slice(-3).join(" ");
      finishError(
        new Error(
          `AGY exited before returning a result (${code ?? closeSignal ?? "signal"})${detail ? `: ${detail}` : ""}`,
        ),
      );
    });

    if (input.signal?.aborted) {
      onAbort();
      return;
    }
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdin?.once("error", (error) => {
      finishError(new Error(`Cannot send prompt to AGY: ${error.message}`));
    });
    child.stdin?.write(
      `${JSON.stringify({ event: "user", message: { role: "user", content: input.prompt } })}\n`,
    );
  });
}

function stepTrace(step: Record<string, unknown>): ToolTrace {
  const name = String(step.kind || step.tool || step.name || "step");
  const text = String(step.text_delta || step.text || step.message || "");
  return { name, args: {}, text, isError: false };
}

export async function completeAntigravity(input: {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  ctx?: ToolContext;
}): Promise<{ text: string; traces: ToolTrace[]; thinking: string }> {
  const ctx = input.ctx ?? {};
  throwIfAborted(ctx);
  const prompt = buildAgyChatPrompt(input.system, input.messages);
  const { mode, skipPermissions, terminalSandbox } = agyModeForSandbox(ctx.sandbox);
  const traces: ToolTrace[] = [];
  let thinking = "";
  let streamedText = "";
  const spawnTurn = hooks.spawnTurn ?? spawnAgyTurn;
  const done = await spawnTurn({
    agyPath: resolveAgyPath(),
    cwd: ctx.workspace || defaultWorkspace(),
    model: input.model,
    prompt,
    mode,
    skipPermissions,
    terminalSandbox,
    effort: effortFromAgyId(input.model),
    signal: ctx.signal,
    onEvent: (event) => {
      if (event.kind === "step") {
        const trace = stepTrace(event.step);
        traces.push(trace);
        if (trace.name === "think" || trace.name === "thinking") {
          thinking += trace.text;
        }
        emitProgress(ctx, traces, thinking);
      }
      if (event.kind === "result") {
        streamedText = resultText(event.result) || streamedText;
      }
    },
  });
  throwIfAborted(ctx);
  return {
    text: done.text || streamedText,
    traces,
    thinking,
  };
}
