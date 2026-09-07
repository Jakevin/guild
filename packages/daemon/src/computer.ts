import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { generatedDir, generatedPublicPath } from "./image-gen.ts";
import { computerAllowed, computerDeniedThisTurn } from "./computer-grant.ts";
import type { ToolContext, ToolOutcome } from "./tools.ts";

const execFileAsync = promisify(execFile);
const SOURCE = fileURLToPath(
  new URL("../native/guildmac/main.swift", import.meta.url),
);

const BROWSER_OWNERS = new Set([
  "google chrome",
  "chrome",
  "safari",
  "webkit",
  "microsoft edge",
  "edge",
  "arc",
  "brave browser",
  "brave",
  "chromium",
  "firefox",
  "orion",
]);

export function isBrowserOwnerName(owner: string): boolean {
  const o = owner.trim().toLowerCase();
  if (!o) return false;
  if (BROWSER_OWNERS.has(o)) return true;
  if (/^google chrome\b/.test(o)) return true;
  if (/^microsoft edge\b/.test(o)) return true;
  if (/^brave browser\b/.test(o)) return true;
  if (/^firefox\b/.test(o)) return true;
  return false;
}

export function isBrowserOpenTarget(name: string): boolean {
  const raw = name.trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const leaf = lower.split("/").filter(Boolean).pop() || lower;
  const stem = leaf.replace(/\.app$/, "");
  if (isBrowserOwnerName(stem) || isBrowserOwnerName(leaf)) return true;
  return /(?:^|\/)(?:google chrome|chromium|safari|microsoft edge|brave browser|firefox|orion|arc)(?:\.app)?(?:\/|$)/i.test(
    lower,
  );
}

export function computerToolEnabled(platform = process.platform): boolean {
  return platform === "darwin";
}

export function guildmacBin(dataDir: string): string {
  return join(dataDir, "bin", "guildmac");
}

let compiling: Promise<string> | null = null;

export async function ensureGuildmac(dataDir: string): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("computer is macOS only");
  }
  const bin = guildmacBin(dataDir);
  mkdirSync(dirname(bin), { recursive: true });
  const srcTime = existsSync(SOURCE) ? statSync(SOURCE).mtimeMs : 0;
  const binTime = existsSync(bin) ? statSync(bin).mtimeMs : 0;
  if (binTime && binTime >= srcTime) return bin;
  if (!compiling) {
    compiling = execFileAsync(
      "swiftc",
      ["-O", SOURCE, "-o", bin, "-framework", "ScreenCaptureKit"],
      { timeout: 120_000 },
    )
      .then(() => bin)
      .catch((error) => {
        compiling = null;
        const err = error as { stderr?: string; stdout?: string; message?: string };
        const text = (err.stderr || err.stdout || err.message || "swiftc failed").trim();
        throw new Error(
          `guildmac compile failed (need Xcode Command Line Tools): ${text.slice(0, 800)}`,
        );
      });
  }
  return compiling;
}

async function runMac(
  dataDir: string,
  argv: string[],
  signal?: AbortSignal,
): Promise<{ text: string; code: number }> {
  const bin = await ensureGuildmac(dataDir);
  try {
    const result = await execFileAsync(bin, argv, {
      timeout: 30_000,
      maxBuffer: 2_000_000,
      signal,
    });
    return { text: String(result.stdout || "").trim(), code: 0 };
  } catch (error) {
    const err = error as {
      code?: string | number;
      stdout?: string;
      stderr?: string;
      status?: number;
      killed?: boolean;
      name?: string;
    };
    if (err.name === "AbortError" || signal?.aborted) throw error;
    const text = [err.stderr, err.stdout].filter(Boolean).join("\n").trim();
    const code = typeof err.status === "number" ? err.status : 1;
    return { text: text || String(error), code };
  }
}

function asAction(args: Record<string, unknown>): string {
  return String(args.action || "").trim().toLowerCase();
}

function windowToken(args: Record<string, unknown>): string {
  if (typeof args.window === "string" && args.window.trim()) return args.window.trim();
  if (typeof args.id === "string" && args.id.trim()) return args.id.trim();
  if (typeof args.id === "number" && Number.isFinite(args.id)) return String(args.id);
  return "";
}

export function ownerFromWindowLine(line: string): string {
  return /(?:^|\s)owner=(.+?)(?:\s+on=)/.exec(line)?.[1]?.trim() || "";
}

function isBrowserOwner(line: string): boolean {
  const owner = ownerFromWindowLine(line);
  return isBrowserOwnerName(owner);
}

async function refuseBrowserWindow(
  dataDir: string,
  win: string,
  signal?: AbortSignal,
): Promise<ToolOutcome | null> {
  const listed = await runMac(dataDir, ["windows", win], signal);
  if (listed.code !== 0) {
    return { text: listed.text || "window lookup failed", isError: true };
  }
  if (isBrowserOwner(listed.text)) {
    return {
      text: "computer will not drive a browser window. Use the browser tool (Chrome snapshot profile via CDP).",
      isError: true,
    };
  }
  return null;
}

function dataDirOf(ctx: ToolContext): string {
  return ctx.dataDir?.trim() || computerHome(ctx.env);
}

async function requireGrant(ctx: ToolContext): Promise<ToolOutcome | null> {
  const dataDir = dataDirOf(ctx);
  if (computerAllowed(dataDir)) return null;
  if (computerDeniedThisTurn(ctx.signal)) {
    return {
      text: "computer_refused: the user declined this turn. Do not call computer again until they send another message.",
      isError: true,
    };
  }
  const ask = ctx.askComputer;
  if (!ask) {
    return {
      text: "computer_refused: no live Allow/Deny row (cron/spawn without a hall grant). Allow computer once in the hall, or do not call it here.",
      isError: true,
    };
  }
  const allowed = await ask();
  if (allowed) return null;
  if (ctx.signal?.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }
  return {
    text: "computer_refused: the user declined. Wait for their next message before asking again.",
    isError: true,
  };
}

async function connectCdp(
  port: number,
): Promise<{ ws: WebSocket; send: (method: string, params?: Record<string, unknown>) => Promise<unknown> }> {
  const list = (await fetch(`http://127.0.0.1:${port}/json/list`).then((res) =>
    res.json(),
  )) as { type?: string; webSocketDebuggerUrl?: string }[];
  const page = (Array.isArray(list) ? list : []).find(
    (item) => item.type === "page" && item.webSocketDebuggerUrl,
  );
  const url = page?.webSocketDebuggerUrl;
  if (!url) throw new Error("no page target on that CDP port");
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cdp connect timeout")), 8_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("cdp connect failed"));
    });
  });
  let seq = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (typeof msg.id !== "number") return;
      const wait = pending.get(msg.id);
      if (!wait) return;
      pending.delete(msg.id);
      if (msg.error) wait.reject(new Error(msg.error.message || "cdp error"));
      else wait.resolve(msg.result);
    } catch {
      /* ignore */
    }
  });
  const send = (method: string, params?: Record<string, unknown>) => {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  await send("Page.enable");
  await send("Runtime.enable");
  return { ws, send };
}

async function runCdp(
  args: Record<string, unknown>,
  dataDir: string,
): Promise<ToolOutcome> {
  const port = Number(args.port);
  if (!Number.isFinite(port) || port <= 0) {
    return { text: "computer cdp needs port", isError: true };
  }
  const step = String(args.cdp || args.method || "snapshot").trim().toLowerCase();
  const { ws, send } = await connectCdp(port);
  try {
    if (step === "snapshot") {
      const raw = await send("Runtime.evaluate", {
        expression: `JSON.stringify([...document.querySelectorAll('a,button,input,textarea,[contenteditable],[role=button]')].slice(0,80).map((el,i)=>{el.setAttribute('data-guild-ref','e'+(i+1));return{ref:'e'+(i+1),tag:el.tagName,text:(el.innerText||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').trim().slice(0,80)}}))`,
        returnByValue: true,
      });
      const value = (raw as { result?: { value?: string } })?.result?.value;
      return { text: `cdp snapshot\n${value || "[]"}`, isError: false };
    }
    if (step === "click") {
      const ref = String(args.ref || "").replace(/^@/, "");
      if (!/^e\d+$/.test(ref)) {
        return { text: "cdp click needs ref like e1", isError: true };
      }
      await send("Runtime.evaluate", {
        expression: `document.querySelector('[data-guild-ref="${ref}"]')?.click()`,
      });
      return { text: `cdp clicked @${ref}`, isError: false };
    }
    if (step === "type" || step === "insert") {
      const text = String(args.text || "");
      if (!text) return { text: "cdp type needs text", isError: true };
      await send("Input.insertText", { text });
      return { text: `cdp typed chars=${text.length}`, isError: false };
    }
    if (step === "shot") {
      const cap = (await send("Page.captureScreenshot", {
        format: "png",
      })) as { data?: string };
      if (!cap?.data) return { text: "cdp shot failed", isError: true };
      const { writeFileSync } = await import("node:fs");
      const name = `computer-${Date.now()}.png`;
      const abs = join(generatedDir(dataDir), name);
      mkdirSync(generatedDir(dataDir), { recursive: true });
      writeFileSync(abs, Buffer.from(cap.data, "base64"));
      return {
        text: `cdp shot\n![page](${generatedPublicPath(name)})`,
        isError: false,
      };
    }
    return { text: `unknown cdp step: ${step}`, isError: true };
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}

export async function runComputer(
  args: Record<string, unknown>,
  ctx: ToolContext = {},
): Promise<ToolOutcome> {
  if (!computerToolEnabled()) {
    return { text: "computer is macOS only", isError: true };
  }
  const denied = await requireGrant(ctx);
  if (denied) return denied;
  const dataDir = dataDirOf(ctx);
  const action = asAction(args);
  if (!action) {
    return {
      text: "computer needs action: windows | shot | see | idle | open | op | ax | axset | hud | cdp",
      isError: true,
    };
  }
  if (action === "cdp") return runCdp(args, dataDir);

  if (action === "windows") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const ran = await runMac(dataDir, query ? ["windows", query] : ["windows"], ctx.signal);
    return { text: ran.text || "none", isError: ran.code !== 0 };
  }
  if (action === "idle") {
    const ran = await runMac(dataDir, ["idle"], ctx.signal);
    return { text: ran.text, isError: ran.code !== 0 };
  }
  if (action === "open") {
    const name =
      (typeof args.app === "string" && args.app.trim()) ||
      (typeof args.path === "string" && args.path.trim()) ||
      (typeof args.query === "string" && args.query.trim()) ||
      "";
    if (!name) return { text: "computer open needs app", isError: true };
    if (isBrowserOpenTarget(name)) {
      return {
        text: "computer will not open a browser. Use the browser tool.",
        isError: true,
      };
    }
    const argv = ["open", name];
    const port = Number(args.port);
    if (Number.isFinite(port) && port > 0) argv.push("--cdp", String(port));
    const ran = await runMac(dataDir, argv, ctx.signal);
    return { text: ran.text, isError: ran.code !== 0 };
  }
  if (action === "shot" || action === "see") {
    const win = windowToken(args);
    if (!win) return { text: `computer ${action} needs window`, isError: true };
    mkdirSync(generatedDir(dataDir), { recursive: true });
    const name = `computer-${Date.now()}.png`;
    const abs = join(generatedDir(dataDir), name);
    const ran = await runMac(dataDir, [action, win, abs], ctx.signal);
    if (ran.code !== 0) return { text: ran.text, isError: true };
    return {
      text: `${ran.text}\n![window](${generatedPublicPath(name)})`,
      isError: false,
    };
  }
  if (action === "ax") {
    const win = windowToken(args);
    if (!win) return { text: "computer ax needs window", isError: true };
    const ran = await runMac(dataDir, ["ax", win], ctx.signal);
    return { text: ran.text, isError: ran.code !== 0 };
  }
  if (action === "axset") {
    const win = windowToken(args);
    const ref = String(args.ref || "").replace(/^@/, "").trim();
    const text = typeof args.text === "string" ? args.text : "";
    if (!win || !/^e\d+$/.test(ref)) {
      return { text: "computer axset needs window and ref like e1", isError: true };
    }
    const blocked = await refuseBrowserWindow(dataDir, win, ctx.signal);
    if (blocked) return blocked;
    const ran = await runMac(dataDir, ["axset", win, ref, text], ctx.signal);
    return { text: ran.text, isError: ran.code !== 0 };
  }
  if (action === "hud") {
    const ms = Number(args.ms);
    const argv = Number.isFinite(ms) && ms > 0 ? ["hud", String(ms)] : ["hud"];
    const ran = await runMac(dataDir, argv, ctx.signal);
    return { text: ran.text, isError: ran.code !== 0 };
  }
  if (action === "op" || action === "click" || action === "type") {
    const win = windowToken(args);
    if (!win) return { text: "computer op needs window", isError: true };
    const blocked = await refuseBrowserWindow(dataDir, win, ctx.signal);
    if (blocked) return blocked;
    const text = typeof args.text === "string" ? args.text : "";
    const x = Number(args.x);
    const y = Number(args.y);
    const focus =
      args.focus === true || args.focus === "true" || args.focus === 1;
    const wantClick = action === "op" || action === "click" || Number.isFinite(x);
    if (wantClick && (!Number.isFinite(x) || !Number.isFinite(y))) {
      return { text: "computer op needs x and y (window-local points)", isError: true };
    }
    if (wantClick) {
      const argv = ["click", win, String(x), String(y)];
      if (focus) argv.push("--focus");
      const click = await runMac(dataDir, argv, ctx.signal);
      if (click.code !== 0) {
        return {
          text: click.text || "click refused",
          isError: true,
        };
      }
      if (!text) return { text: click.text, isError: false };
    }
    if (text) {
      const argv = ["type", win, text];
      if (focus) argv.push("--focus");
      const typed = await runMac(dataDir, argv, ctx.signal);
      return { text: typed.text, isError: typed.code !== 0 };
    }
    return { text: "computer op needs x/y or text", isError: true };
  }
  return { text: `unknown computer action: ${action}`, isError: true };
}

export function computerHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.GUILD_HOME?.trim() || join(homedir(), ".guild");
}
