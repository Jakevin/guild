import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { writeModelsFile } from "../src/llm.ts";
import { closeServer, listen as listenApp } from "./app.ts";
import {
  summonedHandles,
  mentionedHandles,
  isBroadcastMention,
} from "../src/mention.ts";

const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);
const CHAT_CSS = fileURLToPath(
  new URL("../src/public/chat.css", import.meta.url),
);

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-home-"));
}

async function listen(dataDir: string, env: NodeJS.ProcessEnv = {}) {
  const app = await listenApp(dataDir, env);
  return { server: app.server, origin: app.origin };
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

test("prose @handles are references; only the leading group or the first @handle summons", () => {
  const handles = ["pm", "rd", "marketing"];
  assert.deepEqual(summonedHandles("@pm 照 @marketing 的方案", handles), ["pm"]);
  assert.deepEqual(summonedHandles("@pm @rd 一起看 @marketing", handles), [
    "pm",
    "rd",
  ]);
  assert.deepEqual(
    summonedHandles(
      "目標：照 @marketing 的方案。\n錄 60 秒：Channel.md → @pm → @rd\n你能錄嗎？",
      handles,
    ),
    ["marketing"],
  );
  assert.deepEqual(
    summonedHandles(
      "GitHub 叫什麼？\n錄 60 秒：Channel.md → @pm → @rd → 改一行\n你能錄嗎？",
      handles,
    ),
    ["pm"],
  );
  assert.deepEqual(summonedHandles("請 @pm 看 @rd 的 PR", handles), ["pm"]);
  assert.deepEqual(summonedHandles("沒有人 ` @pm ` 在 code 裡", handles), []);
  assert.equal(isBroadcastMention("@here 全員"), true);
  assert.equal(isBroadcastMention("@channel 全員"), true);
  assert.equal(isBroadcastMention("@quest 全員"), true);
  assert.equal(isBroadcastMention("照 @marketing 的方案"), false);
  assert.deepEqual(
    mentionedHandles(
      "@pm 照 @marketing 的方案。Channel.md → @rd → 改一行",
      handles,
    ),
    ["pm", "marketing", "rd"],
  );
});

test("@handle of a bot outside the channel adds them and they reply", async () => {
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
      channels: { id: string; memberIds: string[] }[];
    };
    const rd = space.bots.find((bot) => bot.handle === "rd");
    const pm = space.bots.find((bot) => bot.handle === "pm");
    assert.ok(rd && pm);
    const addPm = await json(origin, `/channels/${channelId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: pm.id }),
    });
    assert.equal(addPm.status, 200);
    const before = (await json(origin, "/workspace")).body as {
      channels: { id: string; memberIds: string[] }[];
    };
    const opsBefore = before.channels.find((ch) => ch.id === channelId);
    assert.ok(opsBefore);
    assert.ok(!opsBefore.memberIds.includes(rd.id));

    const posted = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "@rd 請進來幫忙" }),
    });
    assert.equal(posted.status, 201);
    const replies = posted.body.replies as { author: string; body: string }[];
    assert.equal(replies.length, 1);
    assert.equal(replies[0].author, rd.id);
    assert.match(replies[0].body, /收到/);

    const after = (await json(origin, "/workspace")).body as {
      channels: { id: string; memberIds: string[] }[];
    };
    const opsAfter = after.channels.find((ch) => ch.id === channelId);
    assert.ok(opsAfter?.memberIds.includes(rd.id));
    assert.ok(opsAfter?.memberIds.includes(pm.id));
  } finally {
    await closeServer(server);
  }
});

test("article @handles do not dispatch every named bot", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const { server, origin } = await listen(dataDir, {});
  try {
    const created = await json(origin, "/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "launch" }),
    });
    const channelId = created.body.id as string;
    const space = (await json(origin, "/workspace")).body as {
      bots: { id: string; handle: string }[];
      channels: { id: string; memberIds: string[] }[];
    };
    const pm = space.bots.find((bot) => bot.handle === "pm");
    const rd = space.bots.find((bot) => bot.handle === "rd");
    const marketing = space.bots.find((bot) => bot.handle === "marketing");
    assert.ok(pm && rd && marketing);
    await json(origin, `/channels/${channelId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: pm.id }),
    });
    await json(origin, `/channels/${channelId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: rd.id }),
    });
    await json(origin, `/channels/${channelId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: marketing.id }),
    });

    const posted = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "@pm 照 @marketing 的 GitHub 開源方案落地。錄 60 秒：Channel.md → @rd → 改一行 SOUL.md。你能錄嗎？",
      }),
    });
    assert.equal(posted.status, 201);
    const replies = posted.body.replies as { author: string }[];
    assert.equal(replies.length, 1);
    assert.equal(replies[0].author, pm.id);

    const picked = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "@pm 照 @marketing 的方案，再請 @rd 改一行",
        assigneeId: marketing.id,
      }),
    });
    assert.equal(picked.status, 201);
    const chosen = picked.body.replies as { author: string }[];
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].author, marketing.id);
  } finally {
    await closeServer(server);
  }
});

test("chat composer lists @ mentions including outsiders", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  assert.match(html, /mention-pop/);
  assert.match(html, /t\("mention.channel"\)/);
  assert.match(html, /t\("notInChannel"\)/);
  assert.match(html, /mentionChoices/);
  assert.match(html, /mentionScanText/);
  assert.match(html, /assignCandidates/);
  assert.match(html, /id="assign"/);
  assert.match(html, /data-assign/);
  assert.match(html, /assigneeId/);
});

test("chat page bubbles bot text and has a reply composer", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const css = readFileSync(CHAT_CSS, "utf8");
  assert.match(html, /composer-reply/);
  assert.match(html, /t\("replying"\)/);
  assert.match(html, /data-reply/);
  assert.match(html, /setReply/);
  assert.match(html, /class="bubble"/);
  assert.match(css, /\.msg\.bot \.bubble/);
});

test("replyTo a bot message in a channel asks that bot without @", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const { server, origin } = await listen(dataDir, {});
  try {
    const created = await json(origin, "/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "desk" }),
    });
    const channelId = created.body.id as string;
    const space = (await json(origin, "/workspace")).body as {
      bots: { id: string; handle: string }[];
    };
    const pm = space.bots.find((bot) => bot.handle === "pm");
    const rd = space.bots.find((bot) => bot.handle === "rd");
    assert.ok(pm && rd);
    await json(origin, `/channels/${channelId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: pm.id }),
    });
    await json(origin, `/channels/${channelId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: rd.id }),
    });
    const first = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "@pm 先看一下" }),
    });
    assert.equal(first.status, 201);
    const firstReplies = first.body.replies as { id: string; author: string }[];
    assert.equal(firstReplies.length, 1);
    assert.equal(firstReplies[0].author, pm.id);

    const silent = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "沒有指定誰" }),
    });
    assert.equal(silent.status, 201);
    assert.equal((silent.body.replies as unknown[]).length, 0);

    const replied = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "再說一次",
        replyTo: firstReplies[0].id,
      }),
    });
    assert.equal(replied.status, 201);
    const message = replied.body.message as { replyTo?: string; body: string };
    const replies = replied.body.replies as { author: string }[];
    assert.equal(message.body, "再說一次");
    assert.equal(message.replyTo, firstReplies[0].id);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].author, pm.id);
  } finally {
    await closeServer(server);
  }
});

test("chat attachments persist as [Image #1] tokens", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const { server, origin } = await listen(dataDir, {});
  try {
    const space = (await json(origin, "/workspace")).body as {
      bots: { id: string; handle: string }[];
    };
    const pm = space.bots.find((bot) => bot.handle === "pm");
    assert.ok(pm);
    const posted = await json(origin, `/dms/${pm.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "[Image #1] 看看這張圖",
        attachments: [
          {
            token: "[Image #1]",
            title: "shot.png",
            body: "fake-image-bytes",
          },
        ],
      }),
    });
    assert.equal(posted.status, 201);
    const message = posted.body.message as {
      body: string;
      attachments?: { token: string; title: string; body: string }[];
    };
    assert.equal(message.body, "[Image #1] 看看這張圖");
    assert.equal(message.attachments?.[0]?.token, "[Image #1]");
    assert.equal(message.attachments?.[0]?.title, "shot.png");
    const listed = await json(origin, `/dms/${pm.id}/messages`);
    const rows = listed.body as unknown as { body: string; attachments?: { token: string }[] }[];
    const found = rows.find((row) => row.body.includes("[Image #1]"));
    assert.ok(found);
    assert.equal(found.attachments?.[0]?.token, "[Image #1]");
  } finally {
    await closeServer(server);
  }
});
