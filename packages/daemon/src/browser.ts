import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromeBinary, freePort } from "./chrome-launch.ts";
import { generatedDir, generatedPublicPath } from "./image-gen.ts";
import { defaultDataDir } from "./store.ts";
import type { ToolOutcome } from "./tools.ts";

export { chromeBinary };

/**
 * Real-profile browsing follows Hermes (nousresearch/hermes-agent
 * hermes_cli/browser_connect.py): never CDP the live profile (Chrome 136+).
 * Snapshot last_used auth into ~/.guild/browser-profile/chrome, drive the copy.
 * On by default (GUILD_BROWSER_REAL_PROFILE=1). Set 0 for throwaway; turning off deletes the snapshot.
 */
export const SNAPSHOT_DONE_MARKER = ".guild-snapshot-complete";

const AUTH_REFRESH = [
  "Cookies",
  "Network/Cookies",
  "Login Data",
  "Login Data For Account",
  "Web Data",
  "Preferences",
];

const SQLITE_AUTH_DBS = new Set([
  "Cookies",
  "Login Data",
  "Login Data For Account",
  "Web Data",
]);

const EXACT_TREE_IGNORE = new Set([
  "Extensions",
  "Local Extension Settings",
  "Service Worker",
  "IndexedDB",
  "Crash Reports",
  "Crashpad",
  "Snapshots",
  "optimization_guide_model_store",
  "Safe Browsing",
  "SafetyTips",
  "OnDeviceHeadSuggestModel",
  "segmentation_platform",
  "Sync Data",
  "Shared Dictionary",
  "RunningChromeVersion",
  "SingletonSocket",
  "BrowserMetrics-spare.pma",
  ...SQLITE_AUTH_DBS,
]);

export type BrowserAction =
  | "open"
  | "snapshot"
  | "click"
  | "type"
  | "press"
  | "screenshot"
  | "close";

type Session = {
  proc: ChildProcess;
  port: number;
  userDataDir: string;
  real: boolean;
  ws: WebSocket;
  seq: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>;
};

let session: Session | null = null;

export function realProfileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.GUILD_BROWSER_REAL_PROFILE ?? "1").trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

export function chromeUserDataDir(home = homedir(), platform = process.platform): string {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Google", "Chrome");
  }
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return join(local, "Google", "Chrome", "User Data");
  }
  return join(home, ".config", "google-chrome");
}

export function lastUsedProfile(userDataDir: string): string {
  let name = "Default";
  const path = join(userDataDir, "Local State");
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as {
        profile?: { last_used?: string };
      };
      const raw = parsed.profile?.last_used;
      if (typeof raw === "string" && raw.trim()) name = raw.trim();
    } catch {
      name = "Default";
    }
  }
  return isDir(join(userDataDir, name)) ? name : "Default";
}

export function snapshotDir(dataDir: string): string {
  return join(dataDir, "browser-profile", "chrome");
}

export function ephemeralDir(dataDir: string): string {
  return join(dataDir, "browser-ephemeral");
}

export function cleanupRealProfileSnapshots(dataDir: string): void {
  const root = join(dataDir, "browser-profile");
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function snapshotIgnore(name: string): boolean {
  if (EXACT_TREE_IGNORE.has(name)) return true;
  if (name.includes("Cache")) return true;
  if (name.startsWith("Extension")) return true;
  if (name.startsWith("BrowserMetrics")) return true;
  if (name.startsWith("OptimizationGuide")) return true;
  if (name.startsWith("History")) return true;
  if (name.startsWith("Favicons")) return true;
  if (name.startsWith("Singleton")) return true;
  return (
    name.endsWith(".tmp") ||
    name.endsWith("-journal") ||
    name.endsWith("-wal") ||
    name.endsWith("-shm")
  );
}

function stripSqliteSidecars(file: string): void {
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    rmSync(`${file}${suffix}`, { force: true });
  }
}

function secureSnapshotRoot(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
    chmodSync(path, 0o700);
  } catch {
    /* Windows / best-effort */
  }
}

function sqlPath(path: string): string {
  return `'${path.replaceAll("'", "''")}'`;
}

export function copyAuthFile(srcFile: string, destFile: string): boolean {
  mkdirSync(dirname(destFile), { recursive: true });
  if (SQLITE_AUTH_DBS.has(basename(srcFile))) {
    try {
      if (existsSync(destFile)) rmSync(destFile, { force: true });
      const source = new DatabaseSync(srcFile, { readOnly: true, timeout: 5000 });
      try {
        source.exec(`VACUUM INTO ${sqlPath(destFile)}`);
      } finally {
        source.close();
      }
      stripSqliteSidecars(destFile);
      return true;
    } catch {
      /* raw copy — text fixtures and non-DB files */
    }
  }
  try {
    cpSync(srcFile, destFile, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Overlay last_used auth into the copy's Default. Returns how many SQLite DBs failed. */
export function copyAuthProfile(srcProfile: string, destProfile: string): number {
  mkdirSync(destProfile, { recursive: true });
  let failedDbs = 0;
  for (const rel of AUTH_REFRESH) {
    const from = join(srcProfile, ...rel.split("/"));
    if (!isFile(from)) continue;
    const ok = copyAuthFile(from, join(destProfile, ...rel.split("/")));
    if (!ok && SQLITE_AUTH_DBS.has(basename(from))) failedDbs += 1;
  }
  return failedDbs;
}

function copyProfileTree(srcProfile: string, destProfile: string): void {
  mkdirSync(destProfile, { recursive: true });
  cpSync(srcProfile, destProfile, {
    recursive: true,
    force: true,
    filter: (from) => from === srcProfile || !snapshotIgnore(basename(from)),
  });
}

function cookieDb(src: string, sourceProfile: string): string | null {
  for (const rel of ["Network/Cookies", "Cookies"]) {
    const candidate = join(src, sourceProfile, ...rel.split("/"));
    if (isFile(candidate)) return candidate;
  }
  return null;
}

export function profileIsLocked(src: string, sourceProfile: string): boolean {
  const db = cookieDb(src, sourceProfile);
  if (!db) return false;
  try {
    const fd = openSync(db, "r");
    closeSync(fd);
    return false;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    return code === "EPERM" || code === "EACCES";
  }
}

function pinLocalStateDefault(root: string, srcLocalState: string): void {
  let parsed: Record<string, unknown> = {};
  if (isFile(srcLocalState)) {
    try {
      parsed = JSON.parse(readFileSync(srcLocalState, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      parsed = {};
    }
  }
  const profile =
    parsed.profile && typeof parsed.profile === "object"
      ? (parsed.profile as Record<string, unknown>)
      : {};
  profile.last_used = "Default";
  parsed.profile = profile;
  writeFileSync(join(root, "Local State"), `${JSON.stringify(parsed)}\n`);
}

export function syncRealProfile(
  dataDir: string,
  home = homedir(),
  platform = process.platform,
): string {
  const userData = chromeUserDataDir(home, platform);
  if (!isDir(userData)) {
    throw new Error(`no Chrome user-data dir at ${userData}`);
  }
  const leaf = lastUsedProfile(userData);
  const srcProfile = join(userData, leaf);
  if (!isDir(srcProfile)) {
    throw new Error(`Chrome profile "${leaf}" not found under ${userData}`);
  }
  if (profileIsLocked(userData, leaf)) {
    throw new Error(
      "Chrome is running and has its profile locked, so login data can't be copied. Fully quit the browser (including any background/tray instance) and retry, or set GUILD_BROWSER_REAL_PROFILE=0.",
    );
  }
  const root = snapshotDir(dataDir);
  const dest = join(root, "Default");
  const parent = dirname(root);
  mkdirSync(root, { recursive: true });
  secureSnapshotRoot(parent);
  secureSnapshotRoot(root);
  pinLocalStateDefault(root, join(userData, "Local State"));
  const marker = join(root, SNAPSHOT_DONE_MARKER);
  const populated = isFile(marker);
  if (!populated) {
    rmSync(dest, { recursive: true, force: true });
    try {
      copyProfileTree(srcProfile, dest);
    } catch {
      /* per-file skip is non-fatal; auth overlay is the source of truth */
    }
  }
  const failedDbs = copyAuthProfile(srcProfile, dest);
  if (failedDbs) {
    throw new Error(
      `could not read the Chrome profile's login data (${failedDbs} database(s) locked). Close Chrome and retry, or set GUILD_BROWSER_REAL_PROFILE=0.`,
    );
  }
  for (const leftover of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    rmSync(join(root, leftover), { force: true });
  }
  writeFileSync(marker, `${leaf}\n`);
  return root;
}

async function waitJson(url: string, ms = 20_000): Promise<unknown> {
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

function sendCdp(sess: Session, method: string, params?: Record<string, unknown>): Promise<unknown> {
  const id = ++sess.seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sess.pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 25_000);
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
    sess.ws.send(JSON.stringify({ id, method, params }));
  });
}

async function attachPage(sess: Session): Promise<void> {
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
}

function openWs(sess: Session, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    sess.ws = ws;
    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          id?: number;
          error?: { message?: string };
          result?: unknown;
        };
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
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
  });
}

async function launchChrome(dataDir: string, env: NodeJS.ProcessEnv): Promise<Session> {
  const bin = chromeBinary();
  if (!bin) throw new Error("Chrome / Chromium / Edge / Brave not found");
  const real = realProfileEnabled(env);
  if (!real) cleanupRealProfileSnapshots(dataDir);
  const userDataDir = real ? syncRealProfile(dataDir) : ephemeralDir(dataDir);
  mkdirSync(userDataDir, { recursive: true });
  const port = await freePort();
  const args = [
    `--remote-debugging-port=${port}`,
    `--remote-debugging-address=127.0.0.1`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
  ];
  if (real) args.push("--profile-directory=Default");
  const proc = spawn(bin, args, {
    stdio: "ignore",
    detached: false,
  });
  const sess: Session = {
    proc,
    port,
    userDataDir,
    real,
    ws: null as unknown as WebSocket,
    seq: 0,
    pending: new Map(),
  };
  try {
    await waitJson(`http://127.0.0.1:${port}/json/version`, 20_000);
    await attachPage(sess);
  } catch (error) {
    proc.kill("SIGTERM");
    throw error;
  }
  session = sess;
  return sess;
}

export async function closeBrowser(): Promise<void> {
  const sess = session;
  session = null;
  if (!sess) return;
  try {
    sess.ws.close();
  } catch {
    /* ignore */
  }
  try {
    sess.proc.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

async function ensureSession(dataDir: string, env: NodeJS.ProcessEnv): Promise<Session> {
  const wantReal = realProfileEnabled(env);
  if (session && session.real === wantReal && session.proc.exitCode === null) {
    return session;
  }
  await closeBrowser();
  return launchChrome(dataDir, env);
}

type AxNode = {
  ref: string;
  tag: string;
  role?: string;
  name: string;
  href?: string;
};

const SNAPSHOT_JS = `(() => {
  const els = [...document.querySelectorAll("a, button, input, textarea, select, [role='button'], [role='link'], [contenteditable='true']")];
  return els.slice(0, 80).map((el, i) => {
    const ref = "e" + (i + 1);
    el.setAttribute("data-guild-ref", ref);
    const name = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    return {
      ref: "@" + ref,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || undefined,
      name,
      href: el.href || undefined,
    };
  });
})()`;

async function evaluate<T>(sess: Session, expression: string): Promise<T> {
  const result = (await sendCdp(sess, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: T; description?: string }; exceptionDetails?: { text?: string } };
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "page JS error");
  }
  return result.result?.value as T;
}

async function snapshotText(sess: Session): Promise<string> {
  const url = await evaluate<string>(sess, "location.href");
  const title = await evaluate<string>(sess, "document.title");
  const nodes = (await evaluate<AxNode[]>(sess, SNAPSHOT_JS)) || [];
  const lines = nodes.map((node) => {
    const extra = node.href ? ` ${node.href}` : "";
    return `${node.ref} <${node.tag}> ${node.name}${extra}`.trim();
  });
  return [`${title} — ${url}`, ...lines].join("\n") || "(empty page)";
}

function parseRef(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

export async function runBrowser(
  args: Record<string, unknown>,
  input: {
    dataDir?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  } = {},
): Promise<ToolOutcome> {
  if (input.signal?.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }
  const env = input.env ?? process.env;
  const dataDir = input.dataDir ?? defaultDataDir(env);
  const action = String(args.action || args.command || "snapshot").trim().toLowerCase() as BrowserAction;
  const onAbort = () => {
    closeBrowser().catch(() => {});
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (action === "close") {
      await closeBrowser();
      return { text: "browser closed" };
    }
    const sess = await ensureSession(dataDir, env);
    const mode = sess.real ? "real-profile" : "ephemeral";
    if (action === "open" || action === "navigate") {
      const url = String(args.url || "").trim();
      if (!url) return { text: "browser open needs a url", isError: true };
      await sendCdp(sess, "Page.navigate", { url });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try {
        await attachPage(sess);
      } catch {
        /* keep existing ws */
      }
      const snap = await snapshotText(sess);
      return { text: `[${mode}]\n${snap}` };
    }
    if (action === "snapshot") {
      const snap = await snapshotText(sess);
      return { text: `[${mode}]\n${snap}` };
    }
    if (action === "click") {
      const ref = parseRef(String(args.ref || ""));
      if (!ref) return { text: "browser click needs ref like @e1", isError: true };
      await evaluate(sess, `document.querySelector('[data-guild-ref="${ref}"]')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const snap = await snapshotText(sess);
      return { text: `[${mode}] clicked @${ref}\n${snap}` };
    }
    if (action === "type") {
      const ref = parseRef(String(args.ref || ""));
      const text = String(args.text ?? "");
      if (!ref) return { text: "browser type needs ref like @e1", isError: true };
      const js = `(() => {
        const el = document.querySelector('[data-guild-ref="${ref}"]');
        if (!el) return "missing";
        el.focus();
        if ("value" in el) el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return "ok";
      })()`;
      const status = await evaluate<string>(sess, js);
      if (status === "missing") return { text: `no element @${ref}`, isError: true };
      return { text: `[${mode}] typed into @${ref}` };
    }
    if (action === "press") {
      const key = String(args.text || args.key || "Enter");
      await sendCdp(sess, "Input.dispatchKeyEvent", { type: "keyDown", key });
      await sendCdp(sess, "Input.dispatchKeyEvent", { type: "keyUp", key });
      return { text: `[${mode}] pressed ${key}` };
    }
    if (action === "screenshot") {
      const result = (await sendCdp(sess, "Page.captureScreenshot", {
        format: "png",
      })) as { data?: string };
      if (!result.data) return { text: "screenshot failed", isError: true };
      const name = `${randomUUID()}.png`;
      const dir = generatedDir(dataDir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), Buffer.from(result.data, "base64"));
      const publicPath = generatedPublicPath(name);
      return { text: `[${mode}] screenshot\n![page](${publicPath})` };
    }
    return { text: `unknown browser action: ${action}`, isError: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    const text = error instanceof Error ? error.message : String(error);
    return { text, isError: true };
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
  }
}

export function resetBrowserForTests(): void {
  session = null;
}
