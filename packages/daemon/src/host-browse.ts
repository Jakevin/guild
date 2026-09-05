import { execFile } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { StoreError } from "./store.ts";

const execFileAsync = promisify(execFile);
const HOME = homedir();
const LS_CAP = 200;
const READ_CAP = 48_000;
const GIT_CAP = 12_000;
const TREE_CAP = 8_000;

export type HostEntry = {
  name: string;
  kind: "file" | "dir" | "link";
  size?: number;
};

function resolveUserPath(input: string): string {
  const trimmed = String(input || "~").trim() || "~";
  if (trimmed === "~") return HOME;
  if (trimmed.startsWith("~/")) return resolve(HOME, trimmed.slice(2));
  if (trimmed.startsWith("/")) return resolve(trimmed);
  return resolve(HOME, trimmed);
}

/** Guild data dirs: `~/.guild` plus an explicit `GUILD_HOME` if set. */
function guildHomes(): string[] {
  const homes = [join(HOME, ".guild")];
  const extra = process.env.GUILD_HOME?.trim();
  if (extra) homes.push(resolveUserPath(extra));
  return homes;
}

const SSH_DIR = join(HOME, ".ssh");
/** Files whose *contents* are credentials, wherever the guild home lives. */
const SECRET_GUILD_FILES = new Set([
  "oauth.json",
  "models.json",
  "mcp.json",
  "freebuff.json",
  "commandcode.json",
  "commandcode-models.json",
]);
/** Credential dotfiles that live directly in `$HOME`. */
const SECRET_HOME_FILES = new Set([
  ".claude.json",
  ".netrc",
  "_netrc",
  ".npmrc",
  ".yarnrc.yml",
  ".git-credentials",
  ".env",
  ".env.local",
  ".env.production",
  ".pgpass",
  ".pypirc",
  ".my.cnf",
  "credentials.json",
]);
/** `$HOME` folders that are credential stores: the folder and everything below. */
const SECRET_HOME_DIRS = [
  ".aws",
  ".docker",
  ".gnupg",
  ".claude",
  ".codex",
  ".commandcode",
  ".cursor",
  ".kube",
  ".azure",
  join(".config", "gcloud"),
  join(".config", "gh"),
  join(".config", "manicode"),
  join("Library", "Keychains"),
].map((relative) => join(HOME, relative));
const SSH_KEY_NAME = /^(id_rsa|id_dsa|id_ecdsa|id_ed25519|id_xmss)$/i;
const SECRET_SUFFIXES = [
  ".pem",
  ".p12",
  ".pfx",
  ".key",
  ".p8",
  ".jks",
  ".keystore",
];

function under(path: string, dir: string): boolean {
  const prefix = dir.endsWith(sep) ? dir : `${dir}${sep}`;
  return path === dir || path.startsWith(prefix);
}

/** Longest existing ancestor resolved through symlinks, tail re-joined. */
function canonicalPath(target: string): string {
  let abs = resolve(target);
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

function isSecretPath(abs: string): boolean {
  const name = basename(abs);
  const lower = name.toLowerCase();
  const publicKey = lower.endsWith(".pub");
  for (const home of guildHomes()) {
    if (under(abs, join(home, "browser-profile"))) return true;
    if (under(abs, join(home, "freebuff-profile"))) return true;
    if (under(abs, join(home, "freebuff-scratch"))) return true;
    if (under(abs, home) && SECRET_GUILD_FILES.has(lower)) return true;
  }
  if (dirname(abs) === HOME && SECRET_HOME_FILES.has(lower)) return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (lower === "credentials.json" || lower === "service-account.json") {
    return true;
  }
  if (SECRET_HOME_DIRS.some((dir) => under(abs, dir))) return true;
  if (under(abs, SSH_DIR) && abs !== SSH_DIR && !publicKey) return true;
  if (SSH_KEY_NAME.test(name)) return true;
  if (!publicKey && SECRET_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return true;
  }
  return false;
}

/**
 * The attach picker browses `$HOME` on purpose, so /host/* is not confined to a
 * workspace. Secrets still have to stay shut: OAuth tokens, model keys, the MCP
 * store, the cloned browser profile, Freebuff Chat profile / `freebuff.json`,
 * Command Code `commandcode.json` / `~/.commandcode`,
 * private keys, and the usual credential
 * dotfiles / folders (`.aws`, `.claude`, `.codex`, `.npmrc`, `.netrc`, …).
 * This is a denylist over the picker, not a chroot: non-secret `$HOME` and
 * system files such as `/etc/passwd` stay readable.
 */
export function assertHostPathAllowed(target: string): void {
  const abs = isAbsolute(target) ? resolve(target) : resolveUserPath(target);
  if (isSecretPath(canonicalPath(abs))) {
    throw new StoreError(403, "host path refused");
  }
}

function parentOf(path: string): string | null {
  const parent = dirname(path);
  if (parent === path) return null;
  return parent;
}

function asHostError(error: unknown, fallback: string): never {
  if (error instanceof StoreError) throw error;
  const err = error as { code?: string; message?: string };
  if (err.code === "ENOENT") throw new StoreError(404, "path not found");
  if (err.code === "EACCES") throw new StoreError(403, "permission denied");
  throw new StoreError(400, err.message || fallback);
}

export function hostList(rawPath: string): {
  path: string;
  parent: string | null;
  entries: HostEntry[];
} {
  try {
    const target = resolveUserPath(rawPath);
    assertHostPathAllowed(target);
    const st = statSync(target);
    if (!st.isDirectory()) throw new StoreError(400, "not a directory");
    const entries = readdirSync(target, { withFileTypes: true })
      .slice(0, LS_CAP)
      .map((entry) => {
        const item: HostEntry = {
          name: entry.name,
          kind: entry.isDirectory()
            ? "dir"
            : entry.isSymbolicLink()
              ? "link"
              : "file",
        };
        try {
          if (entry.isFile()) {
            item.size = statSync(join(target, entry.name)).size;
          }
        } catch {
          /* ignore */
        }
        return item;
      })
      .sort((a, b) => {
        if (a.kind === "dir" && b.kind !== "dir") return -1;
        if (a.kind !== "dir" && b.kind === "dir") return 1;
        return a.name.localeCompare(b.name);
      });
    return { path: target, parent: parentOf(target), entries };
  } catch (error) {
    asHostError(error, "list failed");
  }
}

export function hostRead(rawPath: string): {
  path: string;
  name: string;
  text: string;
  truncated: boolean;
  bytes: number;
} {
  try {
    const target = resolveUserPath(rawPath);
    assertHostPathAllowed(target);
    const st = statSync(target);
    if (!st.isFile()) throw new StoreError(400, "not a file");
    const raw = readFileSync(target);
    if (raw.includes(0)) throw new StoreError(400, "binary file");
    const truncated = raw.length > READ_CAP;
    const text = raw.subarray(0, READ_CAP).toString("utf8");
    return {
      path: target,
      name: target.split("/").pop() || target,
      text,
      truncated,
      bytes: raw.length,
    };
  } catch (error) {
    asHostError(error, "read failed");
  }
}

function walkTree(
  root: string,
  depth: number,
  prefix: string,
  lines: string[],
  budget: { left: number },
): void {
  if (budget.left <= 0 || depth < 0) return;
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  const visible = entries
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
    .slice(0, 80);
  for (const entry of visible) {
    if (budget.left <= 0) {
      lines.push(`${prefix}…`);
      return;
    }
    budget.left -= 1;
    const mark = entry.isDirectory() ? "/" : "";
    lines.push(`${prefix}${entry.name}${mark}`);
    if (entry.isDirectory() && depth > 0) {
      walkTree(join(root, entry.name), depth - 1, `${prefix}  `, lines, budget);
    }
  }
}

export function hostTree(rawPath: string): { path: string; text: string } {
  try {
    const target = resolveUserPath(rawPath);
    assertHostPathAllowed(target);
    const st = statSync(target);
    if (!st.isDirectory()) throw new StoreError(400, "not a directory");
    const lines = [target];
    walkTree(target, 2, "", lines, { left: 120 });
    let text = lines.join("\n");
    if (text.length > TREE_CAP) text = `${text.slice(0, TREE_CAP)}\n…`;
    return { path: target, text };
  } catch (error) {
    asHostError(error, "tree failed");
  }
}

/**
 * Git runs inside the user's tree: ignore their global/system config (hooks,
 * fsmonitor, credential helpers) and never prompt on a TTY-less daemon.
 */
const GIT_GUARD = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
  "--no-optional-locks",
] as const;

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

function findGitRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export async function hostGit(rawPath: string): Promise<{
  path: string;
  root: string;
  text: string;
}> {
  try {
    const start = resolveUserPath(rawPath);
    assertHostPathAllowed(start);
    const base = statSync(start).isDirectory() ? start : dirname(start);
    const root = findGitRoot(base);
    if (!root) throw new StoreError(404, "not a git repository");
    assertHostPathAllowed(root);
    const opts = {
      cwd: root,
      timeout: 8_000,
      maxBuffer: GIT_CAP * 2,
      env: GIT_ENV,
    };
    const status = await execFileAsync("git", [...GIT_GUARD, "status", "-sb"], opts);
    let diff = "";
    try {
      const out = await execFileAsync(
        "git",
        [...GIT_GUARD, "diff", "--stat", "HEAD"],
        opts,
      );
      diff = String(out.stdout || "");
    } catch {
      diff = "";
    }
    const text = [`repo: ${root}`, status.stdout.trim(), diff.trim()]
      .filter(Boolean)
      .join("\n")
      .slice(0, GIT_CAP);
    return { path: start, root, text: text || "(clean)" };
  } catch (error) {
    asHostError(error, "git failed");
  }
}
