import {
  canReuseCheckpoint,
  packHistory,
  planCompact,
  toHistoryItem,
  DEFAULT_AUTO_COMPACT_TOKENS,
} from "./compact.ts";
import type { GuildStore } from "./store.ts";

/** Skip rooms whose last message is newer than this. */
export const IDLE_COMPACT_MS = 30 * 60 * 1000;

export type IdleCompactOpts = {
  now?: number;
  idleMs?: number;
  limit?: number;
  tokenLimit?: number;
  summarize?: "llm" | "local";
};

export type IdleCompactResult = {
  roomId: string;
  compacted: boolean;
  skipped?: string;
};

function preferForRoom(store: GuildStore, roomId: string) {
  const room = store.getRoom(roomId);
  for (const botId of room?.memberIds ?? []) {
    const model = store.getBot(botId)?.model;
    if (model) return model;
  }
  return store.listBots()[0]?.model ?? null;
}

let inflight: Promise<IdleCompactResult[]> | null = null;

export function resetIdleCompactLockForTests(): void {
  inflight = null;
}

async function runIdleCompact(
  store: GuildStore,
  env: NodeJS.ProcessEnv | undefined,
  opts: IdleCompactOpts,
): Promise<IdleCompactResult[]> {
  const now = opts.now ?? Date.now();
  const idleMs = opts.idleMs ?? IDLE_COMPACT_MS;
  const limit = Math.max(1, opts.limit ?? 1);
  const tokenLimit = opts.tokenLimit ?? DEFAULT_AUTO_COMPACT_TOKENS;
  const out: IdleCompactResult[] = [];
  let wrote = 0;
  for (const room of store.listAllRooms()) {
    if (wrote >= limit) break;
    if (store.getLiveTurn(room.id)) {
      out.push({ roomId: room.id, compacted: false, skipped: "live" });
      continue;
    }
    const lastAt = store.lastMessageAt(room.id);
    if (!lastAt) {
      out.push({ roomId: room.id, compacted: false, skipped: "empty" });
      continue;
    }
    const age = now - Date.parse(lastAt);
    if (!Number.isFinite(age) || age < idleMs) {
      out.push({ roomId: room.id, compacted: false, skipped: "fresh" });
      continue;
    }
    const history = store.listMessages(room.id).map(toHistoryItem);
    if (history.length <= 1) {
      out.push({ roomId: room.id, compacted: false, skipped: "short" });
      continue;
    }
    try {
      const plan = planCompact({
        system: "idle compact",
        history,
        userMessage: "",
        tokenLimit,
        roomId: room.id,
        checkpoint: store.readCompact(room.id),
        skipDefer: true,
      });
      if (plan.mode === "full") {
        out.push({ roomId: room.id, compacted: false, skipped: "under-budget" });
        continue;
      }
      if (canReuseCheckpoint(store.readCompact(room.id), plan.old)) {
        out.push({ roomId: room.id, compacted: false, skipped: "current" });
        continue;
      }
      const stamp = lastAt;
      let persisted = false;
      const packed = await packHistory({
        system: "idle compact",
        history,
        userMessage: "",
        dataDir: store.dataDir,
        env,
        prefer: preferForRoom(store, room.id),
        checkpoint: store.readCompact(room.id),
        tokenLimit,
        summarize: opts.summarize ?? "llm",
        roomId: room.id,
        skipDefer: true,
        onCompact: (checkpoint) => {
          if (store.getLiveTurn(room.id)) return;
          if (store.lastMessageAt(room.id) !== stamp) return;
          store.writeCompact(room.id, checkpoint);
          persisted = true;
        },
      });
      if (packed.compacted && persisted) {
        wrote += 1;
        out.push({ roomId: room.id, compacted: true });
      } else {
        out.push({
          roomId: room.id,
          compacted: false,
          skipped: packed.compacted ? "stale" : "under-budget",
        });
      }
    } catch {
      out.push({ roomId: room.id, compacted: false, skipped: "error" });
    }
  }
  return out;
}

export async function compactIdleRooms(
  store: GuildStore,
  env?: NodeJS.ProcessEnv,
  opts: IdleCompactOpts = {},
): Promise<IdleCompactResult[]> {
  if (inflight) return [];
  const done = runIdleCompact(store, env, opts).finally(() => {
    if (inflight === done) inflight = null;
  });
  inflight = done;
  return done;
}
