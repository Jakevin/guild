import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ChatAttachment,
  ChatMessage,
  ChatPart,
  ChatUsage,
  Room,
} from "@guild/protocol";
import type { TrajectoryDraft, TrajectoryEvent } from "./trajectory.ts";

export const GUILD_DB_FILE = "guild.sqlite";
const SCHEMA_VERSION = "1";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('channel', 'dm')),
  name TEXT NOT NULL,
  member_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  parts TEXT,
  reply_to TEXT,
  attachments TEXT,
  usage TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  steer INTEGER NOT NULL DEFAULT 0,
  steer_bot_id TEXT,
  UNIQUE (room_id, seq)
);

CREATE INDEX IF NOT EXISTS messages_room_seq ON messages(room_id, seq);

CREATE TABLE IF NOT EXISTS trajectory (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  ts TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  bot_id TEXT,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT,
  result TEXT,
  duration_ms INTEGER,
  is_error INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, seq)
);

CREATE TABLE IF NOT EXISTS compact (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  through_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0
);
`;

type CompactRow = {
  throughId: string;
  summary: string;
  updatedAt: string;
  messageCount: number;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === "string" &&
    typeof rec.roomId === "string" &&
    typeof rec.author === "string" &&
    typeof rec.body === "string" &&
    typeof rec.createdAt === "string"
  );
}

function parseJsonlMessages(raw: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isChatMessage(parsed)) out.push(parsed);
    } catch {
      /* skip */
    }
  }
  return out;
}

function parseJsonlTrajectory(raw: string): TrajectoryEvent[] {
  const out: TrajectoryEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as TrajectoryEvent;
      if (parsed && typeof parsed.kind === "string") out.push(parsed);
    } catch {
      /* skip */
    }
  }
  return out;
}

function messageFromRow(row: Record<string, unknown>): ChatMessage {
  const parts = parseJson<ChatPart[] | null>(row.parts, null);
  const attachments = parseJson<ChatAttachment[] | null>(row.attachments, null);
  const usage = parseJson<ChatUsage | null>(row.usage, null);
  const message: ChatMessage = {
    id: asString(row.id),
    roomId: asString(row.room_id),
    author: asString(row.author),
    body: asString(row.body),
    createdAt: asString(row.created_at),
  };
  if (parts?.length) message.parts = parts;
  const replyTo = asString(row.reply_to);
  if (replyTo) message.replyTo = replyTo;
  if (attachments?.length) message.attachments = attachments;
  if (usage) message.usage = usage;
  const finishedAt = asString(row.finished_at);
  if (finishedAt) message.finishedAt = finishedAt;
  if (asNumber(row.steer) === 1) message.steer = true;
  const steerBotId = asString(row.steer_bot_id);
  if (steerBotId) message.steerBotId = steerBotId;
  return message;
}

function roomFromRow(row: Record<string, unknown>): Room {
  const memberIds = parseJson<string[]>(row.member_ids, []);
  return {
    id: asString(row.id),
    kind: asString(row.kind) === "dm" ? "dm" : "channel",
    name: asString(row.name),
    memberIds: Array.isArray(memberIds)
      ? memberIds.filter((id) => typeof id === "string")
      : [],
    createdAt: asString(row.created_at),
  };
}

function trajectoryFromRow(row: Record<string, unknown>): TrajectoryEvent {
  const event: TrajectoryEvent = {
    seq: asNumber(row.seq),
    ts: asString(row.ts),
    turnId: asString(row.turn_id),
    kind: asString(row.kind) as TrajectoryEvent["kind"],
    summary: asString(row.summary),
  };
  const botId = asString(row.bot_id);
  if (botId) event.botId = botId;
  if (row.payload != null && row.payload !== "") {
    event.payload = parseJson<unknown>(row.payload, undefined);
  }
  const result = asString(row.result);
  if (result) event.result = result;
  if (row.duration_ms != null) event.durationMs = asNumber(row.duration_ms);
  if (asNumber(row.is_error) === 1) event.isError = true;
  return event;
}

export class GuildDb {
  readonly sqlite: DatabaseSync;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path, { timeout: 5000 });
    this.sqlite.exec(SCHEMA);
    try {
      this.sqlite.exec("ALTER TABLE messages ADD COLUMN steer_bot_id TEXT");
    } catch {
      /* column already exists on fresh schema */
    }
    this.sqlite.prepare(
      "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', ?)",
    ).run(SCHEMA_VERSION);
  }

  close(): void {
    this.sqlite.close();
  }

  importLegacyFiles(dataDir: string): void {
    const root = join(dataDir, "rooms");
    if (!existsSync(root)) return;
    const ids = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const id of ids) this.importRoomDir(join(root, id), id);
  }

  upsertRoom(room: Room): void {
    this.sqlite
      .prepare(
        `INSERT INTO rooms (id, kind, name, member_ids, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           name = excluded.name,
           member_ids = excluded.member_ids,
           created_at = excluded.created_at`,
      )
      .run(
        room.id,
        room.kind,
        room.name,
        JSON.stringify(room.memberIds),
        room.createdAt,
      );
  }

  getRoom(id: string): Room | null {
    const row = this.sqlite
      .prepare("SELECT * FROM rooms WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? roomFromRow(row) : null;
  }

  listRooms(): Room[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM rooms ORDER BY created_at ASC, id ASC")
      .all() as Record<string, unknown>[];
    return rows.map(roomFromRow);
  }

  deleteRoom(id: string): void {
    this.sqlite.prepare("DELETE FROM rooms WHERE id = ?").run(id);
  }

  listMessages(roomId: string): ChatMessage[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM messages WHERE room_id = ? ORDER BY seq ASC")
      .all(roomId) as Record<string, unknown>[];
    return rows.map(messageFromRow);
  }

  peekLastMessage(roomId: string): ChatMessage | undefined {
    const row = this.sqlite
      .prepare(
        "SELECT * FROM messages WHERE room_id = ? ORDER BY seq DESC LIMIT 1",
      )
      .get(roomId) as Record<string, unknown> | undefined;
    return row ? messageFromRow(row) : undefined;
  }

  appendMessage(message: ChatMessage): void {
    const seq = this.nextMessageSeq(message.roomId);
    this.insertMessage(message, seq);
  }

  replaceMessages(roomId: string, messages: ChatMessage[]): void {
    this.sqlite.exec("BEGIN");
    try {
      this.sqlite.prepare("DELETE FROM messages WHERE room_id = ?").run(roomId);
      messages.forEach((message, index) => this.insertMessage(message, index));
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  updateMessageBody(roomId: string, messageId: string, body: string): ChatMessage | null {
    const result = this.sqlite
      .prepare("UPDATE messages SET body = ? WHERE room_id = ? AND id = ?")
      .run(body, roomId, messageId);
    if (!result.changes) return null;
    return this.getMessage(roomId, messageId);
  }

  replaceMessage(
    roomId: string,
    messageId: string,
    patch: {
      body: string;
      parts?: ChatPart[];
      usage?: ChatUsage;
      createdAt: string;
      finishedAt: string;
    },
  ): ChatMessage | null {
    const result = this.sqlite
      .prepare(
        `UPDATE messages
         SET body = ?, parts = ?, usage = ?, created_at = ?, finished_at = ?
         WHERE room_id = ? AND id = ?`,
      )
      .run(
        patch.body,
        patch.parts?.length ? JSON.stringify(patch.parts) : null,
        patch.usage ? JSON.stringify(patch.usage) : null,
        patch.createdAt,
        patch.finishedAt,
        roomId,
        messageId,
      );
    if (!result.changes) return null;
    return this.getMessage(roomId, messageId);
  }

  deleteMessage(roomId: string, messageId: string): ChatMessage | null {
    const existing = this.getMessage(roomId, messageId);
    if (!existing) return null;
    this.sqlite
      .prepare("DELETE FROM messages WHERE room_id = ? AND id = ?")
      .run(roomId, messageId);
    this.sqlite
      .prepare("DELETE FROM trajectory WHERE room_id = ? AND turn_id = ?")
      .run(roomId, messageId);
    return existing;
  }

  truncateAfter(roomId: string, messageId: string): ChatMessage[] | null {
    const row = this.sqlite
      .prepare("SELECT seq FROM messages WHERE room_id = ? AND id = ?")
      .get(roomId, messageId) as { seq?: number } | undefined;
    if (!row || typeof row.seq !== "number") return null;
    this.sqlite
      .prepare("DELETE FROM messages WHERE room_id = ? AND seq > ?")
      .run(roomId, row.seq);
    return this.listMessages(roomId);
  }

  listTrajectory(roomId: string): TrajectoryEvent[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM trajectory WHERE room_id = ? ORDER BY seq ASC")
      .all(roomId) as Record<string, unknown>[];
    return rows.map(trajectoryFromRow);
  }

  appendTrajectory(roomId: string, drafts: TrajectoryDraft[]): TrajectoryEvent[] {
    let seq = this.lastTrajectorySeq(roomId);
    const written: TrajectoryEvent[] = [];
    this.sqlite.exec("BEGIN");
    try {
      const insert = this.sqlite.prepare(
        `INSERT INTO trajectory (
           room_id, seq, ts, turn_id, bot_id, kind, summary, payload, result, duration_ms, is_error
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const draft of drafts) {
        seq += 1;
        const event: TrajectoryEvent = { ...draft, seq };
        insert.run(
          roomId,
          event.seq,
          event.ts,
          event.turnId,
          event.botId ?? null,
          event.kind,
          event.summary,
          event.payload === undefined ? null : JSON.stringify(event.payload),
          event.result ?? null,
          event.durationMs ?? null,
          event.isError ? 1 : 0,
        );
        written.push(event);
      }
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
    return written;
  }

  readCompact(roomId: string): CompactRow | null {
    const row = this.sqlite
      .prepare("SELECT * FROM compact WHERE room_id = ?")
      .get(roomId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const throughId = asString(row.through_id);
    const summary = asString(row.summary);
    if (!throughId || !summary) return null;
    return {
      throughId,
      summary,
      updatedAt: asString(row.updated_at),
      messageCount: asNumber(row.message_count),
    };
  }

  writeCompact(roomId: string, compact: CompactRow): void {
    this.sqlite
      .prepare(
        `INSERT INTO compact (room_id, through_id, summary, updated_at, message_count)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(room_id) DO UPDATE SET
           through_id = excluded.through_id,
           summary = excluded.summary,
           updated_at = excluded.updated_at,
           message_count = excluded.message_count`,
      )
      .run(
        roomId,
        compact.throughId,
        compact.summary,
        compact.updatedAt,
        compact.messageCount,
      );
  }

  private getMessage(roomId: string, messageId: string): ChatMessage | null {
    const row = this.sqlite
      .prepare("SELECT * FROM messages WHERE room_id = ? AND id = ?")
      .get(roomId, messageId) as Record<string, unknown> | undefined;
    return row ? messageFromRow(row) : null;
  }

  private nextMessageSeq(roomId: string): number {
    const row = this.sqlite
      .prepare("SELECT COALESCE(MAX(seq), -1) AS seq FROM messages WHERE room_id = ?")
      .get(roomId) as { seq?: number } | undefined;
    return asNumber(row?.seq, -1) + 1;
  }

  private lastTrajectorySeq(roomId: string): number {
    const row = this.sqlite
      .prepare("SELECT COALESCE(MAX(seq), -1) AS seq FROM trajectory WHERE room_id = ?")
      .get(roomId) as { seq?: number } | undefined;
    return asNumber(row?.seq, -1);
  }

  private insertMessage(message: ChatMessage, seq: number): void {
    this.sqlite
      .prepare(
        `INSERT INTO messages (
           id, room_id, seq, author, body, parts, reply_to, attachments, usage,
           created_at, finished_at, steer, steer_bot_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.roomId,
        seq,
        message.author,
        message.body,
        message.parts?.length ? JSON.stringify(message.parts) : null,
        message.replyTo ?? null,
        message.attachments?.length ? JSON.stringify(message.attachments) : null,
        message.usage ? JSON.stringify(message.usage) : null,
        message.createdAt,
        message.finishedAt ?? null,
        message.steer ? 1 : 0,
        message.steerBotId ?? null,
      );
  }

  private importRoomDir(dir: string, id: string): void {
    const roomFile = join(dir, "room.json");
    if (existsSync(roomFile) && !this.getRoom(id)) {
      try {
        const parsed = JSON.parse(readFileSync(roomFile, "utf8")) as Room;
        if (parsed && parsed.id === id && (parsed.kind === "channel" || parsed.kind === "dm")) {
          this.upsertRoom({
            id,
            kind: parsed.kind,
            name: typeof parsed.name === "string" ? parsed.name : id,
            memberIds: Array.isArray(parsed.memberIds)
              ? parsed.memberIds.filter((item): item is string => typeof item === "string")
              : [],
            createdAt:
              typeof parsed.createdAt === "string"
                ? parsed.createdAt
                : "2026-01-01T00:00:00.000Z",
          });
        }
      } catch {
        /* skip bad room.json */
      }
    }
    if (!this.getRoom(id)) return;

    if (this.messageCount(id) === 0) {
      const jsonl = join(dir, "messages.jsonl");
      const json = join(dir, "messages.json");
      let messages: ChatMessage[] = [];
      if (existsSync(jsonl)) {
        messages = parseJsonlMessages(readFileSync(jsonl, "utf8"));
      } else if (existsSync(json)) {
        try {
          const parsed = JSON.parse(readFileSync(json, "utf8")) as unknown;
          messages = Array.isArray(parsed) ? parsed.filter(isChatMessage) : [];
        } catch {
          messages = [];
        }
      }
      if (messages.length) this.replaceMessages(id, messages);
    }

    if (this.trajectoryCount(id) === 0) {
      const path = join(dir, "trajectory.jsonl");
      if (existsSync(path)) {
        const events = parseJsonlTrajectory(readFileSync(path, "utf8"));
        if (events.length) {
          this.sqlite.exec("BEGIN");
          try {
            const insert = this.sqlite.prepare(
              `INSERT INTO trajectory (
                 room_id, seq, ts, turn_id, bot_id, kind, summary, payload, result, duration_ms, is_error
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            );
            for (const event of events) {
              insert.run(
                id,
                event.seq,
                event.ts,
                event.turnId,
                event.botId ?? null,
                event.kind,
                event.summary,
                event.payload === undefined ? null : JSON.stringify(event.payload),
                event.result ?? null,
                event.durationMs ?? null,
                event.isError ? 1 : 0,
              );
            }
            this.sqlite.exec("COMMIT");
          } catch (error) {
            this.sqlite.exec("ROLLBACK");
            throw error;
          }
        }
      }
    }

    if (!this.readCompact(id)) {
      const path = join(dir, "compact.json");
      if (existsSync(path)) {
        try {
          const parsed = JSON.parse(readFileSync(path, "utf8")) as {
            throughId?: string;
            summary?: string;
            updatedAt?: string;
            messageCount?: number;
          };
          if (parsed.throughId && parsed.summary) {
            this.writeCompact(id, {
              throughId: parsed.throughId,
              summary: parsed.summary,
              updatedAt: parsed.updatedAt || "",
              messageCount: Number(parsed.messageCount) || 0,
            });
          }
        } catch {
          /* skip */
        }
      }
    }

    if (this.getRoom(id)) rmIfExists(join(dir, "room.json"));
    if (this.messageCount(id) > 0) {
      rmIfExists(join(dir, "messages.json"));
      rmIfExists(join(dir, "messages.jsonl"));
    }
    if (this.trajectoryCount(id) > 0) {
      rmIfExists(join(dir, "trajectory.jsonl"));
    }
    if (this.readCompact(id)) rmIfExists(join(dir, "compact.json"));
  }

  private messageCount(roomId: string): number {
    const row = this.sqlite
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE room_id = ?")
      .get(roomId) as { n?: number } | undefined;
    return asNumber(row?.n);
  }

  private trajectoryCount(roomId: string): number {
    const row = this.sqlite
      .prepare("SELECT COUNT(*) AS n FROM trajectory WHERE room_id = ?")
      .get(roomId) as { n?: number } | undefined;
    return asNumber(row?.n);
  }
}

const OPEN = new Map<string, { db: GuildDb; refs: number }>();

export function openGuildDb(dataDir: string): GuildDb {
  const path = resolve(join(dataDir, GUILD_DB_FILE));
  const hit = OPEN.get(path);
  if (hit) {
    hit.refs += 1;
    return hit.db;
  }
  const db = new GuildDb(path);
  OPEN.set(path, { db, refs: 1 });
  return db;
}

export function closeGuildDb(db: GuildDb): void {
  const hit = OPEN.get(db.path);
  if (!hit || hit.db !== db) {
    try {
      db.sqlite.close();
    } catch {
      /* already closed */
    }
    return;
  }
  hit.refs -= 1;
  if (hit.refs > 0) return;
  OPEN.delete(db.path);
  db.sqlite.close();
}

function rmIfExists(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true });
}
