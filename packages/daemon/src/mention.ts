/** @channel / @quest / @here / @all still mean the whole quest. */
const BROADCAST = /(^|\s)@(channel|quest|here|all)\b/i;
const HANDLE = /@([A-Za-z0-9_-]+)/g;
/** Consecutive @handles at the start of a line (optional backticks). */
const LINE_LEAD = /^[ \t]*((?:`?@[A-Za-z0-9_-]+`?[\s,、]*)+)/;
/** `1. @design` / `- @infra`. */
const LIST_MARK = /^[ \t]*(?:\d+[.)、]\s*|[-*•]\s+)/;
/** Assignee right after the marker, or after 通過後/最後/再叫… — not the first @ anywhere on the line. */
const LIST_ASSIGN =
  /^(?:`?@([A-Za-z0-9_-]+)`?|(?:通過後|最後|再叫|交給|交棒(?:給)?|指派|(?:call|ask)\s+)\s*`?@([A-Za-z0-9_-]+)`?)/i;
/** Numbered/bullet item that names a later wave — do not start them this turn. */
const LIST_LATER =
  /^(?:通過後|最後|然後|之後|完成後)\s*`?@([A-Za-z0-9_-]+)`?/i;
/** Prose: 四席完成後由 @infra / 才交 @infra. 再叫 is a handoff, not a defer. */
const DEFER_AT =
  /(?:完成後|通過後|最後(?:才|由)?|才需要|才叫|才交)[^@\n]{0,24}@([A-Za-z0-9_-]+)/gi;
/** Bare handle after the same cues: 才需要call infra. */
const DEFER_BARE =
  /(?:完成後|才需要|才叫)\s*(?:call|ask|由)\s*`?@?([A-Za-z0-9_-]+)`?/gi;

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
  kind: "lead" | "list";
};

export type MentionBot = { id: string; handle: string };

function knownHandlesIn(chunk: string, known: Set<string>): string[] {
  const names: string[] = [];
  for (const row of chunk.matchAll(HANDLE)) {
    const key = row[1].toLowerCase();
    if (!known.has(key) || names.includes(key)) continue;
    names.push(key);
  }
  return names;
}

/** Line-start @handle groups, plus markdown list items that name a seat. */
export function lineStartMentions(text: string, handles: string[]): MentionBlock[] {
  const raw = String(text ?? "");
  const known = new Set(handles.map((handle) => handle.toLowerCase()));
  const starts: { start: number; handles: string[]; kind: "lead" | "list" }[] = [];
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
      const listed = LIST_MARK.test(part);
      const lead = part.match(LINE_LEAD);
      let names: string[] = [];
      if (lead) names = knownHandlesIn(lead[1], known);
      if (!names.length && listed) {
        const rest = part.replace(LIST_MARK, "");
        const hit = rest.match(LIST_ASSIGN);
        const key = (hit?.[1] || hit?.[2] || "").toLowerCase();
        if (key && known.has(key)) names = [key];
      }
      if (names.length) {
        starts.push({
          start: offset,
          handles: names,
          kind: listed ? "list" : "lead",
        });
      }
    }
    offset += part.length;
  }
  return starts.map((row, i) => ({
    start: row.start,
    end: i + 1 < starts.length ? starts[i + 1].start : raw.length,
    handles: row.handles,
    kind: row.kind,
  }));
}

/** Fenced samples only. Keep inline `code` so 「再叫 `@infra`」 still parses. */
function stripFences(text: string): string {
  return String(text ?? "").replace(/```[\s\S]*?```/g, " ");
}

/** Seats the same message says to start after someone else finishes. */
export function deferredHandles(text: string, handles: string[]): string[] {
  const raw = String(text ?? "");
  const known = new Set(handles.map((handle) => handle.toLowerCase()));
  const out: string[] = [];
  const add = (name: string) => {
    const key = name.toLowerCase();
    if (!known.has(key) || out.includes(key)) return;
    out.push(key);
  };
  const scan = stripFences(raw);
  for (const row of scan.matchAll(new RegExp(DEFER_AT.source, "gi"))) {
    if (row[1]) add(row[1]);
  }
  for (const row of scan.matchAll(new RegExp(DEFER_BARE.source, "gi"))) {
    if (row[1]) add(row[1]);
  }
  let fence = false;
  for (const part of raw.split(/(\r?\n)/)) {
    if (part === "\n" || part === "\r\n") continue;
    const trimmed = part.trim();
    if (trimmed.startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence || !LIST_MARK.test(part)) continue;
    const hit = part.replace(LIST_MARK, "").match(LIST_LATER);
    if (hit?.[1]) add(hit[1]);
  }
  return out;
}

export function withoutDeferredIds(
  ids: string[],
  text: string,
  bots: MentionBot[],
): string[] {
  if (!ids.length) return ids;
  const deferred = new Set(
    deferredHandles(
      text,
      bots.map((bot) => bot.handle),
    ),
  );
  if (!deferred.size) return ids;
  return ids.filter((id) => {
    const bot = bots.find((row) => row.id === id);
    return !bot || !deferred.has(bot.handle.toLowerCase());
  });
}

/**
 * Fallback when the client did not pick an assignee.
 * Every line-start @handle group, otherwise the first @handle in prose.
 * Seats named as a later wave (完成後 / 最後 / 才叫) stay quiet this turn.
 */
export function summonedHandles(text: string, handles: string[]): string[] {
  const known = new Set(handles.map((handle) => handle.toLowerCase()));
  const deferred = new Set(deferredHandles(text, handles));
  const take = (names: string[]): string[] => {
    const out: string[] = [];
    for (const name of names) {
      const key = name.toLowerCase();
      if (!known.has(key) || deferred.has(key) || out.includes(key)) continue;
      out.push(key);
    }
    return out;
  };
  const blocks = lineStartMentions(text, handles);
  if (blocks.length) {
    const out: string[] = [];
    for (const block of blocks) {
      for (const handle of block.handles) {
        if (deferred.has(handle) || out.includes(handle)) continue;
        out.push(handle);
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
 * Bot replies: line-start specs, else first prose @handle, plus assignment verbs
 * even when the handle is wrapped in backticks (models quote @infra a lot).
 * Fixture chatter like `(@pm / @rd)` has no verb, so it does not hop.
 */
const HANDOFF_ASK =
  /(?:(?:再叫|交給|交棒(?:給)?|指派)\s*|(?:call|ask|ping|notify|handoff(?:\s+to)?)\s+)`?@([A-Za-z0-9_-]+)`?/gi;

export function handoffHandles(text: string, handles: string[]): string[] {
  const known = new Set(handles.map((handle) => handle.toLowerCase()));
  const deferred = new Set(deferredHandles(text, handles));
  const out = summonedHandles(text, handles);
  const ask = new RegExp(HANDOFF_ASK.source, "gi");
  for (const row of stripFences(text).matchAll(ask)) {
    const key = row[1].toLowerCase();
    if (!known.has(key) || deferred.has(key) || out.includes(key)) continue;
    out.push(key);
  }
  return out;
}

export function sanitizeMentionIds(
  raw: unknown,
  bots: MentionBot[],
): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(bots.map((bot) => bot.id));
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || !known.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function parseMentionIds(
  text: string,
  bots: MentionBot[],
  kind: "user" | "bot",
): string[] {
  if (isBroadcastMention(text)) return [];
  const handles = bots.map((bot) => bot.handle);
  const names =
    kind === "bot" ? handoffHandles(text, handles) : summonedHandles(text, handles);
  const out: string[] = [];
  for (const name of names) {
    const bot = bots.find(
      (row) => row.handle.toLowerCase() === name.toLowerCase(),
    );
    if (!bot || out.includes(bot.id)) continue;
    out.push(bot.id);
  }
  return withoutDeferredIds(out, text, bots);
}

/**
 * Prefer the stored mention list. Older rows without the field still parse the body.
 * An empty stored list means nobody.
 */
export function messageMentionIds(
  message: { author: string; body: string; mentions?: string[] },
  bots: MentionBot[],
): string[] {
  const ids = Array.isArray(message.mentions)
    ? sanitizeMentionIds(message.mentions, bots)
    : parseMentionIds(
        message.body,
        bots,
        message.author === "you" ? "user" : "bot",
      );
  return withoutDeferredIds(
    ids.filter((id) => id !== message.author),
    message.body,
    bots,
  );
}

function idsForHandles(names: string[], bots: MentionBot[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const bot = bots.find(
      (row) => row.handle.toLowerCase() === name.toLowerCase(),
    );
    if (!bot || out.includes(bot.id)) continue;
    out.push(bot.id);
  }
  return out;
}

/**
 * Dispatch plan for a message: inner arrays are parallel, outer order is sequential.
 * Numbered/bullet assignees share the first wave; 完成後 / 最後 / 再交 become later waves.
 */
export function parseAssignmentWaves(
  text: string,
  bots: MentionBot[],
  kind: "user" | "bot" = "user",
): string[][] {
  if (isBroadcastMention(text)) {
    return [bots.map((bot) => bot.id)];
  }
  const handles = bots.map((bot) => bot.handle);
  const now = idsForHandles(
    kind === "bot" ? handoffHandles(text, handles) : summonedHandles(text, handles),
    bots,
  );
  const later = idsForHandles(deferredHandles(text, handles), bots).filter(
    (id) => !now.includes(id),
  );
  const waves: string[][] = [];
  if (now.length) waves.push(now);
  for (const id of later) waves.push([id]);
  return waves;
}

export function sanitizeWaves(
  raw: unknown,
  bots: MentionBot[],
): string[][] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(bots.map((bot) => bot.id));
  const seen = new Set<string>();
  const waves: string[][] = [];
  for (const row of raw) {
    const items = Array.isArray(row) ? row : [row];
    const ids: string[] = [];
    for (const item of items) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (!id || !known.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length) waves.push(ids);
  }
  return waves;
}

/** Append incoming waves. First incoming wave joins the current first wave. */
export function mergeAssign(
  current: string[][],
  incoming: string[][],
): string[][] {
  if (!incoming.length) return current.map((wave) => wave.slice());
  if (!current.length) return incoming.map((wave) => wave.slice());
  const seated = new Set(current.flat());
  const next = current.map((wave) => wave.slice());
  incoming.forEach((wave, index) => {
    const fresh = wave.filter((id) => !seated.has(id));
    if (!fresh.length) return;
    for (const id of fresh) seated.add(id);
    if (index === 0) next[0] = next[0].concat(fresh);
    else next.push(fresh);
  });
  return next;
}

export function dismissAssign(waves: string[][], botId: string): string[][] {
  return waves
    .map((wave) => wave.filter((id) => id !== botId))
    .filter((wave) => wave.length > 0);
}

/** Pull later-wave seats into the front so an explicit @ starts them this turn. */
export function promoteAssign(waves: string[][], ids: string[]): string[][] {
  if (!waves.length || !ids.length) return waves.map((wave) => wave.slice());
  const seated = new Set(waves.flat());
  const front = new Set(waves[0]);
  const pull: string[] = [];
  for (const id of ids) {
    if (!seated.has(id) || front.has(id) || pull.includes(id)) continue;
    pull.push(id);
  }
  if (!pull.length) return waves.map((wave) => wave.slice());
  const drop = new Set(pull);
  const next = waves.map((wave, index) =>
    index === 0 ? wave.slice() : wave.filter((id) => !drop.has(id)),
  );
  next[0] = next[0].concat(pull);
  return next.filter((wave) => wave.length > 0);
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
  // Numbered plans share constraints ("don't ship until PM signs off"). Slice only classic specs.
  if (!blocks.some((block) => block.kind === "lead")) return raw;
  const preamble = raw.slice(0, blocks[0].start).trim();
  const chunks = mine.map((block) => raw.slice(block.start, block.end).trim());
  return [preamble, ...chunks].filter(Boolean).join("\n\n");
}
