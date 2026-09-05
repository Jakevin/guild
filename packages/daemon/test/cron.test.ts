import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  followingRun,
  parseCronSchedule,
  nextRunAt,
  tokenizeCronSlash,
} from "../src/cron-schedule.ts";
import {
  createCronJob,
  executeCronjob,
  fireCronJob,
  pauseCronJob,
  publicCronJob,
  updateCronJob,
} from "../src/cron.ts";
import { writeModelsFile } from "../src/llm.ts";
import { GuildStore } from "../src/store.ts";
import { closeServer, listen as listenApp } from "./app.ts";
import { guildTools } from "../src/tools.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-cron-"));
}

test("Hermes-shaped schedules: in 30m, bare 30m is every, cron, ISO", () => {
  const now = Date.parse("2026-09-02T12:00:00");
  const once = parseCronSchedule("in 30m", now);
  assert.equal(once.kind, "once");
  assert.equal(once.atMs, now + 30 * 60_000);
  const everyBare = parseCronSchedule("30m", now);
  assert.equal(everyBare.kind, "every");
  assert.equal(everyBare.everyMs, 30 * 60_000);
  const every = parseCronSchedule("every 2h", now);
  assert.equal(every.kind, "every");
  assert.equal(every.everyMs, 2 * 3_600_000);
  const cron = parseCronSchedule("0 9 * * 1-5", now);
  assert.equal(cron.kind, "cron");
  const iso = parseCronSchedule("2026-09-03T09:00:00Z", now);
  assert.equal(iso.kind, "once");
  assert.equal(followingRun(once, now), null);
  assert.equal(nextRunAt(every, now), now + every.everyMs);
  const raised = parseCronSchedule("every 5s", now);
  assert.equal(raised.everyMs, 60_000);
});

test("natural-language schedules: 每10分鐘, 10分鐘後, 每天9點", () => {
  const now = Date.parse("2026-09-02T12:00:00");
  const every = parseCronSchedule("每10分鐘", now);
  assert.equal(every.kind, "every");
  assert.equal(every.everyMs, 10 * 60_000);
  const spaced = parseCronSchedule("每 2 小時", now);
  assert.equal(spaced.kind, "every");
  assert.equal(spaced.everyMs, 2 * 3_600_000);
  const later = parseCronSchedule("10分鐘後", now);
  assert.equal(later.kind, "once");
  assert.equal(later.atMs, now + 10 * 60_000);
  const daily = parseCronSchedule("每天9點", now);
  assert.equal(daily.kind, "cron");
  assert.equal(daily.cron, "0 9 * * *");
  const evening = parseCronSchedule("每天晚上9點", now);
  assert.equal(evening.kind, "cron");
  assert.equal(evening.cron, "0 21 * * *");
  const half = parseCronSchedule("每天9點30分", now);
  assert.equal(half.cron, "30 9 * * *");
  const enEvery = parseCronSchedule("every 10 minutes", now);
  assert.equal(enEvery.everyMs, 10 * 60_000);
});

test("tokenizeCronSlash keeps quoted schedule and prompt", () => {
  assert.deepEqual(tokenizeCronSlash('add "every 2h" "Check disk"'), [
    "add",
    "every 2h",
    "Check disk",
  ]);
});

test("createCronJob stores a future nextRunAt; cronRun cannot manage cron", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const store = new GuildStore(dataDir);
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(infra);
    const room = store.createChannel("ops");
    store.addMember(room.id, infra.id);
    const job = createCronJob(store, {
      roomId: room.id,
      botId: infra.id,
      prompt: "Check disk space on this machine.",
      schedule: "every 2h",
      name: "disk",
    });
    assert.equal(job.kind, "every");
    assert.ok(Date.parse(job.nextRunAt) > Date.now());
    assert.equal(store.listCronJobs(room.id).length, 1);
    assert.equal(publicCronJob(job).name, "disk");
    const viaCtx = await Promise.resolve(
      executeCronjob(
        store,
        { action: "create", schedule: "每10分鐘", prompt: "Say hi." },
        { roomId: room.id, botId: infra.id },
      ),
    );
    assert.equal(viaCtx.isError, false);
    assert.match(viaCtx.text, /created /);
    assert.equal(store.listCronJobs(room.id).length, 2);
    const blocked = executeCronjob(
      store,
      { action: "create", schedule: "every 1h", prompt: "nope" },
      { cronRun: true, roomId: room.id },
    );
    assert.equal(blocked.isError, true);
    assert.match(blocked.text, /cannot manage cron/);
    const tools = guildTools([], { cronRun: true }).map((tool) => tool.name);
    assert.ok(!tools.includes("cronjob"));
    assert.ok(guildTools([]).some((tool) => tool.name === "cronjob"));
  } finally {
    store.close();
  }
});

test("fireCronJob skips when the hall is already busy", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const store = new GuildStore(dataDir);
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(infra);
    const room = store.createChannel("ops");
    store.addMember(room.id, infra.id);
    const job = createCronJob(store, {
      roomId: room.id,
      botId: infra.id,
      prompt: "Ping",
      schedule: "in 30m",
    });
    store.setLiveTurn(room.id, {
      botId: infra.id,
      thinking: "busy",
      steps: [],
      startedAt: new Date().toISOString(),
    });
    const skipped = await fireCronJob(store, job.id, {});
    assert.equal(skipped.ok, false);
    assert.equal(skipped.skipped, "seat busy");
    assert.equal(store.listMessages(room.id).length, 0);
    assert.equal(store.listCronRuns(job.id).length, 0);
    const forced = await fireCronJob(store, job.id, {}, {}, { force: true });
    assert.equal(forced.ok, false);
    assert.equal(forced.skipped, "seat busy");
    assert.equal(store.listCronRuns(job.id).length, 1);
    assert.equal(store.listCronRuns(job.id)[0].status, "skipped");
  } finally {
    store.close();
  }
});

test("fireCronJob skips a paused live bubble on that seat", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const store = new GuildStore(dataDir);
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(infra);
    const room = store.createChannel("ops");
    store.addMember(room.id, infra.id);
    const job = createCronJob(store, {
      roomId: room.id,
      botId: infra.id,
      prompt: "Ping",
      schedule: "in 30m",
    });
    store.setLiveTurn(room.id, {
      botId: infra.id,
      thinking: "held",
      steps: [],
      startedAt: new Date().toISOString(),
      paused: true,
    });
    const skipped = await fireCronJob(store, job.id, {});
    assert.equal(skipped.ok, false);
    assert.equal(skipped.skipped, "seat busy");
    assert.equal(store.getCronJob(job.id).paused, false);
  } finally {
    store.close();
  }
});

test("fireCronJob does not consume a once job when the seat aborts", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const store = new GuildStore(dataDir);
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(infra);
    const room = store.createChannel("ops");
    store.addMember(room.id, infra.id);
    const job = createCronJob(store, {
      roomId: room.id,
      botId: infra.id,
      prompt: "Ping",
      schedule: "in 30m",
    });
    const err = new Error("stopped");
    err.name = "AbortError";
    pauseCronJob(store, job.id);
    const pausedSkip = await fireCronJob(store, job.id, {});
    assert.equal(pausedSkip.skipped, "paused");
    assert.equal(store.listCronRuns(job.id).length, 0);
    const result = await fireCronJob(
      store,
      job.id,
      {},
      {
        turn: async () => {
          throw err;
        },
      },
      { force: true },
    );
    assert.equal(result.ok, false);
    assert.equal(result.skipped, "no reply");
    const kept = store.getCronJob(job.id);
    assert.equal(kept.paused, true);
    assert.equal(kept.lastStatus, "failed");
    const runs = store.listCronRuns(job.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "failed");
  } finally {
    store.close();
  }
});

test("updateCronJob rewrites name, prompt, and schedule", () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const store = new GuildStore(dataDir);
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(infra);
    const room = store.createChannel("ops");
    store.addMember(room.id, infra.id);
    const job = createCronJob(store, {
      roomId: room.id,
      botId: infra.id,
      prompt: "Check disk.",
      schedule: "every 2h",
      name: "disk",
    });
    pauseCronJob(store, job.id);
    const updated = updateCronJob(store, job.id, {
      name: "disk-watch",
      prompt: "Say hi.",
      schedule: "每10分鐘",
    });
    assert.equal(updated.name, "disk-watch");
    assert.equal(updated.prompt, "Say hi.");
    assert.equal(updated.kind, "every");
    assert.equal(updated.everyMs, 10 * 60_000);
    assert.equal(updated.paused, true);
    const viaTool = executeCronjob(
      store,
      { action: "update", job_id: job.id, name: "via-tool" },
      { roomId: room.id },
    );
    assert.equal(viaTool.isError, false);
    assert.match(viaTool.text, /via-tool/);
  } finally {
    store.close();
  }
});

test("crontab weekday 7 is Sunday; day OR weekday when both are set", () => {
  const sunday = Date.parse("2026-09-06T09:00:00");
  const monday = Date.parse("2026-09-07T09:00:00");
  const first = Date.parse("2026-09-01T09:00:00");
  assert.equal(parseCronSchedule("0 9 * * 7", sunday).kind, "cron");
  assert.equal(nextRunAt(parseCronSchedule("0 9 * * 7", sunday - 60_000), sunday - 60_000), sunday);
  const either = parseCronSchedule("0 9 1 * 1", first - 60_000);
  assert.equal(nextRunAt(either, first - 60_000), first);
  const nextMon = nextRunAt(parseCronSchedule("0 9 1 * 1", monday - 60_000), monday - 60_000);
  assert.equal(nextMon, monday);
});

test("POST /cron round-trips and DELETE removes", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const store = new GuildStore(dataDir);
  const { server, origin } = await listenApp(dataDir, {});
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(infra);
    const created = await fetch(`${origin}/channels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ops" }),
    });
    const channel = (await created.json()) as { id: string };
    await fetch(`${origin}/channels/${channel.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: infra.id }),
    });
    const posted = await fetch(`${origin}/cron`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: channel.id,
        botId: infra.id,
        schedule: "every 2h",
        prompt: "Check disk space.",
        name: "disk",
      }),
    });
    assert.equal(posted.status, 201);
    const job = (await posted.json()) as { id: string; name: string };
    assert.equal(job.name, "disk");
    const listed = await fetch(`${origin}/cron?room=${channel.id}`);
    const body = (await listed.json()) as { jobs: { id: string }[] };
    assert.equal(body.jobs.length, 1);
    const paused = await fetch(`${origin}/cron/${job.id}/pause`, { method: "POST" });
    assert.equal(paused.status, 200);
    const got = await fetch(`${origin}/cron/${job.id}`);
    assert.equal(got.status, 200);
    const one = (await got.json()) as { name: string; runs: unknown[]; paused: boolean };
    assert.equal(one.name, "disk");
    assert.equal(one.paused, true);
    assert.ok(Array.isArray(one.runs));
    const patched = await fetch(`${origin}/cron/${job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "disk-2", schedule: "every 3h" }),
    });
    assert.equal(patched.status, 200);
    const afterPatch = (await patched.json()) as { name: string; schedule: string };
    assert.equal(afterPatch.name, "disk-2");
    assert.equal(afterPatch.schedule, "every 3h");
    const removed = await fetch(`${origin}/cron/${job.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const empty = await fetch(`${origin}/cron?room=${channel.id}`);
    const after = (await empty.json()) as { jobs: unknown[] };
    assert.equal(after.jobs.length, 0);
  } finally {
    await closeServer(server);
    store.close();
  }
});

test("channel jobs default to hall; sheet fire stays off the quest", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const store = new GuildStore(dataDir);
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(infra);
    const room = store.createChannel("ops");
    store.addMember(room.id, infra.id);
    const hall = createCronJob(store, {
      roomId: room.id,
      botId: infra.id,
      prompt: "Ping hall",
      schedule: "in 30m",
    });
    assert.equal(hall.scope, "channel");
    assert.equal(hall.delivery, "hall");
    const sheet = createCronJob(store, {
      roomId: room.id,
      botId: infra.id,
      prompt: "Ping sheet",
      schedule: "in 30m",
      delivery: "sheet",
      name: "quiet",
    });
    assert.equal(sheet.delivery, "sheet");
    assert.ok(sheet.sessionRoomId);
    assert.equal(store.listChannels().some((item) => item.kind === "cron"), false);
    store.setLiveTurn(room.id, {
      botId: infra.id,
      thinking: "busy",
      steps: [],
      startedAt: new Date().toISOString(),
    });
    const skippedHall = await fireCronJob(store, hall.id, {});
    assert.equal(skippedHall.skipped, "seat busy");
    const reply = {
      body: "sheet ok",
      parts: [],
      source: "llm" as const,
      system: "",
    };
    const fired = await fireCronJob(
      store,
      sheet.id,
      {},
      { turn: async () => reply },
      { force: true },
    );
    assert.equal(fired.ok, true);
    assert.equal(store.listMessages(room.id).length, 0);
    const done = store.getCronJob(sheet.id);
    assert.equal(done.paused, true);
    assert.equal(done.lastStatus, "ok");
    const session = store.getRoom(store.cronSessionRoomId(sheet.id));
    assert.equal(session?.kind, "cron");
    assert.ok(store.listMessages(session.id).length >= 2);
  } finally {
    store.close();
  }
});

test("independent bot jobs have no hall room and never list as a channel", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const store = new GuildStore(dataDir);
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(infra);
    const job = createCronJob(store, {
      botId: infra.id,
      prompt: "Check https://example.com",
      schedule: "every 1h",
      name: "uptime",
      scope: "bot",
    });
    assert.equal(job.scope, "bot");
    assert.equal(job.delivery, "sheet");
    assert.equal(publicCronJob(job).roomId, null);
    assert.equal(store.listChannels().some((ch) => ch.id === job.roomId), false);
    const session = store.getRoom(job.roomId);
    assert.equal(session?.kind, "cron");
    const reply = {
      body: "up",
      parts: [],
      source: "llm" as const,
      system: "",
    };
    const fired = await fireCronJob(
      store,
      job.id,
      {},
      { turn: async () => reply },
    );
    assert.equal(fired.ok, true);
    assert.ok(store.listMessages(job.roomId).some((msg) => msg.body.includes("up")));
  } finally {
    store.close();
  }
});
