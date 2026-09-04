import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Official Freebuff CLI credentials path. Shared with Codex's bridge. */
export const OFFICIAL_FREEBUFF_CREDENTIALS_PATH = join(
  homedir(),
  ".config",
  "manicode",
  "credentials.json",
);

export type FreebuffAuthSource = "official-cli" | "legacy-api-key" | null;

export type FreebuffAuth = {
  token?: string;
  source: FreebuffAuthSource;
  credentialsPath: string;
};

let credentialsPathOverride: string | undefined;

export function setFreebuffCredentialsPathForTest(path?: string): void {
  credentialsPathOverride = path;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

export function resolveFreebuffCredentialsPath(value?: string): string {
  const configured =
    value?.trim() ||
    credentialsPathOverride?.trim() ||
    process.env.FREEBUFF_CREDENTIALS_PATH?.trim() ||
    process.env.CODEBUFF_CREDENTIALS_PATH?.trim();
  const path = expandHome(configured || OFFICIAL_FREEBUFF_CREDENTIALS_PATH);
  return isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
}

export function readOfficialCliToken(credentialsPath: string): string | undefined {
  if (!existsSync(credentialsPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(credentialsPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const profile = (parsed as Record<string, unknown>).default;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return undefined;
    const token = (profile as Record<string, unknown>).authToken;
    return typeof token === "string" && token.trim() ? token.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function resolveFreebuffAuth(options: {
  credentialsPath?: string;
  apiKey?: string;
} = {}): FreebuffAuth {
  const credentialsPath = resolveFreebuffCredentialsPath(options.credentialsPath);
  const officialToken = readOfficialCliToken(credentialsPath);
  if (officialToken) {
    return { token: officialToken, source: "official-cli", credentialsPath };
  }
  const legacyApiKey = options.apiKey?.trim() || process.env.CODEBUFF_API_KEY?.trim();
  return legacyApiKey
    ? { token: legacyApiKey, source: "legacy-api-key", credentialsPath }
    : { source: null, credentialsPath };
}
