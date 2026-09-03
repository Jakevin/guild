import { randomUUID } from "node:crypto";
import type { CronJobRow } from "./db.ts";
import type { HandlerExtras } from "./handlers.ts";
import { StoreError, type GuildStore } from "./store.ts";
import type { ToolContext, ToolOutcome } from "./tools.ts";
import {
  CRON_JOB_CAP,
  CRON_MIN_EVERY_MS,
  followingRun,
  nextRunAt,
  parseCronSchedule,
  tokenizeCronSlash,
  type CronSpec,
} from "./cron-schedule.ts";

const inflight = new Set<string>();

function specOf(job: CronJobRow): CronSpec {
  return {
    raw: job.schedule,
    kind: job.kind,
    atMs: job.atMs,
    everyMs: job.everyMs,
    cron: job.cronExpr,
  };
}

export function publicCronJob(job: CronJobRow) {
  return {
    id: job.id,
    name: job.name,
    roomId: job.roomId,
    botId: job.botId,
    prompt: job.prompt,
    schedule: job.schedule,
    kind: job.kind,
    nextRunAt: job.nextRunAt,
    paused: job.paused,
    createdAt: job.createdAt,
    lastRunAt: job.lastRunAt,
    lastStatus: job.lastStatus,
    lastError: job.lastError,
    running: inflight.has(job.id),
  };
}

export function createCronJob(
  store: GuildStore,
  input: {
    roomId: string;
    botId: string;
    prompt: string;
    schedule: string;
    name?: string;
  },
): CronJobRow {
  const room = store.getRoom(input.roomId);
  if (!room) throw new StoreError(404, "room not found");
  const bot = store.getBot(input.botId);
  if (!bot) throw new StoreError(400, "bot not found");
  if (room.kind === "channel" && !room.memberIds.includes(bot.id)) {
    throw new StoreError(400, "bot is not on this quest");
  }
  const prompt = input.prompt.trim();
  if (!prompt) throw new StoreError(400, "prompt is required");
  if (store.listCronJobs().length >= CRON_JOB_CAP) {
    throw new StoreError(400, `at most ${CRON_JOB_CAP} cron jobs`);
  }
  let spec;
  try {
    spec = parseCronSchedule(input.schedule);
  } catch (error) {
    throw new StoreError(
      400,
      error instanceof Error ? error.message : String(error),
    );
  }
  const now = Date.now();
  const name =
    (input.name || "").trim() ||
    prompt.replace(/\s+/g, " ").trim().slice(0, 28) ||
    "cron";
  const job: CronJobRow = {
    id: randomUUID(),
    name,
    roomId: room.id,
    botId: bot.id,
    prompt,
    schedule: spec.raw,
    kind: spec.kind,
    everyMs: spec.everyMs,
    cronExpr: spec.cron,
    atMs: spec.atMs,
    nextRunAt: new Date(nextRunAt(spec, now)).toISOString(),
    paused: false,
    createdAt: new Date(now).toISOString(),
  };
  store.writeCronJob(job);
  return job;
}

export function pauseCronJob(store: GuildStore, id: string): CronJobRow {
  const job = store.getCronJob(id);
  job.paused = true;
  store.writeCronJob(job);
  return job;
}

export function resumeCronJob(store: GuildStore, id: string): CronJobRow {
  const job = store.getCronJob(id);
  job.paused = false;
  job.nextRunAt = new Date(nextRunAt(specOf(job), Date.now())).toISOString();
  store.writeCronJob(job);
  return job;
}

export function removeCronJob(store: GuildStore, id: string): { ok: true; id: string } {
  if (!store.deleteCronJob(id)) throw new StoreError(404, "cron job not found");
  return { ok: true, id };
}

function readCronJob(store: GuildStore, id: string): CronJobRow | null {
  try {
    return store.getCronJob(id);
  } catch {
    return null;
  }
}

function commitFiredJob(
  store: GuildStore,
  id: string,
  patch: Partial<CronJobRow> | "delete",
): void {
  const current = readCronJob(store, id);
  if (!current) return;
  if (patch === "delete") {
    store.deleteCronJob(id);
    return;
  }
  store.writeCronJob({
    ...current,
    ...patch,
    id: current.id,
    roomId: current.roomId,
    botId: current.botId,
    paused: current.paused || Boolean(patch.paused),
  });
}

function seatBlocked(store: GuildStore, roomId: string, botId: string): string | null {
  const live = store.listLiveRoomTurns(roomId);
  if (live.some((turn) => turn.botId === botId)) return "seat busy";
  if (live.some((turn) => !turn.paused)) return "room busy";
  return null;
}

function findCronJob(store: GuildStore, ref: string): CronJobRow {
  const id = ref.trim();
  if (!id) throw new StoreError(400, "job id is required");
  const direct = store.listCronJobs().find((job) => job.id === id);
  if (direct) return direct;
  const needle = id.toLowerCase();
  const named = store.listCronJobs().filter((job) => job.name.toLowerCase() === needle);
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    throw new StoreError(
      400,
      `name matches ${named.length} jobs: ${named.map((job) => job.id).join(", ")}`,
    );
  }
  throw new StoreError(404, "cron job not found");
}

export async function fireCronJob(
  store: GuildStore,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  extras: HandlerExtras = {},
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const job = store.getCronJob(id);
  if (job.paused) return { ok: false, skipped: "paused" };
  if (inflight.has(job.id)) return { ok: false, skipped: "already running" };
  const blocked = seatBlocked(store, job.roomId, job.botId);
  if (blocked) return { ok: false, skipped: blocked };
  const room = store.getRoom(job.roomId);
  if (!room) {
    commitFiredJob(store, job.id, {
      paused: true,
      lastStatus: "failed",
      lastError: "room not found",
    });
    return { ok: false, error: "room not found" };
  }
  if (room.kind === "channel" && !room.memberIds.includes(job.botId)) {
    commitFiredJob(store, job.id, {
      paused: true,
      lastStatus: "failed",
      lastError: "bot is not on this quest",
    });
    return { ok: false, error: "bot is not on this quest" };
  }
  const bot = store.getBot(job.botId);
  if (!bot) {
    commitFiredJob(store, job.id, {
      paused: true,
      lastStatus: "failed",
      lastError: "bot not found",
    });
    return { ok: false, error: "bot not found" };
  }
  inflight.add(job.id);
  const now = Date.now();
  const failPatch = (message: string, pauseOnce: boolean): Partial<CronJobRow> => {
    const next = followingRun(specOf(job), now);
    return {
      lastRunAt: new Date(now).toISOString(),
      lastStatus: "failed",
      lastError: message.slice(0, 400),
      paused: pauseOnce && job.kind === "once",
      nextRunAt: new Date(
        next ?? now + CRON_MIN_EVERY_MS,
      ).toISOString(),
    };
  };
  try {
    const { postUserMessage } = await import("./handlers.ts");
    const body = `排程 · ${job.name}\n\n@${bot.handle} ${job.prompt}`;
    const posted = await postUserMessage(
      store,
      job.roomId,
      body,
      env,
      undefined,
      undefined,
      job.botId,
      { ...extras, mentions: [job.botId], harvest: false, cronRun: true },
    );
    const spoke = (posted.replies || []).some((msg) => msg.author === job.botId);
    if (!spoke) {
      commitFiredJob(store, job.id, failPatch("no reply", true));
      return { ok: false, skipped: "no reply" };
    }
    const next = followingRun(specOf(job), now);
    if (next == null) {
      commitFiredJob(store, job.id, "delete");
    } else {
      commitFiredJob(store, job.id, {
        lastRunAt: new Date(now).toISOString(),
        lastStatus: "ok",
        lastError: undefined,
        nextRunAt: new Date(next).toISOString(),
      });
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    commitFiredJob(store, job.id, failPatch(message, true));
    return { ok: false, error: message };
  } finally {
    inflight.delete(job.id);
  }
}

export async function tickCronJobs(
  store: GuildStore,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<void> {
  const due = store
    .listCronJobs()
    .filter((job) => !job.paused && Date.parse(job.nextRunAt) <= now);
  for (const job of due) {
    if (inflight.has(job.id)) continue;
    try {
      await fireCronJob(store, job.id, env);
    } catch {
      /* one job must not block the tick */
    }
  }
}

export function executeCronjob(
  store: GuildStore,
  args: Record<string, unknown>,
  ctx: ToolContext = {},
): Promise<ToolOutcome> | ToolOutcome {
  if (ctx.cronRun) {
    return {
      text: "cron jobs cannot manage cron (Hermes: no recursive scheduling)",
      isError: true,
    };
  }
  const action = String(args.action || args.op || "list").trim().toLowerCase();
  try {
    if (action === "list") {
      const roomId =
        typeof args.room_id === "string" ? args.room_id : ctx.roomId;
      const jobs = store
        .listCronJobs(roomId || undefined)
        .map(publicCronJob);
      return {
        text: jobs.length ? JSON.stringify(jobs, null, 2) : "(no cron jobs)",
        isError: false,
      };
    }
    if (action === "create") {
      const schedule = String(args.schedule || "").trim();
      const prompt = String(args.prompt || args.task || "").trim();
      const roomId =
        (typeof args.room_id === "string" && args.room_id) || ctx.roomId || "";
      const botId =
        (typeof args.bot_id === "string" && args.bot_id) ||
        (typeof args.botId === "string" && args.botId) ||
        ctx.botId ||
        "";
      if (!roomId) throw new StoreError(400, "room_id is required");
      if (!botId) throw new StoreError(400, "bot_id is required");
      const job = createCronJob(store, {
        roomId,
        botId,
        prompt,
        schedule,
        name: typeof args.name === "string" ? args.name : "",
      });
      return {
        text: `created ${job.id} · ${job.name} · next ${job.nextRunAt} · ${job.schedule}`,
        isError: false,
      };
    }
    const ref = String(args.job_id || args.id || args.name || "").trim();
    if (action === "pause") {
      const job = pauseCronJob(store, findCronJob(store, ref).id);
      return { text: `paused ${job.id} · ${job.name}`, isError: false };
    }
    if (action === "resume") {
      const job = resumeCronJob(store, findCronJob(store, ref).id);
      return {
        text: `resumed ${job.id} · next ${job.nextRunAt}`,
        isError: false,
      };
    }
    if (action === "remove" || action === "delete") {
      const job = findCronJob(store, ref);
      removeCronJob(store, job.id);
      return { text: `removed ${job.id} · ${job.name}`, isError: false };
    }
    if (action === "run") {
      const job = findCronJob(store, ref);
      return fireCronJob(store, job.id, ctx.env).then((result) => ({
        text: result.ok
          ? `ran ${job.id}`
          : result.skipped
            ? `skipped ${job.id}: ${result.skipped}`
            : `failed ${job.id}: ${result.error || "error"}`,
        isError: !result.ok && !result.skipped,
      }));
    }
    return { text: `unknown cron action: ${action}`, isError: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: message, isError: true };
  }
}

export function runCronSlash(
  store: GuildStore,
  roomId: string,
  botId: string,
  text: string,
): { text: string; isError: boolean } {
  const tokens = tokenizeCronSlash(text.replace(/^\/cron\b/i, "").trim());
  const action = (tokens[0] || "list").toLowerCase();
  if (action === "list" || action === "") {
    return executeCronjob(store, { action: "list", room_id: roomId }, { roomId });
  }
  if (action === "add" || action === "create") {
    const schedule = tokens[1] || "";
    const prompt = tokens.slice(2).join(" ");
    return executeCronjob(
      store,
      { action: "create", schedule, prompt, room_id: roomId, bot_id: botId },
      { roomId },
    );
  }
  if (
    action === "pause" ||
    action === "resume" ||
    action === "run" ||
    action === "remove" ||
    action === "delete"
  ) {
    return executeCronjob(
      store,
      { action, job_id: tokens[1] || "" },
      { roomId },
    );
  }
  return {
    text: 'usage: /cron list | add "<schedule>" "<prompt>" | pause|resume|run|remove <id>',
    isError: true,
  };
}
