/**
 * Antigravity / agy picker. Ready when `agy` is on PATH (or AGY_PATH).
 * Catalog is `agy models`, Gemini 3.8 Flash and newer. Login is `agy auth`
 * in a terminal — Guild does not own Google OAuth or patch Codex config.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelEntry } from "@guild/protocol";
import { StoreError } from "./store.ts";

export const ANTIGRAVITY_PICKER_ID = "antigravity";
export const ANTIGRAVITY_DEFAULT_MODEL = "gemini-3.8-flash-medium";
export const MODEL_PREFIX = "antigravity/";
export const AGY_MODELS_TIMEOUT_MS = 30_000;

export const ANTIGRAVITY_HINT =
  "本機 agy CLI。模型清單走 agy models，只收 Gemini 3.8 Flash 以上。這一席由 agy 自己跑工具，不走 Guild 工具迴圈。";
export const ANTIGRAVITY_LOGIN_HINT =
  "沒有內建登入頁。先安裝 Antigravity CLI（agy），再在終端機執行 agy auth。Guild 只偵測 PATH 上的 agy（或 AGY_PATH）。";

const ALIASES = new Set(["antigravity", "agy", "gemini-web"]);
const READY_TTL_MS = 15_000;

export type AgyModel = {
  id: string;
  name: string;
};

export const ANTIGRAVITY_FLOOR: AgyModel[] = [
  { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
  { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
  { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
];

export type AntigravityStatus = {
  id: typeof ANTIGRAVITY_PICKER_ID;
  pickerId: typeof ANTIGRAVITY_PICKER_ID;
  name: string;
  hint: string;
  loginHint: string;
  kind: "antigravity";
  connected: boolean;
  pending: boolean;
  ready: boolean;
  models: ModelEntry[];
  catalog: ModelEntry[];
  shownIds: string[] | null;
  importHint?: string | null;
  error?: string;
};

type AntigravityHooks = {
  ready?: boolean;
  runModels?: () => Promise<string>;
  agyPath?: string;
  env?: NodeJS.ProcessEnv;
};

let hooks: AntigravityHooks = {};
let readyMemo: { at: number; path: string; ready: boolean } | null = null;

export function setAntigravityHooksForTest(next?: AntigravityHooks): void {
  hooks = next ?? {};
  readyMemo = null;
}

export function isAntigravityProvider(id: string): boolean {
  return ALIASES.has(String(id || "").trim().toLowerCase());
}

export function routeId(modelId: string): string {
  const id = String(modelId || "").trim();
  if (!id) return `${MODEL_PREFIX}${ANTIGRAVITY_DEFAULT_MODEL}`;
  return id.startsWith(MODEL_PREFIX) ? id : `${MODEL_PREFIX}${id}`;
}

export function agyModelId(route: string): string {
  const id = String(route || "").trim();
  return id.startsWith(MODEL_PREFIX) ? id.slice(MODEL_PREFIX.length) : id;
}

export function isAllowedAgyModel(modelOrId: string): boolean {
  const id = agyModelId(modelOrId);
  const match = id.match(/^gemini-(\d+)(?:\.(\d+))?-flash(?:-(high|medium|low))?$/i);
  if (!match) return false;
  const major = Number.parseInt(match[1], 10);
  const minor = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (major > 3) return true;
  if (major === 3 && minor >= 8) return true;
  return false;
}

export function effortFromAgyId(modelOrId: string): "low" | "medium" | "high" {
  const id = agyModelId(modelOrId);
  if (/(?:^|-)low$/i.test(id)) return "low";
  if (/(?:^|-)medium$/i.test(id)) return "medium";
  return "high";
}

export function parseAgyModels(text: string): AgyModel[] {
  const models: AgyModel[] = [];
  const seen = new Set<string>();
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^model(s)?$/i.test(trimmed)) continue;
    const match = trimmed.match(/^(\S+)\s+(.+?)\s*$/);
    if (!match || !/^[A-Za-z0-9._-]+$/.test(match[1])) continue;
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    models.push({ id: match[1], name: match[2] });
  }
  return models;
}

function envOf(): NodeJS.ProcessEnv {
  return hooks.env ?? process.env;
}

export function resolveAgyPath(): string {
  const fromHook = hooks.agyPath?.trim();
  if (fromHook) return fromHook;
  const fromEnv = String(envOf().AGY_PATH || "").trim();
  if (fromEnv) return fromEnv;
  return "agy";
}

function probeAgyBinary(): boolean {
  const path = resolveAgyPath();
  if (path !== "agy" && !existsSync(path)) return false;
  try {
    const result = spawnSync(path, ["--version"], {
      encoding: "utf8",
      timeout: 4000,
      stdio: ["ignore", "pipe", "pipe"],
      env: envOf(),
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function isAgyReady(): boolean {
  if (typeof hooks.ready === "boolean") return hooks.ready;
  const path = resolveAgyPath();
  const now = Date.now();
  if (readyMemo && readyMemo.path === path && now - readyMemo.at < READY_TTL_MS) {
    return readyMemo.ready;
  }
  const ready = probeAgyBinary();
  readyMemo = { at: now, path, ready };
  return ready;
}

function catalogCachePath(dataDir: string): string {
  return join(dataDir, "antigravity-models.json");
}

function stampReasoning(row: AgyModel): ModelEntry {
  const effort = effortFromAgyId(row.id);
  return {
    id: row.id,
    name: row.name,
    reasoning: {
      defaultEnabled: true,
      supportedEfforts: [effort],
      defaultEffort: effort,
      mandatory: true,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadCachedAntigravityModels(dataDir: string): ModelEntry[] {
  const path = catalogCachePath(dataDir);
  if (!existsSync(path)) return ANTIGRAVITY_FLOOR.map(stampReasoning);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const rows = isRecord(parsed) && Array.isArray(parsed.models) ? parsed.models : [];
    const models: ModelEntry[] = [];
    for (const row of rows) {
      if (!isRecord(row) || typeof row.id !== "string" || !row.id.trim()) continue;
      if (!isAllowedAgyModel(row.id)) continue;
      const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : row.id;
      models.push(stampReasoning({ id: row.id.trim(), name }));
    }
    return models.length ? models : ANTIGRAVITY_FLOOR.map(stampReasoning);
  } catch {
    return ANTIGRAVITY_FLOOR.map(stampReasoning);
  }
}

export function antigravityCatalog(dataDir: string): ModelEntry[] {
  return loadCachedAntigravityModels(dataDir);
}

function writeCatalog(dataDir: string, models: ModelEntry[]): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    catalogCachePath(dataDir),
    `${JSON.stringify({ version: 1, models }, null, 2)}\n`,
  );
}

function spawnAgyModels(): Promise<string> {
  return new Promise((resolve, reject) => {
    const path = resolveAgyPath();
    let child;
    try {
      child = spawn(path, ["models"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: envOf(),
      });
    } catch (error) {
      reject(new Error(`cannot start ${path}: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`agy models timed out after ${Math.round(AGY_MODELS_TIMEOUT_MS / 1000)}s`));
    }, AGY_MODELS_TIMEOUT_MS);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`cannot start ${path}: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const detail = stderr.trim().split("\n").slice(-3).join(" ");
        reject(
          new Error(
            `agy models failed (${code ?? signal ?? "signal"})${detail ? `: ${detail}` : ""}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

export async function refreshAntigravityCatalog(dataDir: string): Promise<ModelEntry[]> {
  if (!isAgyReady()) {
    throw new StoreError(
      400,
      "找不到 agy。請先安裝 Antigravity CLI，並在終端機執行 agy auth。",
    );
  }
  const text = hooks.runModels ? await hooks.runModels() : await spawnAgyModels();
  const parsed = parseAgyModels(text);
  const source = parsed.length ? parsed : ANTIGRAVITY_FLOOR;
  const models = source.filter((row) => isAllowedAgyModel(row.id)).map(stampReasoning);
  writeCatalog(dataDir, models);
  return models;
}

export function antigravityStatus(dataDir: string): AntigravityStatus {
  const ready = isAgyReady();
  const catalog = antigravityCatalog(dataDir);
  return {
    id: ANTIGRAVITY_PICKER_ID,
    pickerId: ANTIGRAVITY_PICKER_ID,
    name: "Antigravity",
    hint: ANTIGRAVITY_HINT,
    loginHint: ANTIGRAVITY_LOGIN_HINT,
    kind: "antigravity",
    connected: ready,
    pending: false,
    ready,
    models: catalog,
    catalog,
    shownIds: null,
    importHint: ready ? "偵測到 agy" : null,
  };
}
