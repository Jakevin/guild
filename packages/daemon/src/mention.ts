/** @channel / @quest / @here / @all still mean the whole quest. */
const BROADCAST = /(^|\s)@(channel|quest|here|all)\b/i;
const HANDLE = /@([A-Za-z0-9_-]+)/g;
/** Consecutive @handles at the start of a line. */
const LINE_LEAD = /^[ \t]*((?:@[A-Za-z0-9_-]+[\s,、]*)+)/;

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

export type MentionBlock = {
  start: number;
  end: number;
  handles: string[];
};

/** Line-start @handle groups. Prose `@pm` in the middle of a line is not a block. */
export function lineStartMentions(text: string, handles: string[]): MentionBlock[] {
  const raw = String(text ?? "");
  const known = new Set(handles.map((handle) => handle.toLowerCase()));
  const starts: { start: number; handles: string[] }[] = [];
  let fence = false;
  let offset = 0;
  for (const part of raw.split(/(\r?\n)/)) {
    if (part === "\n" || part === "\r\n") {
      offset += part.length;
      continue;
    }
    const trimmed = part.trim();
    if (trimmed.startsWith("```")) {
      fence = !fence;
      offset += part.length;
      continue;
    }
    if (!fence) {
      const lead = part.match(LINE_LEAD);
      if (lead) {
        const names: string[] = [];
        for (const row of lead[1].matchAll(HANDLE)) {
          const key = row[1].toLowerCase();
          if (!known.has(key) || names.includes(key)) continue;
          names.push(key);
        }
        if (names.length) starts.push({ start: offset, handles: names });
      }
    }
    offset += part.length;
  }
  return starts.map((row, i) => ({
    start: row.start,
    end: i + 1 < starts.length ? starts[i + 1].start : raw.length,
    handles: row.handles,
  }));
}

/**
 * Fallback when the client did not pick an assignee.
 * Every line-start @handle group, otherwise the first @handle in prose.
 */
export function summonedHandles(text: string, handles: string[]): string[] {
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
  const blocks = lineStartMentions(text, handles);
  if (blocks.length) {
    const out: string[] = [];
    for (const block of blocks) {
      for (const handle of block.handles) {
        if (!out.includes(handle)) out.push(handle);
      }
    }
    return out;
  }
  const scan = stripMentionNoise(text);
  const first = /(?:^|\s)@([A-Za-z0-9_-]+)\b/.exec(scan);
  if (first) return take([first[1]]);
  return [];
}

/**
 * Spec for one seat: shared preamble plus that @handle's line-start block.
 * Full text when the handle was only summoned in prose.
 */
export function assignmentFor(
  text: string,
  handle: string,
  handles: string[],
): string {
  const raw = String(text ?? "");
  const key = String(handle || "").toLowerCase();
  const blocks = lineStartMentions(raw, handles);
  if (!key || !blocks.length) return raw;
  const mine = blocks.filter((block) => block.handles.includes(key));
  if (!mine.length) return raw;
  const preamble = raw.slice(0, blocks[0].start).trim();
  const chunks = mine.map((block) => raw.slice(block.start, block.end).trim());
  return [preamble, ...chunks].filter(Boolean).join("\n\n");
}
