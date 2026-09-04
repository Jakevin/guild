import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { cpus, hostname, networkInterfaces } from "node:os";
import { dirname } from "node:path";
import { resolveFreebuffCredentialsPath } from "./freebuff-auth.ts";

export const FREEBUFF_LOGIN_WEB_URL = "https://freebuff.com";

const LOGIN_REQUEST_TIMEOUT_MS = 30_000;

export type FreebuffLoginUser = {
  id?: string;
  name: string;
  email: string;
  authToken: string;
  fingerprintId?: string;
  fingerprintHash?: string;
  credits?: number;
};

export type PendingFreebuffLogin = {
  fingerprintId: string;
  fingerprintHash: string;
  expiresAt: string;
  loginUrl: string;
  credentialsPath: string;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type FreebuffLoginHooks = {
  fetch?: FetchLike;
  credentialsPath?: string;
  baseUrl?: string;
  fingerprintId?: string;
};

function trimBaseUrl(value?: string): string {
  return (value?.trim() || process.env.FREEBUFF_WEB_URL?.trim() || FREEBUFF_LOGIN_WEB_URL).replace(
    /\/+$/,
    "",
  );
}

export function createFreebuffFingerprintId(): string {
  const macAddresses = Object.values(networkInterfaces())
    .flatMap((ifaces) => ifaces ?? [])
    .filter(
      (row) =>
        row && !row.internal && row.mac && row.mac !== "00:00:00:00:00:00",
    )
    .map((row) => row.mac)
    .sort();
  const fingerprintInput = JSON.stringify({
    platform: process.platform,
    arch: process.arch,
    hostname: hostname(),
    cpus: cpus().map((cpu) => ({ model: cpu.model, speed: cpu.speed })),
    macAddresses,
  });
  return `enhanced-${createHash("sha256").update(fingerprintInput).digest("base64url")}`;
}

function responseDetail(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ["error", "message", "detail"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return undefined;
}

async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; data?: unknown; detail?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGIN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await response.text();
    let data: unknown;
    if (body.trim()) {
      try {
        data = JSON.parse(body);
      } catch {
        data = undefined;
      }
    }
    const detail = responseDetail(data);
    return {
      ok: response.ok,
      status: response.status,
      ...(data === undefined ? {} : { data }),
      ...(detail ? { detail } : {}),
    };
  } catch (error) {
    throw new Error(
      `Could not reach the Freebuff login service: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function asText(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Official CLI currently returns expiresAt as unix milliseconds, not an ISO string. */
export function parseFreebuffExpiryMs(value: string): number {
  const raw = value.trim();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function unwrapLoginRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const nested = record.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...record, ...(nested as Record<string, unknown>) };
  }
  return record;
}

export function requireLoginCode(data: unknown): {
  loginUrl: string;
  fingerprintHash: string;
  expiresAt: string;
} {
  const record = unwrapLoginRecord(data);
  if (!record) throw new Error("Freebuff returned an invalid login response");
  const loginUrl = asText(record.loginUrl || record.login_url || record.url);
  const fingerprintHash = asText(record.fingerprintHash || record.fingerprint_hash);
  let expiresAt = asText(record.expiresAt || record.expires_at);
  if (!expiresAt) {
    const ttl = asText(record.expiresInMs || record.expires_in_ms);
    if (ttl) expiresAt = String(Date.now() + Number(ttl));
  }
  if (!loginUrl || !fingerprintHash || !expiresAt) {
    throw new Error("Freebuff returned an incomplete login response");
  }
  return { loginUrl, fingerprintHash, expiresAt };
}

export function parseFreebuffLoginUser(
  data: unknown,
  fingerprintId: string,
  fingerprintHash: string,
): FreebuffLoginUser | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const candidate = (data as Record<string, unknown>).user;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const record = candidate as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim() : "";
  const authToken = typeof record.authToken === "string" ? record.authToken.trim() : "";
  if (!name || !email || !authToken) {
    throw new Error("Freebuff returned incomplete account credentials");
  }
  return {
    ...(typeof record.id === "string" && record.id.trim() ? { id: record.id.trim() } : {}),
    name,
    email,
    authToken,
    fingerprintId:
      typeof record.fingerprintId === "string" && record.fingerprintId.trim()
        ? record.fingerprintId.trim()
        : fingerprintId,
    fingerprintHash:
      typeof record.fingerprintHash === "string" && record.fingerprintHash.trim()
        ? record.fingerprintHash.trim()
        : fingerprintHash,
    ...(typeof record.credits === "number" ? { credits: record.credits } : {}),
  };
}

function readCredentialContainer(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function atomicWriteFile(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(path), 0o700);
  } catch {
    /* Windows */
  }
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows */
  }
}

/** Same default-profile format as the official Freebuff CLI / Codex bridge. */
export function saveFreebuffCredentials(path: string, user: FreebuffLoginUser): void {
  const credentials = { ...readCredentialContainer(path), default: user };
  atomicWriteFile(path, `${JSON.stringify(credentials, null, 2)}\n`);
}

export async function requestFreebuffLoginCode(
  options: FreebuffLoginHooks = {},
): Promise<PendingFreebuffLogin> {
  const baseUrl = trimBaseUrl(options.baseUrl);
  const credentialsPath = resolveFreebuffCredentialsPath(options.credentialsPath);
  const fingerprintId = options.fingerprintId?.trim() || createFreebuffFingerprintId();
  const fetchImpl = options.fetch ?? fetch;
  const loginCode = await requestJson(fetchImpl, `${baseUrl}/api/auth/cli/code`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ fingerprintId }),
  });
  if (!loginCode.ok) {
    throw new Error(
      `Freebuff could not create a login session (HTTP ${loginCode.status})${loginCode.detail ? `: ${loginCode.detail}` : ""}`,
    );
  }
  const { loginUrl, fingerprintHash, expiresAt } = requireLoginCode(loginCode.data);
  return { fingerprintId, fingerprintHash, expiresAt, loginUrl, credentialsPath };
}

export async function pollFreebuffLoginCode(
  pending: PendingFreebuffLogin,
  options: FreebuffLoginHooks = {},
): Promise<FreebuffLoginUser | null> {
  const baseUrl = trimBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch ?? fetch;
  const query = new URLSearchParams({
    fingerprintId: pending.fingerprintId,
    fingerprintHash: pending.fingerprintHash,
    expiresAt: pending.expiresAt,
  });
  const status = await requestJson(
    fetchImpl,
    `${baseUrl}/api/auth/cli/status?${query.toString()}`,
    { method: "GET", headers: { accept: "application/json" } },
  );
  if (!status.ok) return null;
  const user = parseFreebuffLoginUser(
    status.data,
    pending.fingerprintId,
    pending.fingerprintHash,
  );
  return user ?? null;
}
