import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chatTurnForBot, chatTurnSystem } from "../src/handlers.ts";
import { writeModelsFile } from "../src/llm.ts";
import { createGuildServer, listenGuildServer } from "../src/server.ts";
import { GuildStore } from "../src/store.ts";

const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);
const MARKER = "CHANNEL_MD_UNIQUE_MARKER_9f3a";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-home-"));
}

async function listen(dataDir: string, env: NodeJS.ProcessEnv = {}) {
  const server = createGuildServer({ dataDir, env });
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

async function json(
  origin: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}${path}`, init);
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

test("channel Channel.md round-trips; DMs cannot set or return it", async () => {
  const dataDir = tempHome();
  const { server, origin } = await listen(dataDir, {});
  try {
    const created = await json(origin, "/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ops" }),
    });
    assert.equal(created.status, 201);
    const channelId = created.body.id as string;

    const missing = await json(origin, `/channels/${channelId}/channel.md`);
    assert.equal(missing.status, 200);
    assert.equal(missing.body.body, "");

    const saved = await json(origin, `/channels/${channelId}/channel.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: `# Ops\n${MARKER}` }),
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.body, `# Ops\n${MARKER}`);

    const loaded = await json(origin, `/channels/${channelId}/channel.md`);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.body, `# Ops\n${MARKER}`);

    const space = await json(origin, "/workspace");
    const bots = space.body.bots as { id: string }[];
    const botId = bots[0]?.id;
    assert.ok(botId);
    const dmGet = await json(origin, `/dms/${botId}/channel.md`);
    assert.equal(dmGet.status, 400);
    const dmPut = await json(origin, `/dms/${botId}/channel.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: MARKER }),
    });
    assert.equal(dmPut.status, 400);
  } finally {
    await closeServer(server);
  }
});

test("channel @ turn includes that Channel.md; the same bot's DM does not", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const { server, origin } = await listen(dataDir, {});
  try {
    const created = await json(origin, "/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ops" }),
    });
    const channelId = created.body.id as string;
    await json(origin, `/channels/${channelId}/channel.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: MARKER }),
    });
    const store = new GuildStore(dataDir);
    const rd = store.listBots().find((bot) => bot.handle === "rd");
    const pm = store.listBots().find((bot) => bot.handle === "pm");
    assert.ok(rd && pm);
    for (const bot of [rd, pm]) {
      const added = await json(origin, `/channels/${channelId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId: bot.id }),
      });
      assert.equal(added.status, 200);
    }
    const posted = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "@rd 請依 Channel.md 回" }),
    });
    assert.equal(posted.status, 201);
    const replies = posted.body.replies as { author: string }[];
    assert.equal(replies.length, 1);
    assert.equal(replies[0].author, rd.id);

    const channelTurn = chatTurnForBot(
      store,
      channelId,
      rd.id,
      [],
      "@rd 請依 Channel.md 回",
    );
    assert.equal(channelTurn.channelMd, MARKER);
    assert.match(chatTurnSystem(store, channelId, rd.id), new RegExp(MARKER));

    const dm = store.openDm(rd.id);
    const dmTurn = chatTurnForBot(store, dm.id, rd.id, [], "請依 Channel.md 回");
    assert.equal(dmTurn.channelMd, "");
    assert.doesNotMatch(chatTurnSystem(store, dm.id, rd.id), new RegExp(MARKER));
  } finally {
    await closeServer(server);
  }
});

test("@handle in a channel replies only from that bot", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const { server, origin } = await listen(dataDir, {});
  try {
    const created = await json(origin, "/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ops" }),
    });
    const channelId = created.body.id as string;
    const space = (await json(origin, "/workspace")).body as {
      bots: { id: string; handle: string }[];
    };
    const rd = space.bots.find((bot) => bot.handle === "rd");
    const pm = space.bots.find((bot) => bot.handle === "pm");
    assert.ok(rd && pm);
    for (const bot of [rd, pm]) {
      const added = await json(origin, `/channels/${channelId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId: bot.id }),
      });
      assert.equal(added.status, 200);
    }

    const silent = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "沒有人被叫" }),
    });
    assert.equal(silent.status, 201);
    const silentReplies = silent.body.replies as unknown[];
    assert.equal(silentReplies.length, 0);

    const mentioned = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "@rd 請回這句" }),
    });
    assert.equal(mentioned.status, 201);
    const replies = mentioned.body.replies as { author: string; body: string }[];
    assert.equal(replies.length, 1);
    assert.equal(replies[0].author, rd.id);
    assert.match(replies[0].body, /收到/);
  } finally {
    await closeServer(server);
  }
});

test("chat page has a Channel.md editor for channels", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  assert.doesNotMatch(html, /channel-md-btn/);
  assert.match(html, /id="head-av"/);
  assert.match(html, /id="head-id"/);
  assert.match(html, /openChannelMd/);
  assert.match(html, /Channel\.md/);
  assert.match(html, /\/channel\.md/);
});
