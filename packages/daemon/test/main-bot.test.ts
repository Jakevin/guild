import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildChatSystem } from "../src/generate.ts";
import { chatTurnSystem } from "../src/handlers.ts";
import { gateTool } from "../src/harness.ts";
import { createSeat, runMainTool, stageAssign } from "../src/main-bot.ts";
import { callMainTool } from "../src/plugins/main-bot.ts";
import { GuildStore, StoreError } from "../src/store.ts";
import { knownToolNames } from "../src/tools.ts";
import { closeApp, listen } from "./app.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-main-"));
}

function general(store: GuildStore) {
  const room = store.listChannels().find((item) => item.name === "general");
  assert.ok(room);
  return room;
}

test("Main Bot leaves every roster and returns to #general when cleared", () => {
  const dir = tempHome();
  const store = new GuildStore(dir);
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    const pm = store.listBots().find((bot) => bot.handle === "pm");
    assert.ok(infra && pm);
    assert.ok(general(store).memberIds.includes(infra.id));

    store.setMainBot(infra.id);
    assert.equal(store.mainBotId(), infra.id);
    assert.equal(general(store).memberIds.includes(infra.id), false);
    assert.throws(
      () => store.addMember(general(store).id, infra.id),
      (error: unknown) =>
        error instanceof StoreError && error.message === "公會會長不進據點編制。",
    );

    store.setMainBot(pm.id);
    assert.equal(store.isMainBot(pm.id), true);
    assert.equal(store.isMainBot(infra.id), false);
    assert.equal(general(store).memberIds.includes(pm.id), false);
    assert.equal(general(store).memberIds.includes(infra.id), true);

    store.clearMainBot();
    assert.equal(store.mainBotId(), "");
    assert.equal(general(store).memberIds.includes(pm.id), true);
  } finally {
    store.close();
  }
});

test("a restart keeps the Main Bot off #general", () => {
  const dir = tempHome();
  const first = new GuildStore(dir);
  const infra = first.listBots().find((bot) => bot.handle === "infra");
  assert.ok(infra);
  first.setMainBot(infra.id);
  first.close();

  const again = new GuildStore(dir);
  try {
    assert.equal(again.mainBotId(), infra.id);
    assert.equal(general(again).memberIds.includes(infra.id), false);
  } finally {
    again.close();
  }
});

test("deleteBot forgets the Main Bot mark", () => {
  const dir = tempHome();
  const store = new GuildStore(dir);
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(infra);
    store.setMainBot(infra.id);
    store.deleteBot(infra.id);
    assert.equal(store.mainBotId(), "");
  } finally {
    store.close();
  }
});

test("create_bot and create_channel stay ordinary seats", async () => {
  const dir = tempHome();
  const store = new GuildStore(dir);
  try {
    const fromPath = await runMainTool(store, "create_bot", {
      path: JSON.stringify({ name: "日本會計師", handle: "jp-accounting" }),
    });
    assert.equal(fromPath.isError, false);
    assert.match(fromPath.text, /@jp-accounting/);

    const seat = createSeat(store, { name: "Scout", handle: "scout" });
    assert.equal(store.isMainBot(seat.id), false);
    assert.equal(general(store).memberIds.includes(seat.id), true);

    const opened = await runMainTool(store, "create_channel", { name: "ops" });
    assert.equal(opened.isError, false);
    const ops = store.listChannels().find((room) => room.name === "ops");
    assert.ok(ops);
    assert.deepEqual(ops.memberIds, []);
  } finally {
    store.close();
  }
});

test("assign adds the seat, then writes a line-start @handle", () => {
  const dir = tempHome();
  const store = new GuildStore(dir);
  try {
    const room = store.createChannel("ops");
    const staged = stageAssign(store, {
      channel: "ops",
      handles: ["pm"],
      task: "看這次部署的 log",
    });
    assert.equal(staged.roomId, room.id);
    assert.match(staged.body, /^@pm\n/);
    assert.match(staged.body, /看這次部署的 log/);
    const pm = store.listBots().find((bot) => bot.handle === "pm");
    assert.ok(pm);
    assert.equal(store.getRoom(room.id)?.memberIds.includes(pm.id), true);

    store.setMainBot(pm.id);
    assert.throws(
      () =>
        stageAssign(store, {
          channel: "ops",
          handles: ["pm"],
          task: "再看一次",
        }),
      (error: unknown) => error instanceof StoreError,
    );
  } finally {
    store.close();
  }
});

test("a normal seat cannot call Main Bot tools", async () => {
  const dir = tempHome();
  const store = new GuildStore(dir);
  try {
    const before = store.listChannels().length;
    const denied = await callMainTool(
      store,
      "create_channel",
      { name: "secret" },
      false,
    );
    assert.equal(denied.isError, true);
    assert.equal(denied.text, "only the guild master can do that");
    assert.equal(store.listChannels().length, before);
    assert.equal(knownToolNames({}).includes("create_bot"), false);
    assert.equal(knownToolNames({ main: true }).includes("assign"), true);
    assert.equal(gateTool("create_bot", {}, { sandbox: "read_only" }), null);
  } finally {
    store.close();
  }
});

test("Main Bot prompt is the manager, a seat prompt still refuses recruiting", () => {
  const dir = tempHome();
  const store = new GuildStore(dir);
  try {
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(infra);
    const seat = chatTurnSystem(store, general(store).id, infra.id);
    assert.match(seat, /Do not recruit extra people/);
    assert.doesNotMatch(seat, /公會會長/);

    store.setMainBot(infra.id);
    const dm = store.openDm(infra.id);
    const main = chatTurnSystem(store, dm.id, infra.id);
    assert.match(main, /the guild master \(公會會長\) of this Guild/);
    assert.match(main, /create_bot/);
    assert.doesNotMatch(main, /Do not recruit extra people/);

    const direct = buildChatSystem({
      botName: infra.name,
      handle: infra.handle,
      soul: "",
      agent: "",
      position: "",
      main: true,
      whisper: true,
    });
    assert.match(direct, /# Guild Master/);
    assert.doesNotMatch(direct, /# Whisper/);
  } finally {
    store.close();
  }
});

test("GET PUT DELETE /main-bot", async () => {
  const dir = tempHome();
  const app = await listen(dir);
  try {
    const origin = app.origin;
    const empty = await fetch(`${origin}/main-bot`);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { bot: null });

    const bench = (await (await fetch(`${origin}/bots`)).json()) as {
      id: string;
      handle: string;
      main?: boolean;
    }[];
    const infra = bench.find((bot) => bot.handle === "infra");
    const pm = bench.find((bot) => bot.handle === "pm");
    assert.ok(infra && pm);

    const missing = await fetch(`${origin}/main-bot`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(missing.status, 400);

    const set = await fetch(`${origin}/main-bot`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: infra.id }),
    });
    assert.equal(set.status, 200);
    const marked = (await set.json()) as { id: string; main?: boolean };
    assert.equal(marked.id, infra.id);
    assert.equal(marked.main, true);

    const space = (await (await fetch(`${origin}/workspace`)).json()) as {
      bots: { id: string; main?: boolean }[];
      channels: { name: string; memberIds: string[] }[];
    };
    assert.equal(space.bots.find((bot) => bot.id === infra.id)?.main, true);
    const hall = space.channels.find((room) => room.name === "general");
    assert.ok(hall);
    assert.equal(hall.memberIds.includes(infra.id), false);

    const gone = await fetch(`${origin}/main-bot`, { method: "DELETE" });
    assert.equal(gone.status, 200);
    assert.deepEqual(await gone.json(), { bot: null });
    const after = (await (await fetch(`${origin}/workspace`)).json()) as {
      channels: { name: string; memberIds: string[] }[];
    };
    const restored = after.channels.find((room) => room.name === "general");
    assert.ok(restored);
    assert.equal(restored.memberIds.includes(infra.id), true);
  } finally {
    await closeApp(app);
  }
});
