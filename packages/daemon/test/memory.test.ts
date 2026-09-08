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
import { GuildStore } from "../src/store.ts";

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
  assert.match(html, /runMemoryTidy/);
  assert.match(html, /memory\.tidySaved/);
});
