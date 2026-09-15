import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const MEMORY_LOG_CAP = 8;

export type MemoryLogEntry = {
  id: string;
  at: string;
  bytes: number;
};

const SAFE_ID = /^[\w.-]+$/;

export function memoryLogId(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:.]/g, "-");
}

export function isMemoryLogId(id: string): boolean {
  return SAFE_ID.test(String(id || "").trim());
}

function entryPath(logDir: string, id: string): string {
  if (!isMemoryLogId(id)) throw new Error("bad memory log id");
  return join(logDir, `${id}.md`);
}

export function listMemoryLog(logDir: string): MemoryLogEntry[] {
  if (!logDir || !existsSync(logDir)) return [];
  const rows: MemoryLogEntry[] = [];
  for (const name of readdirSync(logDir)) {
    if (!name.endsWith(".md")) continue;
    const id = name.slice(0, -3);
    if (!isMemoryLogId(id)) continue;
    const path = join(logDir, name);
    const st = statSync(path);
    if (!st.isFile()) continue;
    rows.push({
      id,
      at: st.mtime.toISOString(),
      bytes: st.size,
    });
  }
  rows.sort((a, b) => b.id.localeCompare(a.id));
  return rows;
}

export function readMemoryLog(logDir: string, id: string): string {
  const path = entryPath(logDir, id);
  if (!existsSync(path)) throw new Error("memory log not found");
  return readFileSync(path, "utf8");
}

function pruneLog(logDir: string): void {
  const rows = listMemoryLog(logDir);
  for (const extra of rows.slice(MEMORY_LOG_CAP)) {
    try {
      unlinkSync(entryPath(logDir, extra.id));
    } catch {
      /* ignore */
    }
  }
}

export function snapshotMemoryFile(
  filePath: string,
  logDir: string,
  now = new Date(),
): MemoryLogEntry | null {
  if (!filePath || !existsSync(filePath)) return null;
  const body = readFileSync(filePath, "utf8");
  if (!body.trim()) return null;
  mkdirSync(logDir, { recursive: true });
  let id = memoryLogId(now);
  let dest = entryPath(logDir, id);
  let n = 2;
  while (existsSync(dest)) {
    id = `${memoryLogId(now)}-${n}`;
    dest = entryPath(logDir, id);
    n += 1;
  }
  writeFileSync(dest, body);
  pruneLog(logDir);
  const st = statSync(dest);
  return { id, at: st.mtime.toISOString(), bytes: st.size };
}

export function restoreMemoryFile(
  filePath: string,
  logDir: string,
  id: string,
  now = new Date(),
): string {
  const body = readMemoryLog(logDir, id);
  snapshotMemoryFile(filePath, logDir, now);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, body);
  return body;
}
