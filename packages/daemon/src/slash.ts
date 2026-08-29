import { stripMentionNoise } from "./mention.ts";

/** `/slug` tokens in a user message. Leading slash after start or whitespace. */
export function slashNames(text: string): string[] {
  const scan = stripMentionNoise(text);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of scan.matchAll(/(?:^|\s)\/([A-Za-z0-9_.-]+)/g)) {
    const key = row[1].toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
