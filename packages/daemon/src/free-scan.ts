import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { guildUserAgent } from "./version.ts";

/** Local morning the daily scan is due. The picker stays one Free row. */
export const FREE_SCAN_HOUR = 8;
const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";
const RETRY_MS = 30 * 60 * 1000;

export type FreeScanModel = {
  id: string;
  contextLength?: number;
  parametersB?: number;
};

export type FreeScanChange = {
  added: string[];
  removed: string[];
};

export type FreeScanReport = {
  checkedAt: string;
  source: "openrouter";
  freeCount: number;
  eligible: FreeScanModel[];
  needsParameterVerification: { id: string; contextLength?: number }[];
  freeIds: string[];
  changes?: FreeScanChange;
};

export type FreeScanSummary = {
  checkedAt: string;
  freeCount: number;
  eligibleCount: number;
  pendingCount: number;
  added: number | null;
  removed: number | null;
};

let inflight = false;
let retryAt = 0;

export function resetFreeScanBackoff(): void {
  inflight = false;
  retryAt = 0;
}

export function freeScanPath(dataDir: string): string {
  return join(dataDir, "free-scan.json");
}

function zero(value: unknown): boolean {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n === 0;
}

/** OpenRouter catalog row whose listed prices are all zero. */
export function isZeroPrice(model: Record<string, unknown>): boolean {
  const pricing = model.pricing;
  if (!pricing || typeof pricing !== "object") return false;
  const row = pricing as Record<string, unknown>;
  if (!zero(row.prompt) || !zero(row.completion)) return false;
  for (const key of ["request", "input_cache_read", "input_cache_write"]) {
    if (key in row && !zero(row[key])) return false;
  }
  return true;
}

/** Verified parameter count only. A number in the model id is not a size. */
export function parameterBillions(model: Record<string, unknown>): number | null {
  const direct = model.total_parameters ?? model.parameter_count;
  if (typeof direct !== "number" || !Number.isFinite(direct) || direct < 1e9) return null;
  return direct / 1e9;
}

function hasTools(model: Record<string, unknown>): boolean {
  const supported = model.supported_parameters;
  return Array.isArray(supported) && supported.includes("tools");
}

function contextLength(model: Record<string, unknown>): number | undefined {
  const n = model.context_length;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

export function classifyFreeModels(rows: readonly Record<string, unknown>[]): Omit<
  FreeScanReport,
  "checkedAt" | "changes"
> {
  const free = rows.filter(isZeroPrice);
  const eligible: FreeScanModel[] = [];
  const pending: { id: string; contextLength?: number }[] = [];
  for (const model of free) {
    const id = String(model.id || "").trim();
    if (!id) continue;
    const billions = parameterBillions(model);
    const ctx = contextLength(model);
    if (hasTools(model) && billions != null && billions >= 100) {
      eligible.push({ id, ...(ctx ? { contextLength: ctx } : {}), parametersB: billions });
    } else if (hasTools(model) && billions == null) {
      pending.push({ id, ...(ctx ? { contextLength: ctx } : {}) });
    }
  }
  return {
    source: "openrouter",
    freeCount: free.length,
    eligible,
    needsParameterVerification: pending,
    freeIds: free
      .map((model) => String(model.id || "").trim())
      .filter(Boolean)
      .sort(),
  };
}

export function diffFreeIds(previous: readonly string[] | undefined, next: readonly string[]): FreeScanChange {
  const before = new Set(previous ?? []);
  const after = new Set(next);
  return {
    added: next.filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)).sort(),
  };
}

/** Due after the local 08:00 gate that is still ahead of the last scan. */
export function freeScanDue(checkedAt: string | undefined, now = new Date()): boolean {
  if (!checkedAt) return true;
  const checked = new Date(checkedAt);
  if (Number.isNaN(checked.getTime())) return true;
  const gate = new Date(now);
  gate.setHours(FREE_SCAN_HOUR, 0, 0, 0);
  if (now < gate) gate.setDate(gate.getDate() - 1);
  return checked < gate;
}

export function readFreeScan(dataDir: string): FreeScanReport | null {
  try {
    const parsed = JSON.parse(readFileSync(freeScanPath(dataDir), "utf8")) as FreeScanReport;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.freeIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function summarizeFreeScan(report: FreeScanReport | null): FreeScanSummary | null {
  if (!report?.checkedAt) return null;
  return {
    checkedAt: report.checkedAt,
    freeCount: report.freeCount,
    eligibleCount: report.eligible.length,
    pendingCount: report.needsParameterVerification.length,
    added: report.changes ? report.changes.added.length : null,
    removed: report.changes ? report.changes.removed.length : null,
  };
}

function writeReport(dataDir: string, report: FreeScanReport): void {
  const path = freeScanPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

function rowsOf(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

export async function scanFreeModels(
  dataDir: string,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<FreeScanReport> {
  const res = await fetcher(OPENROUTER_MODELS, {
    headers: {
      accept: "application/json",
      "user-agent": guildUserAgent(),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`openrouter models HTTP ${res.status}`);
  const classified = classifyFreeModels(rowsOf(await res.json()));
  const previous = readFreeScan(dataDir);
  const report: FreeScanReport = {
    ...classified,
    checkedAt: now.toISOString(),
    ...(previous ? { changes: diffFreeIds(previous.freeIds, classified.freeIds) } : {}),
  };
  writeReport(dataDir, report);
  return report;
}

export async function scanFreeModelsIfDue(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<void> {
  if (env.GUILD_FREE_SCAN === "0") return;
  if (inflight || Date.now() < retryAt) return;
  const current = readFreeScan(dataDir);
  if (!freeScanDue(current?.checkedAt, now)) return;
  inflight = true;
  try {
    await scanFreeModels(dataDir, fetcher, now);
    retryAt = 0;
  } catch {
    retryAt = Date.now() + RETRY_MS;
  } finally {
    inflight = false;
  }
}
