/** One line of guild work. Tool logs stay on the quest. */
export type GuildIndexNote = {
  id: string;
  roomId: string;
  channel: string;
  handles: string[];
  task: string;
  status: "open" | "reported";
  report?: string;
};

const STORE_CAP = 40;
const SHOW_CAP = 12;
const TASK_CAP = 120;
const REPORT_CAP = 160;

export function oneLine(text: string, cap: number): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

/** The hall already shows the reply. The index keeps its first line. */
export function conclusionLine(body: string): string {
  const line = String(body || "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .find(Boolean);
  return oneLine(line || "", REPORT_CAP);
}

function nextId(notes: GuildIndexNote[]): string {
  const n = notes.reduce((max, note) => {
    const match = /^a(\d+)$/.exec(note.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `a${n + 1}`;
}

export function recordNote(
  notes: GuildIndexNote[],
  input: { roomId: string; channel: string; handles: string[]; task: string },
): GuildIndexNote[] {
  const handles = [
    ...new Set(input.handles.map((handle) => handle.trim().replace(/^@/, "")).filter(Boolean)),
  ];
  const task = oneLine(input.task, TASK_CAP);
  if (!handles.length || !task || !input.roomId) return notes;
  const keys = new Set(handles.map((handle) => handle.toLowerCase()));
  const kept = notes.filter(
    (note) =>
      !(
        note.roomId === input.roomId &&
        note.handles.some((handle) => keys.has(handle.toLowerCase()))
      ),
  );
  const note: GuildIndexNote = {
    id: nextId(kept),
    roomId: input.roomId,
    channel: input.channel.replace(/^#/, ""),
    handles,
    task,
    status: "open",
  };
  return [...kept, note].slice(-STORE_CAP);
}

export function reportNote(
  notes: GuildIndexNote[],
  roomId: string,
  handle: string,
  body: string,
): GuildIndexNote[] {
  const line = conclusionLine(body);
  if (!line) return notes;
  const key = handle.trim().replace(/^@/, "").toLowerCase();
  if (!key) return notes;
  let hit = -1;
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    if (note.roomId !== roomId) continue;
    if (!note.handles.some((item) => item.toLowerCase() === key)) continue;
    hit = i;
    break;
  }
  if (hit < 0) return notes;
  const next = notes.slice();
  next[hit] = { ...next[hit], status: "reported", report: line };
  return next;
}

export function dropRoom(notes: GuildIndexNote[], roomId: string): GuildIndexNote[] {
  if (!roomId) return notes;
  return notes.filter((note) => note.roomId !== roomId);
}

export function renameChannelLabel(
  notes: GuildIndexNote[],
  roomId: string,
  channel: string,
): GuildIndexNote[] {
  const name = channel.replace(/^#/, "").trim();
  if (!roomId || !name) return notes;
  return notes.map((note) => (note.roomId === roomId ? { ...note, channel: name } : note));
}

export function renameHandle(
  notes: GuildIndexNote[],
  from: string,
  to: string,
): GuildIndexNote[] {
  const key = from.trim().replace(/^@/, "").toLowerCase();
  const next = to.trim().replace(/^@/, "");
  if (!key || !next || key === next.toLowerCase()) return notes;
  return notes.map((note) => ({
    ...note,
    handles: note.handles.map((handle) => (handle.toLowerCase() === key ? next : handle)),
  }));
}

export function dropHandle(notes: GuildIndexNote[], handle: string): GuildIndexNote[] {
  const key = handle.trim().replace(/^@/, "").toLowerCase();
  if (!key) return notes;
  return notes
    .map((note) => ({
      ...note,
      handles: note.handles.filter((item) => item.toLowerCase() !== key),
    }))
    .filter((note) => note.handles.length > 0);
}

export function formatGuildIndex(notes: GuildIndexNote[]): string {
  const head = "# Guild index";
  const rule = "One line each. recall reads one id. Tool logs stay on the quest.";
  const shown = notes.slice(-SHOW_CAP).reverse();
  if (!shown.length) return `${head}\nNo assignment yet. ${rule}`;
  const lines = shown.map((note) => {
    const who = note.handles.map((handle) => `@${handle}`).join(" ");
    const tail =
      note.status === "reported" && note.report
        ? `reported: ${note.report}`
        : "open";
    return `- ${note.id} #${note.channel} ${who} — ${note.task} — ${tail}`;
  });
  return `${head}\n${rule}\n${lines.join("\n")}`;
}

/**
 * A follow-up names seats that already own one quest.
 * Every mentioned handle must resolve to that same rostered room.
 */
export function followUpRoom(
  notes: GuildIndexNote[],
  mentioned: string[],
  onRoster: (roomId: string, handle: string) => boolean,
): { roomId: string; handles: string[] } | null {
  if (!mentioned.length) return null;
  const rooms = new Set<string>();
  const handles: string[] = [];
  for (const key of mentioned) {
    const hits = notes.filter(
      (item) =>
        item.handles.some((handle) => handle.toLowerCase() === key) &&
        onRoster(item.roomId, key),
    );
    const mine = new Set(hits.map((item) => item.roomId));
    if (mine.size !== 1) return null;
    const roomId = [...mine][0];
    rooms.add(roomId);
    const note = hits.find((item) => item.roomId === roomId);
    const handle = note?.handles.find((item) => item.toLowerCase() === key) || key;
    handles.push(handle);
  }
  if (rooms.size !== 1) return null;
  return { roomId: [...rooms][0], handles };
}
