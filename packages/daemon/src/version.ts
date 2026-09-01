import { readFileSync } from "node:fs";

/**
 * Outbound User-Agent. npm ships this package's source, so the manifest always
 * sits one level above `src/` — same lookup as `--version` in cli.ts.
 */
export function guildUserAgent(): string {
  return `Guild/${guildVersion()}`;
}

let cached: string | null = null;

export function guildVersion(): string {
  if (cached !== null) return cached;
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    const version = typeof pkg.version === "string" ? pkg.version.trim() : "";
    cached = version || "0";
  } catch {
    cached = "0";
  }
  return cached;
}
