import { execFile } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
    const base = statSync(start).isDirectory() ? start : dirname(start);
    const root = findGitRoot(base);
    if (!root) throw new StoreError(404, "not a git repository");
    const opts = { cwd: root, timeout: 8_000, maxBuffer: GIT_CAP * 2 };
    const status = await execFileAsync("git", ["status", "-sb"], opts);
    let diff = "";
    try {
      const out = await execFileAsync("git", ["diff", "--stat", "HEAD"], opts);
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
