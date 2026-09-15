export type AxRow = {
  ref: string;
  role: string;
  title: string;
  value: string;
  desc: string;
  pos: string;
  size: string;
  focused: number;
  enabled: number;
  line: string;
};

export type ComputerLook = {
  id: string;
  windowId: string;
  token: string;
  pid: string;
  rows: AxRow[];
};

export const LOOK_CAP = 8;
export const FOLD_CAP = 12;
export const SEARCH_CAP = 8;
export const POS_TOLERANCE = 8;

const INTERACTIVE = new Set([
  "AXWindow",
  "AXButton",
  "AXCheckBox",
  "AXRadioButton",
  "AXPopUpButton",
  "AXMenuButton",
  "AXTextField",
  "AXTextArea",
  "AXLink",
  "AXMenuItem",
  "AXSlider",
  "AXTab",
  "AXTabGroup",
  "AXComboBox",
  "AXSearchField",
  "AXIncrementor",
  "AXDisclosureTriangle",
  "AXColorWell",
]);

type Bag = { seq: number; items: ComputerLook[] };
const bags = new Map<string, Bag>();

function bag(dataDir: string): Bag {
  const key = dataDir || "";
  let found = bags.get(key);
  if (!found) {
    found = { seq: 0, items: [] };
    bags.set(key, found);
  }
  return found;
}

export function resetComputerLooks(dataDir?: string): void {
  if (dataDir == null) bags.clear();
  else bags.delete(dataDir);
}

export function parseAxLine(line: string): AxRow | null {
  const m =
    /^(e\d+)\s+role=(\S+)\s+title=(.*)\s+value=(.*)\s+desc=(.*)\s+pos=(\S*)\s+size=(\S*)\s+focused=(\d+)\s+enabled=(\d+)\s*$/.exec(
      line,
    );
  if (!m) return null;
  return {
    ref: m[1],
    role: m[2],
    title: m[3],
    value: m[4],
    desc: m[5],
    pos: m[6],
    size: m[7],
    focused: Number(m[8]),
    enabled: Number(m[9]),
    line,
  };
}

export function parseAxDump(text: string): {
  pid: string;
  windowId: string;
  rows: AxRow[];
} | null {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  const none = /^ax none pid=(\d+)/m.exec(raw);
  if (none) {
    const fromFmt = /^id=(\d+)\s+pid=/m.exec(raw);
    return { pid: none[1], windowId: fromFmt?.[1] || "", rows: [] };
  }
  const header = /^ax pid=(\d+)(?: window=(\d+))? n=(\d+)\s*$/m.exec(raw);
  if (!header) return null;
  const fromFmt = /^id=(\d+)\s+pid=/m.exec(raw);
  const rows: AxRow[] = [];
  const start = raw.indexOf(header[0]) + header[0].length;
  for (const line of raw.slice(start).split("\n")) {
    const row = parseAxLine(line.trim());
    if (row) rows.push(row);
  }
  return {
    pid: header[1],
    windowId: header[2] || fromFmt?.[1] || "",
    rows,
  };
}

export function rememberLook(
  dataDir: string,
  input: { token: string; windowId?: string; dump: string },
): ComputerLook | null {
  const parsed = parseAxDump(input.dump);
  if (!parsed) return null;
  const store = bag(dataDir);
  store.seq += 1;
  const look: ComputerLook = {
    id: `L${store.seq}`,
    windowId: parsed.windowId || input.windowId || "",
    token: input.token,
    pid: parsed.pid,
    rows: parsed.rows,
  };
  store.items.push(look);
  if (store.items.length > LOOK_CAP) {
    store.items.splice(0, store.items.length - LOOK_CAP);
  }
  return look;
}

export function getLook(dataDir: string, id: string): ComputerLook | undefined {
  const want = String(id || "").trim();
  if (!want) return undefined;
  return bag(dataDir).items.find((item) => item.id === want);
}

export function windowMatchesLook(win: string, look: ComputerLook): boolean {
  const w = win.trim();
  if (!w) return true;
  if (w === look.windowId || w === look.token) return true;
  return w.toLowerCase() === look.token.toLowerCase();
}

export function lookWindow(look: ComputerLook, win?: string): string {
  const w = win?.trim() || "";
  return w || look.windowId || look.token;
}

export function foldRows(rows: AxRow[]): AxRow[] {
  const out: AxRow[] = [];
  const seen = new Set<string>();
  const take = (row: AxRow) => {
    if (out.length >= FOLD_CAP || seen.has(row.ref)) return;
    seen.add(row.ref);
    out.push(row);
  };
  const win = rows.find((row) => row.role === "AXWindow");
  if (win) take(win);
  for (const row of rows) {
    if (INTERACTIVE.has(row.role) || row.focused) take(row);
  }
  return out;
}

export function searchRows(rows: AxRow[], query: string): AxRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = rows
    .map((row) => {
      const title = row.title.toLowerCase();
      const value = row.value.toLowerCase();
      const desc = row.desc.toLowerCase();
      const role = row.role.toLowerCase();
      let score = 0;
      if (title === q || value === q) score = 4;
      else if (title.startsWith(q) || value.startsWith(q)) score = 3;
      else if (title.includes(q) || value.includes(q) || desc.includes(q)) score = 2;
      else if (role === q || role.includes(q)) score = 1;
      return { row, score };
    })
    .filter((item) => item.score > 0);
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.row.ref.localeCompare(b.row.ref, undefined, { numeric: true }),
  );
  return scored.slice(0, SEARCH_CAP).map((item) => item.row);
}

export function renderLook(
  look: ComputerLook,
  mode: { query?: string; ref?: string } = {},
): string {
  const window = look.windowId || look.token || "?";
  const head = `ax look=${look.id} pid=${look.pid || "?"} window=${window} n=${look.rows.length}`;
  const ref = mode.ref?.replace(/^@/, "").trim() || "";
  if (ref) {
    const row = look.rows.find((item) => item.ref === ref);
    if (!row) return `${head} ref=${ref}\nax ref not found`;
    return `${head} ref=${ref}\n${row.line}`;
  }
  const query = mode.query?.trim() || "";
  if (query) {
    const hits = searchRows(look.rows, query);
    const lines = [`${head} hits=${hits.length} query=${query}`];
    if (!hits.length) lines.push("hits=0  refine query");
    else hits.forEach((row) => lines.push(row.line));
    return lines.join("\n");
  }
  const shown = foldRows(look.rows);
  const lines = [`${head} shown=${shown.length}`];
  shown.forEach((row) => lines.push(row.line));
  const hidden = look.rows.length - shown.length;
  if (hidden > 0) {
    lines.push(`hidden=${hidden}  computer action=ax query=… look=${look.id}`);
  }
  return lines.join("\n");
}

export function parsePos(pos: string): { x: number; y: number } | null {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(String(pos || "").trim());
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

export function posClose(a: string, b: string, tol = POS_TOLERANCE): boolean {
  const p = parsePos(a);
  const q = parsePos(b);
  if (!p || !q) return false;
  return Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol;
}

export function expectJson(row: AxRow): string {
  return JSON.stringify({
    role: row.role,
    pos: row.pos || undefined,
    title: row.title || undefined,
    desc: row.desc || undefined,
    ref: row.ref,
  });
}

export function matchFingerprint(
  rows: AxRow[],
  expect: { role: string; pos: string; title?: string; desc?: string },
): AxRow[] {
  const keyed = Boolean(parsePos(expect.pos));
  if (!keyed && !expect.title) return [];
  return rows.filter((row) => {
    if (row.role !== expect.role) return false;
    if (keyed) {
      if (!posClose(row.pos, expect.pos)) return false;
    } else if (row.title !== expect.title) {
      return false;
    }
    if (expect.title && row.title !== expect.title) return false;
    if (expect.desc && row.desc !== expect.desc) return false;
    return true;
  });
}
