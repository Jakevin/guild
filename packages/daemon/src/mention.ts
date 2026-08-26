/** @channel / @here / @all still mean the whole room. */
const BROADCAST = /(^|\s)@(channel|here|all)\b/i;
const HANDLE = /@([A-Za-z0-9_-]+)/g;
/** Consecutive @handles at the start of the message. */
const LEADING = /^\s*((?:@[A-Za-z0-9_-]+[\s,、]*)+)/;

/** Drop fenced / inline code so `@pm` in a snippet does not dispatch. */
export function stripMentionNoise(text: string): string {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");
}

export function isBroadcastMention(text: string): boolean {
  return BROADCAST.test(stripMentionNoise(text));
}

/** Every unique known @handle in the text, in first-seen order. */
export function mentionedHandles(text: string, handles: string[]): string[] {
  const scan = stripMentionNoise(text);
  const known = new Set(handles.map((handle) => handle.toLowerCase()));
  const out: string[] = [];
  for (const row of scan.matchAll(/(?:^|\s)@([A-Za-z0-9_-]+)\b/g)) {
    const key = row[1].toLowerCase();
    if (!known.has(key) || out.includes(key)) continue;
    out.push(key);
  }
  return out;
}

/**
 * Fallback when the client did not pick an assignee.
 * Leading @handles, otherwise the first @handle.
 */
export function summonedHandles(text: string, handles: string[]): string[] {
  const scan = stripMentionNoise(text);
  const known = new Set(handles.map((handle) => handle.toLowerCase()));
  const take = (names: string[]): string[] => {
    const out: string[] = [];
    for (const name of names) {
      const key = name.toLowerCase();
      if (!known.has(key) || out.includes(key)) continue;
      out.push(key);
    }
    return out;
  };
  const lead = scan.match(LEADING);
  if (lead) {
    const names = [...lead[1].matchAll(HANDLE)].map((row) => row[1]);
    const hit = take(names);
    if (hit.length) return hit;
  }
  const first = /(?:^|\s)@([A-Za-z0-9_-]+)\b/.exec(scan);
  if (first) return take([first[1]]);
  return [];
}
