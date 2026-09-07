import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Persist only allow. Deny is never written — the next user turn asks again. */
export type ComputerGrantFile = {
  allowed: true;
  at: string;
};

type Waiter = {
  roomId: string;
  botId: string;
  signal?: AbortSignal;
  resolvers: Array<(allow: boolean) => void>;
  onAbort?: () => void;
};

const waiters = new Map<string, Waiter>();
const deniedTurns = new WeakSet<AbortSignal>();

export function computerGrantPath(dataDir: string): string {
  return join(dataDir, "computer.json");
}

export function waiterKey(roomId: string, botId: string): string {
  return `${roomId}\0${botId}`;
}

export function computerAllowed(dataDir: string): boolean {
  const path = computerGrantPath(dataDir);
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      allowed?: unknown;
    };
    return parsed.allowed === true;
  } catch {
    return false;
  }
}

export function persistComputerAllow(dataDir: string): void {
  const path = computerGrantPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const body: ComputerGrantFile = {
    allowed: true,
    at: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}

export function computerDeniedThisTurn(signal?: AbortSignal): boolean {
  return Boolean(signal && deniedTurns.has(signal));
}

export function pendingComputerGrant(roomId: string, botId: string): boolean {
  return waiters.has(waiterKey(roomId, botId));
}

export async function waitComputerGrant(input: {
  dataDir: string;
  roomId?: string;
  botId?: string;
  signal?: AbortSignal;
  onWait?: () => void;
}): Promise<boolean> {
  if (computerAllowed(input.dataDir)) return true;
  if (computerDeniedThisTurn(input.signal)) return false;
  const roomId = input.roomId?.trim() || "";
  const botId = input.botId?.trim() || "";
  if (!roomId || !botId) return false;
  if (input.signal?.aborted) return false;

  const key = waiterKey(roomId, botId);
  const existing = waiters.get(key);
  if (existing) {
    return new Promise((resolve) => {
      existing.resolvers.push(resolve);
    });
  }

  return new Promise((resolve) => {
    const onAbort = () => finishWaiter(key, false);
    const waiter: Waiter = {
      roomId,
      botId,
      signal: input.signal,
      resolvers: [resolve],
      onAbort,
    };
    waiters.set(key, waiter);
    if (input.signal) input.signal.addEventListener("abort", onAbort, { once: true });
    input.onWait?.();
  });
}

function finishWaiter(key: string, allow: boolean): boolean {
  const waiter = waiters.get(key);
  if (!waiter) return false;
  waiters.delete(key);
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
  }
  for (const resolve of waiter.resolvers) resolve(allow);
  return true;
}

export function answerComputerGrant(
  roomId: string,
  botId: string,
  allow: boolean,
  dataDir?: string,
): boolean {
  const key = waiterKey(roomId, botId);
  const waiter = waiters.get(key);
  if (!waiter) return false;
  if (allow) {
    if (dataDir) persistComputerAllow(dataDir);
  } else if (waiter.signal) {
    deniedTurns.add(waiter.signal);
  }
  return finishWaiter(key, allow);
}

export function abortComputerGrant(roomId: string, botId?: string): void {
  const keys = botId
    ? [waiterKey(roomId, botId)]
    : [...waiters.keys()].filter((key) => key.startsWith(`${roomId}\0`));
  for (const key of keys) finishWaiter(key, false);
}
