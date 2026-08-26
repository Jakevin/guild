import type { ChatUsage } from "@guild/protocol";

export function blankUsage(): ChatUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 0,
    costUsd: 0,
    rounds: 0,
    durationMs: 0,
  };
}

export function addUsage(acc: ChatUsage, next?: ChatUsage | null): ChatUsage {
  if (!next) return acc;
  acc.input = (acc.input ?? 0) + (next.input ?? 0);
  acc.output = (acc.output ?? 0) + (next.output ?? 0);
  acc.cacheRead = (acc.cacheRead ?? 0) + (next.cacheRead ?? 0);
  acc.cacheWrite = (acc.cacheWrite ?? 0) + (next.cacheWrite ?? 0);
  acc.reasoning = (acc.reasoning ?? 0) + (next.reasoning ?? 0);
  acc.totalTokens = (acc.totalTokens ?? 0) + (next.totalTokens ?? 0);
  acc.costUsd = (acc.costUsd ?? 0) + (next.costUsd ?? 0);
  acc.rounds = (acc.rounds ?? 0) + (next.rounds ?? 0);
  if (next.provider) acc.provider = next.provider;
  if (next.model) acc.model = next.model;
  return acc;
}

export function fromPiUsage(usage?: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  totalTokens?: number;
  cost?: { total?: number };
} | null): ChatUsage {
  if (!usage) return { rounds: 1 };
  const input = num(usage.input);
  const output = num(usage.output);
  const total =
    num(usage.totalTokens) || (input || 0) + (output || 0) || undefined;
  return {
    input,
    output,
    cacheRead: num(usage.cacheRead),
    cacheWrite: num(usage.cacheWrite),
    reasoning: num(usage.reasoning),
    totalTokens: total,
    costUsd: num(usage.cost?.total),
    rounds: 1,
  };
}

export function fromOpenAiUsage(usage?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | null): ChatUsage {
  if (!usage) return { rounds: 1 };
  const input = num(usage.prompt_tokens);
  const output = num(usage.completion_tokens);
  return {
    input,
    output,
    totalTokens: num(usage.total_tokens) || sum(input, output),
    rounds: 1,
  };
}

export function fromAnthropicUsage(usage?: {
  input_tokens?: number;
  output_tokens?: number;
} | null): ChatUsage {
  if (!usage) return { rounds: 1 };
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  return {
    input,
    output,
    totalTokens: sum(input, output),
    rounds: 1,
  };
}

export function withDuration(usage: ChatUsage, started: number): ChatUsage {
  usage.durationMs = Math.max(0, Date.now() - started);
  return usage;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sum(a?: number, b?: number): number | undefined {
  if (a == null && b == null) return undefined;
  return (a ?? 0) + (b ?? 0);
}
