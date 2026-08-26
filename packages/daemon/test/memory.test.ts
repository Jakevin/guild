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
  shouldHarvestMemory,
} from "../src/memory.ts";
import { createGuildServer, listenGuildServer } from "../src/server.ts";
import { GuildStore } from "../src/store.ts";

const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-memory-"));
}

async function listen(dataDir: string) {
  writeModelsFile(dataDir, { default: null, providers: {} });
  const server = createGuildServer({ dataDir, env: {} });
  const bound = await listenGuildServer(server, "127.0.0.1", 0);
  return { server, origin: `http://127.0.0.1:${bound.port}` };
}

async function closeServer(server: {
  close: (cb: (err?: Error) => void) => void;
}) {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
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

    const store = new GuildStore(dataDir);
    assert.match(store.readBotMemory(rd.id), /RD owns reviews/);
    assert.match(store.readChannelMemory(channelId), /ship Friday/);
    assert.match(chatTurnSystem(store, channelId, rd.id), /MEMORY\.md/);
    assert.match(chatTurnSystem(store, channelId, rd.id), /RD owns reviews/);
    assert.match(chatTurnSystem(store, channelId, rd.id), /ship Friday/);

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
});
