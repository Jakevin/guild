import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

/** Default timeout in ms for Runtime.evaluate and Input.*. */
export const CDP_EVAL_TIMEOUT_MS = 10_000;

export type ChromeProc = {
  exitCode: number | null;
  signalCode?: NodeJS.Signals | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once: (event: "exit", listener: (...args: unknown[]) => void) => unknown;
};

export type ChromeSession = {
  proc: ChromeProc;
  port: number;
  userDataDir: string;
  ws: WebSocket;
  seq: number;
  pending: Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >;
  onDisconnect?: () => void;
  targetGone?: boolean;
};

export function chromeBinaryCandidates(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || "";
    return [
      join(local, "Google", "Chrome", "Application", "chrome.exe"),
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/brave-browser",
    "/usr/bin/brave",
  ];
}

export function chromeBinary(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return chromeBinaryCandidates(platform, env).find((path) => existsSync(path)) ?? null;
}

export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const address = probe.address();
  const port = address && typeof address === "object" ? address.port : 18742;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

export function chromeLaunchArgs(port: number, userDataDir: string): string[] {
  return [
    `--remote-debugging-port=${port}`,
    `--remote-debugging-address=127.0.0.1`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
  ];
}

export async function sendCdp(
  sess: ChromeSession,
  method: string,
  params?: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<unknown> {
  const timeoutMs = opts?.timeoutMs ?? CDP_EVAL_TIMEOUT_MS;
  const id = ++sess.seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sess.pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, timeoutMs);
    sess.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    try {
      sess.ws.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      clearTimeout(timer);
      sess.pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function evaluateCdp<T>(
  sess: ChromeSession,
  expression: string,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const result = (await sendCdp(
    sess,
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
    },
    opts,
  )) as {
    result?: { value?: T };
    exceptionDetails?: { text?: string };
  };
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "page JS error");
  }
  return result.result?.value as T;
}

export async function waitJson(url: string, ms = 20_000): Promise<unknown> {
  const deadline = Date.now() + ms;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Chrome DevTools did not come up: ${last}`);
}

function noteDisconnect(sess: ChromeSession): void {
  sess.targetGone = true;
  try {
    sess.onDisconnect?.();
  } catch {
    /* ignore */
  }
}

function openWs(sess: ChromeSession, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    sess.ws = ws;
    sess.targetGone = false;
    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          id?: number;
          method?: string;
          error?: { message?: string };
          result?: unknown;
        };
        if (
          msg.method === "Inspector.detached" ||
          msg.method === "Target.detachedFromTarget" ||
          msg.method === "Target.targetDestroyed"
        ) {
          noteDisconnect(sess);
        }
        if (typeof msg.id !== "number") return;
        const wait = sess.pending.get(msg.id);
        if (!wait) return;
        sess.pending.delete(msg.id);
        if (msg.error) wait.reject(new Error(msg.error.message || "CDP error"));
        else wait.resolve(msg.result);
      } catch {
        /* ignore */
      }
    });
    ws.addEventListener("close", () => noteDisconnect(sess));
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
  });
}

export async function attachPage(sess: ChromeSession): Promise<void> {
  const list = (await waitJson(`http://127.0.0.1:${sess.port}/json/list`, 8_000)) as {
    type?: string;
    webSocketDebuggerUrl?: string;
  }[];
  const page = (Array.isArray(list) ? list : []).find(
    (item) => item.type === "page" && item.webSocketDebuggerUrl,
  );
  const url = page?.webSocketDebuggerUrl;
  if (!url) throw new Error("Chrome has no page target for CDP");
  if (sess.ws && sess.ws.readyState === WebSocket.OPEN) {
    try {
      sess.ws.close();
    } catch {
      /* ignore */
    }
  }
  await openWs(sess, url);
  await sendCdp(sess, "Page.enable");
  await sendCdp(sess, "Runtime.enable");
  try {
    await sendCdp(sess, "Network.enable");
  } catch {
    /* optional for cookie smoke */
  }
}

export async function launchChromium(userDataDir: string): Promise<ChromeSession> {
  const bin = chromeBinary();
  if (!bin) throw new Error("freebuff_no_browser");
  const port = await freePort();
  const args = chromeLaunchArgs(port, userDataDir);
  const proc = spawn(bin, args, {
    stdio: "ignore",
    detached: false,
  });
  const sess: ChromeSession = {
    proc,
    port,
    userDataDir,
    ws: null as unknown as WebSocket,
    seq: 0,
    pending: new Map(),
  };
  try {
    await waitJson(`http://127.0.0.1:${port}/json/version`, 20_000);
    await attachPage(sess);
  } catch (error) {
    await closeChromium(sess);
    throw error;
  }
  return sess;
}

export async function tryMinimizeWindow(sess: ChromeSession): Promise<boolean> {
  try {
    const win = (await sendCdp(sess, "Browser.getWindowForTarget", {})) as {
      windowId?: number;
    };
    if (typeof win?.windowId !== "number") return false;
    await sendCdp(sess, "Browser.setWindowBounds", {
      windowId: win.windowId,
      bounds: { windowState: "minimized" },
    });
    return true;
  } catch {
    return false;
  }
}

export function chromeProcessAlive(sess: ChromeSession | null): boolean {
  if (!sess) return false;
  return sess.proc.exitCode === null && (sess.proc.signalCode ?? null) == null;
}

async function waitForProcExit(proc: ChromeProc, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode !== null) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      resolve(exited);
    };
    const timer = setTimeout(() => finish(proc.exitCode !== null), timeoutMs);
    try {
      proc.once("exit", () => {
        clearTimeout(timer);
        finish(true);
      });
    } catch {
      clearTimeout(timer);
      finish(proc.exitCode !== null);
      return;
    }
    if (proc.exitCode !== null) {
      clearTimeout(timer);
      finish(true);
    }
  });
}

export async function closeChromium(
  sess: ChromeSession | null,
  opts?: { termMs?: number; killMs?: number },
): Promise<void> {
  if (!sess) return;
  try {
    if (sess.ws && typeof sess.ws.close === "function") sess.ws.close();
  } catch {
    /* ignore */
  }
  if (sess.proc.exitCode !== null) return;
  const termMs = opts?.termMs ?? 2_000;
  const killMs = opts?.killMs ?? 2_000;
  const termWait = waitForProcExit(sess.proc, termMs);
  try {
    sess.proc.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  if (await termWait) return;
  const killWait = waitForProcExit(sess.proc, killMs);
  try {
    sess.proc.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  await killWait;
}

