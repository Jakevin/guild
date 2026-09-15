import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chatTurnSystem } from "../src/handlers.ts";
import { writeModelsFile } from "../src/llm.ts";
import {
  applyMemoryUpdate,
  buildTidyPrompt,
  clipTidyAsk,
  localMergeQuestMemory,
  parseTidyMemory,
  shouldHarvestMemory,
  stampMemoryUpdated,
} from "../src/memory.ts";
import { closeServer, listen as listenApp } from "./app.ts";
import { bareDmRoomId, GuildStore, isBareDmId } from "../src/store.ts";

const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-memory-"));
}

async function listen(dataDir: string) {
  writeModelsFile(dataDir, { default: null, providers: {} });
  const app = await listenApp(dataDir, {});
  return { server: app.server, origin: app.origin };
}

async function json(origin: string, path: string, init?: RequestInit) {
  const response = await fetch(`${origin}${path}`, init);
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

test("shouldHarvestMemory skips greetings and empty turns", () => {
  assert.equal(shouldHarvestMemory("早安"), false);
  assert.equal(shouldHarvestMemory("hi!"), false);
  assert.equal(shouldHarvestMemory("ok"), false);
  assert.equal(
    shouldHarvestMemory("之後這個專案用 pnpm，測試指令是 pnpm test"),
    true,
  );
});

test("localMergeQuestMemory appends a closed quest under a heading", () => {
  const merged = localMergeQuestMemory(
    "# Parent\n- keep H1 Pixelify\n",
    "# pages\n- four locales on site/index.html\n",
    "pages",
  );
  assert.match(String(merged), /Pixelify/);
  assert.match(String(merged), /site\/index\.html/);
  assert.match(String(merged), /## pages/);
  assert.equal(localMergeQuestMemory("# same", "", "x"), null);
});

test("stampMemoryUpdated upserts an ISO header and leaves empty files empty", () => {
  const now = new Date("2026-09-07T01:26:28.717Z");
  assert.equal(stampMemoryUpdated("", now), "");
  assert.equal(
    stampMemoryUpdated("# Room\n- ship Friday", now),
    "Updated: 2026-09-07T01:26:28Z\n\n# Room\n- ship Friday",
  );
  assert.equal(
    stampMemoryUpdated("Updated: 2026-01-01T00:00:00Z\n\n- keep", now),
    "Updated: 2026-09-07T01:26:28Z\n\n- keep",
  );
});

test("clipTidyAsk trims and the tidy prompt treats ask as the live task", () => {
  assert.equal(clipTidyAsk("  刪除v0.2.26降版的記憶  "), "刪除v0.2.26降版的記憶");
  assert.equal(clipTidyAsk("x".repeat(600)).length, 500);
  const prompt = buildTidyPrompt({
    scope: "bot",
    current: "- 過期 v0.2.26 切版作廢\n- 線上 v0.2.33",
    ask: "刪除v0.2.26降版的記憶",
  });
  assert.match(prompt, /Live task/);
  assert.match(prompt, /刪除v0\.2\.26降版的記憶/);
  assert.match(prompt, /this is the Plan directive/);
  assert.match(prompt, /wait-for-human blocker after the human already asked/);
  assert.match(prompt, /shipped or withdrawn version cut/);
  assert.doesNotMatch(
    buildTidyPrompt({ scope: "channel", current: "- keep" }),
    /Live task/,
  );
});

test("parseTidyMemory reads harness JSON and dates the file", () => {
  const now = new Date("2026-09-07T01:26:28.717Z");
  const parsed = parseTidyMemory(
    JSON.stringify({
      plan: "Drop void 0.2.26; keep current 0.2.33",
      needs: ["v0.2.34 scope"],
      dropped: ["PID trivia"],
      body: "## Current\n- 2026-09-07 online v0.2.33",
    }),
    now,
  );
  assert.ok(parsed);
  assert.match(parsed.body, /^Updated: 2026-09-07T01:26:28Z/);
  assert.match(parsed.body, /online v0\.2\.33/);
  assert.equal(parsed.needs[0], "v0.2.34 scope");
  assert.match(parsed.proposal, /Still open|Needs/);
  assert.match(parsed.proposal, /v0\.2\.34 scope/);
});

test("applyMemoryUpdate keeps NO_CHANGE and redacts keys", () => {
  assert.equal(applyMemoryUpdate("# old", "NO_CHANGE"), null);
  assert.equal(applyMemoryUpdate("# old", "no_change"), null);
  assert.equal(applyMemoryUpdate("# same", "# same"), null);
  const next = applyMemoryUpdate(
    "",
    "# Memory\n- uses sk-abcdefghijklmnop\n- prefers pnpm",
  );
  assert.match(String(next), /\[redacted-key\]/);
  assert.match(String(next), /pnpm/);
});

test("bot and channel MEMORY.md round-trip; DMs have no channel memory", async () => {
  const dataDir = tempHome();
  const { server, origin } = await listen(dataDir);
  try {
    const space = (await json(origin, "/workspace")).body as {
      bots: { id: string; handle: string }[];
    };
    const rd = space.bots.find((bot) => bot.handle === "rd");
    assert.ok(rd);

    const emptyBot = await json(origin, `/bots/${rd.id}/memory.md`);
    assert.equal(emptyBot.status, 200);
    assert.equal(emptyBot.body.body, "");

    const savedBot = await json(origin, `/bots/${rd.id}/memory.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "# Bot memory\n- RD owns reviews" }),
    });
    assert.equal(savedBot.status, 200);
    assert.match(String(savedBot.body.body), /RD owns reviews/);
    assert.match(String(savedBot.body.body), /^Updated: \d{4}-\d{2}-\d{2}T/);

    const firstLog = await json(origin, `/bots/${rd.id}/memory.md/log`);
    assert.equal(firstLog.status, 200);
    assert.equal((firstLog.body.entries as unknown[]).length, 0);

    const savedBot2 = await json(origin, `/bots/${rd.id}/memory.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "# Bot memory\n- RD owns reviews\n- prefers pnpm" }),
    });
    assert.equal(savedBot2.status, 200);
    const botLog = await json(origin, `/bots/${rd.id}/memory.md/log`);
    assert.equal(botLog.status, 200);
    const botEntries = botLog.body.entries as { id: string }[];
    assert.equal(botEntries.length, 1);
    const restored = await json(origin, `/bots/${rd.id}/memory.md/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: botEntries[0].id }),
    });
    assert.equal(restored.status, 200);
    assert.match(String(restored.body.body), /RD owns reviews/);
    assert.doesNotMatch(String(restored.body.body), /prefers pnpm/);

    const created = await json(origin, "/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "desk" }),
    });
    const channelId = created.body.id as string;
    const savedRoom = await json(origin, `/channels/${channelId}/memory.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "# Room memory\n- ship Friday" }),
    });
    assert.equal(savedRoom.status, 200);
    assert.match(String(savedRoom.body.body), /^Updated: \d{4}-\d{2}-\d{2}T/);
    assert.match(String(savedRoom.body.body), /ship Friday/);

    const store = new GuildStore(dataDir);
    assert.match(store.readBotMemory(rd.id), /RD owns reviews/);
    assert.match(store.readChannelMemory(channelId), /ship Friday/);
    assert.match(chatTurnSystem(store, channelId, rd.id), /MEMORY\.md/);
    assert.match(chatTurnSystem(store, channelId, rd.id), /dated standing notes/);
    assert.match(chatTurnSystem(store, channelId, rd.id), /Not the live task/);
    assert.match(chatTurnSystem(store, channelId, rd.id), /latest human message is the live task/);
    assert.match(chatTurnSystem(store, channelId, rd.id), /RD owns reviews/);
    assert.match(chatTurnSystem(store, channelId, rd.id), /ship Friday/);

    const emptyTidy = await json(
      origin,
      `/channels/${channelId}/memory.md/tidy`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "" }),
      },
    );
    assert.equal(emptyTidy.status, 400);
    assert.equal(emptyTidy.body.error, "memory is empty");

    const noModel = await json(origin, `/bots/${rd.id}/memory.md/tidy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "- keep pnpm" }),
    });
    assert.equal(noModel.status, 400);
    assert.equal(noModel.body.error, "no model connected");

    const dm = await json(origin, `/dms/${rd.id}/memory.md`);
    assert.equal(dm.status, 400);

    const dmTurn = chatTurnSystem(store, store.openDm(rd.id).id, rd.id);
    assert.match(dmTurn, /RD owns reviews/);
    assert.doesNotMatch(dmTurn, /ship Friday/);
  } finally {
    await closeServer(server);
  }
});

test("incognito whisper skips MEMORY.md inject and keeps a separate transcript", async () => {
  const dataDir = tempHome();
  const store = new GuildStore(dataDir);
  const rd = store.listBots().find((bot) => bot.handle === "rd");
  assert.ok(rd);
  store.writeBotMemory(rd.id, "# Bot memory\n- SECRET_STANDING_NOTE");
  const whisper = store.openDm(rd.id);
  const bare = store.openBareDm(rd.id);
  assert.equal(isBareDmId(bare.id), true);
  assert.equal(bareDmRoomId(rd.id), bare.id);
  assert.equal(bare.kind, "dm");
  store.appendMessage(whisper.id, "you", "regular standing chat");
  store.appendMessage(bare.id, "you", "probe soul without memory");
  assert.equal(
    store.lastMessagePreview(`dm-${rd.id}`)?.body,
    "regular standing chat",
  );
  assert.match(store.lastMessagePreview(bare.id)?.body || "", /probe soul/);
  const bareSys = chatTurnSystem(store, bare.id, rd.id);
  assert.match(bareSys, /incognito whisper/);
  assert.match(bareSys, /Only you speak here/);
  assert.doesNotMatch(bareSys, /SECRET_STANDING_NOTE/);
  assert.doesNotMatch(bareSys, /# MEMORY.md/);
  const dmSys = chatTurnSystem(store, whisper.id, rd.id);
  assert.match(dmSys, /SECRET_STANDING_NOTE/);
  store.close();

  writeModelsFile(dataDir, { default: null, providers: {} });
  const { server, origin } = await listen(dataDir);
  try {
    const posted = await json(origin, `/dms/bare-${rd.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "probe Position without MEMORY.md" }),
    });
    assert.equal(posted.status, 201);
    const listed = await json(origin, `/dms/bare-${rd.id}/messages`);
    assert.match(JSON.stringify(listed.body), /probe Position without MEMORY.md/);
    const regular = await json(origin, `/dms/${rd.id}/messages`);
    assert.doesNotMatch(
      JSON.stringify(regular.body),
      /probe Position without MEMORY.md/,
    );
    const space = await json(origin, "/workspace");
    const bots = (space.body as { bots: { id: string; lastMessage?: { body?: string } }[] }).bots;
    const bot = bots.find((row) => row.id === rd.id);
    assert.ok(bot);
    assert.doesNotMatch(
      String(bot.lastMessage?.body || ""),
      /probe Position without MEMORY.md/,
    );
    const memory = await json(origin, `/bots/${rd.id}/memory.md`);
    assert.match(String(memory.body.body), /SECRET_STANDING_NOTE/);
  } finally {
    await closeServer(server);
  }

  const after = new GuildStore(dataDir);
  after.deleteBot(rd.id);
  assert.equal(after.getRoom(bare.id), null);
  assert.equal(after.getRoom(whisper.id), null);
  after.close();
});

test("DELETE /dms/bare-id/messages wipes incognito history only", async () => {
  const dataDir = tempHome();
  const store = new GuildStore(dataDir);
  const rd = store.listBots().find((bot) => bot.handle === "rd");
  assert.ok(rd);
  store.writeBotMemory(rd.id, "# Bot memory\n- SECRET_STANDING_NOTE");
  const whisper = store.openDm(rd.id);
  const bare = store.openBareDm(rd.id);
  store.appendMessage(whisper.id, "you", "keep the regular whisper");
  store.appendMessage(bare.id, "you", "throw away this probe");
  store.writeCompact(bare.id, {
    throughId: "turn-1",
    summary: "SECRET_COMPACT",
    updatedAt: "2026-09-14T00:00:00.000Z",
    messageCount: 1,
  });
  store.appendTrajectory(bare.id, [
    {
      ts: "2026-09-14T00:00:00.000Z",
      turnId: "turn-1",
      kind: "user",
      summary: "throw away this probe",
    },
  ]);
  store.close();

  writeModelsFile(dataDir, { default: null, providers: {} });
  const { server, origin } = await listen(dataDir);
  try {
    const refused = await json(origin, `/dms/${rd.id}/messages`, {
      method: "DELETE",
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "can only clear incognito whispers");

    const cleared = await json(origin, `/dms/bare-${rd.id}/messages`, {
      method: "DELETE",
    });
    assert.equal(cleared.status, 200);
    assert.equal((cleared.body as { ok?: boolean }).ok, true);

    const listed = await json(origin, `/dms/bare-${rd.id}/messages`);
    assert.deepEqual(listed.body, []);
    const regular = await json(origin, `/dms/${rd.id}/messages`);
    assert.match(JSON.stringify(regular.body), /keep the regular whisper/);
    const memory = await json(origin, `/bots/${rd.id}/memory.md`);
    assert.match(String(memory.body.body), /SECRET_STANDING_NOTE/);
  } finally {
    await closeServer(server);
  }

  const after = new GuildStore(dataDir);
  assert.ok(after.getRoom(bare.id));
  assert.equal(after.listMessages(bare.id).length, 0);
  assert.equal(after.readCompact(bare.id), null);
  assert.equal(after.listTrajectory(bare.id).length, 0);
  assert.equal(after.listMessages(whisper.id).length, 1);
  assert.match(after.readBotMemory(rd.id), /SECRET_STANDING_NOTE/);
  after.close();
});

test("chat page edits Channel MEMORY.md and bot MEMORY.md", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  assert.match(html, /channel-memory-body/);
  assert.match(html, /\/memory\.md/);
  assert.match(html, /bot-memory/);
  assert.match(html, /bot-card-memory/);
  assert.match(html, /channel-memory-tidy/);
  assert.match(html, /bot-memory-tidy/);
  assert.match(html, /channel-memory-ask/);
  assert.match(html, /bot-memory-ask/);
  assert.match(html, /memory\.md\/tidy/);
  assert.match(html, /memory\.md\/log/);
  assert.match(html, /memory\.md\/restore/);
  assert.match(html, /runMemoryTidy/);
  assert.match(html, /fillMemoryLog/);
  assert.match(html, /memory\.tidySaved/);
  assert.match(html, /bot-memory-restore/);
  assert.match(html, /channel-memory-restore/);
});
