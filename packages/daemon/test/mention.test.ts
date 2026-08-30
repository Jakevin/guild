import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { writeModelsFile } from "../src/llm.ts";
import {
  parseAttachments,
  postUserMessage,
  retryMessage,
} from "../src/handlers.ts";
import { CHANNEL_ROSTER_CAP, GuildStore } from "../src/store.ts";
import { closeServer, listen as listenApp } from "./app.ts";
import {
  summonedHandles,
  mentionedHandles,
  assignmentFor,
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

test("prose @handles are references; line-start @handles all summon", () => {
  const handles = ["pm", "rd", "marketing", "design", "infra"];
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
  assert.deepEqual(
    summonedHandles("@design\nGoal: 圖\n@infra\nGoal: 上版", handles),
    ["design", "infra"],
  );
  assert.deepEqual(
    summonedHandles(
      "圖過了才改字。\n@design\n畫四張圖\n@infra\n上版",
      handles,
    ),
    ["design", "infra"],
  );
  assert.equal(isBroadcastMention("@here 全員"), true);
  assert.equal(isBroadcastMention("@channel 全員"), true);
  assert.equal(isBroadcastMention("@quest 全員"), true);
  assert.equal(isBroadcastMention("@all 全員"), true);
  assert.equal(isBroadcastMention("照 @marketing 的方案"), false);
  assert.deepEqual(
    mentionedHandles(
      "@pm 照 @marketing 的方案。Channel.md → @rd → 改一行",
      handles,
    ),
    ["pm", "marketing", "rd"],
  );
  const spec =
    "我這輪不改 README。\n@design\nGoal: 四張圖\nFiles: docs/a.png\n@infra\nGoal: push\nFiles: README.md";
  const designAsk = assignmentFor(spec, "design", handles);
  const infraAsk = assignmentFor(spec, "infra", handles);
  assert.match(designAsk, /不改 README/);
  assert.match(designAsk, /四張圖/);
  assert.doesNotMatch(designAsk, /push/);
  assert.match(infraAsk, /不改 README/);
  assert.match(infraAsk, /push/);
  assert.doesNotMatch(infraAsk, /四張圖/);
});

test("@all starts every channel member at once", async () => {
  const store = new GuildStore(tempHome());
  const general = store.listChannels().find((room) => room.id === "channel-general");
  assert.ok(general);
  assert.ok(general.memberIds.length >= 2);
  const starts: number[] = [];
  const posted = await postUserMessage(
    store,
    "channel-general",
    "@all 照上面分配的任務工作",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: async () => {
        starts.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 60));
        return {
          body: "收到",
          parts: [],
          source: "local",
          system: "",
        };
      },
    },
  );
  assert.equal(posted.replies.length, general.memberIds.length);
  const authors = posted.replies.map((row) => row.author).sort();
  assert.deepEqual(authors, [...general.memberIds].sort());
  assert.equal(starts.length, general.memberIds.length);
  assert.ok(Math.max(...starts) - Math.min(...starts) < 80);
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
  assert.match(html, new RegExp(`CHANNEL_ROSTER_CAP = ${CHANNEL_ROSTER_CAP}`));
  assert.match(html, /mention-pop/);
  assert.match(html, /t\("mention.channel"\)/);
  assert.match(html, /t\("notInChannel"\)/);
  assert.match(html, /mentionChoices/);
  assert.match(html, /mentionScanText/);
  assert.match(html, /assignCandidates/);
  assert.match(html, /function lastBotAuthor/);
  assert.match(html, /function summonedBotIds/);
  assert.match(html, /if \(ids\.length\) \{/);
  assert.match(html, /id="assign"/);
  assert.match(html, /data-assign/);
  assert.match(html, /assigneeId/);
});

test("thread has a jump-to-latest button when scrolled up", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const css = readFileSync(CHAT_CSS, "utf8");
  const i18n = readFileSync(
    fileURLToPath(new URL("../src/public/i18n.js", import.meta.url)),
    "utf8",
  );
  assert.match(html, /id="jump-bottom"/);
  assert.match(html, /function syncJumpBottom/);
  assert.match(html, /function scrollThreadBottom/);
  assert.match(html, /function threadNearBottom/);
  assert.match(html, /thread-wrap/);
  assert.match(html, /renderThread\(\{ pinBottom: !\(opts && opts.merge\) \}\)/);
  assert.match(css, /\.jump-bottom/);
  assert.match(css, /\.jump-bottom\[hidden\]/);
  assert.match(i18n, /jumpBottom/);
  assert.match(i18n, /滾到最新/);
});

test("thread prompt rail jumps to a user message", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const css = readFileSync(CHAT_CSS, "utf8");
  const i18n = readFileSync(
    fileURLToPath(new URL("../src/public/i18n.js", import.meta.url)),
    "utf8",
  );
  assert.match(html, /id="prompt-rail"/);
  assert.match(html, /function syncPromptRail/);
  assert.match(html, /function jumpToYouMessage/);
  assert.match(html, /function markActivePrompt/);
  assert.match(html, /data-prompt-jump/);
  assert.match(html, /article\.msg\.you\[data-id\]/);
  assert.match(css, /\.prompt-rail/);
  assert.match(css, /\.prompt-tick/);
  assert.match(css, /\.msg\.you\.is-jump/);
  assert.match(i18n, /promptRail/);
  assert.match(i18n, /你發過的位置/);
});

test("live poll merges finished replies while hops are still running", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  assert.match(html, /loadMessages\(\{ resume: false, merge: true \}\)/);
  assert.match(html, /opts && opts.merge/);
  assert.match(html, /name === "handoff"/);
  assert.match(html, /t\("handoff"\)/);
});

test("queue chip names the bot who will receive it", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const css = readFileSync(CHAT_CSS, "utf8");
  const i18n = readFileSync(
    fileURLToPath(new URL("../src/public/i18n.js", import.meta.url)),
    "utf8",
  );
  assert.match(html, /function queueTargetBots/);
  assert.match(html, /function queueTargetLabel/);
  assert.match(html, /function queueToHtml/);
  assert.match(html, /function queueWaitingText/);
  assert.match(html, /steer\.waitingTo/);
  assert.match(html, /function youSteerHtml/);
  assert.match(html, /function noteSteerOnLive/);
  assert.match(html, /steer\.tagTo/);
  assert.match(html, /steerBotId/);
  assert.match(html, /queue-to/);
  assert.match(html, /botIds: item\.botIds \|\| \[\]/);
  assert.match(css, /\.queue-chip \.queue-to/);
  assert.match(css, /\.queue-av/);
  assert.match(i18n, /steer\.waitingTo/);
  assert.match(i18n, /排隊給 \{who\}/);
});

test("retry keeps optimistic live while POST is in flight", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  assert.match(
    html,
    /if \(!lives\.length\) \{\s*if \(state\.posting\) return;/,
  );
  assert.match(html, /typeof body === "string"/);
  assert.match(html, /payload\.assigneeId = botIds\[0\]/);
  assert.match(
    html,
    /current && current\.author !== "you" && botById\(current\.author\)/,
  );
});

test("chat composer / picker lists guild and host skills and subagents", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const css = readFileSync(CHAT_CSS, "utf8");
  assert.match(html, /function slashAt/);
  assert.match(html, /function slashChoices/);
  assert.match(html, /function loadSlashCatalog/);
  assert.match(html, /function attachLibraryPick/);
  assert.match(html, /\/library\/skills\/host\?body=0/);
  assert.match(html, /\/library\/subagents\/host\?body=0/);
  assert.match(html, /skipInsert/);
  assert.match(html, /data-attach="agents"/);
  assert.match(html, /t\("slash.sec\." \+ row.section\)/);
  assert.match(css, /\.mention-pop\.is-slash/);
  assert.match(css, /\.mention-sec/);
});

test("composer ingests dropped files and pasted clipboard images", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const css = readFileSync(CHAT_CSS, "utf8");
  assert.match(html, /function ingestFiles/);
  assert.match(html, /function filesFromClipboard/);
  assert.match(html, /bindComposerDrop/);
  assert.match(html, /clipboardData/);
  assert.match(html, /data-i18n-drop="attach.drop"/);
  assert.match(css, /\.composer\.drop-on/);
});

test("composer and thread hover a small image preview", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const css = readFileSync(CHAT_CSS, "utf8");
  assert.match(html, /id="img-preview"/);
  assert.match(html, /function imagePreviewUrl/);
  assert.match(html, /function bindImagePreview/);
  assert.match(html, /data-preview/);
  assert.match(html, /attach-thumb/);
  assert.match(html, /msg-imgs/);
  assert.match(html, /att-inline/);
  assert.match(html, /wireAttachment/);
  assert.match(css, /\.img-preview/);
  assert.match(css, /\.attach-thumb/);
  assert.match(css, /\.msg-img/);
  assert.match(css, /\.att-inline/);
});

test("chat page bubbles bot text and has a reply composer", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const css = readFileSync(CHAT_CSS, "utf8");
  assert.match(html, /composer-reply/);
  assert.match(html, /t\("replying"\)/);
  assert.match(html, /data-reply/);
  assert.match(html, /data-msg-del/);
  assert.match(html, /function deleteChatMessage/);
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
    const silentReplies = silent.body.replies as { author: string }[];
    assert.equal(silentReplies.length, 1);
    assert.equal(silentReplies[0].author, pm.id);

    const thenRd = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "@rd 換你" }),
    });
    assert.equal(thenRd.status, 201);
    const rdReplies = thenRd.body.replies as { author: string }[];
    assert.equal(rdReplies.length, 1);
    assert.equal(rdReplies[0].author, rd.id);

    const afterRd = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "接著說" }),
    });
    assert.equal(afterRd.status, 201);
    const afterRdReplies = afterRd.body.replies as { author: string }[];
    assert.equal(afterRdReplies.length, 1);
    assert.equal(afterRdReplies[0].author, rd.id);

    const namedPm = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "@pm 你還在執行什麼？" }),
    });
    assert.equal(namedPm.status, 201);
    const namedReplies = namedPm.body.replies as { author: string }[];
    assert.equal(namedReplies.length, 1);
    assert.equal(namedReplies[0].author, pm.id);

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

function staffBot(store: GuildStore, handle: string) {
  const skill = store.listLibrary("skills")[0];
  assert.ok(skill);
  return store.createBot({
    name: handle,
    handle,
    skillIds: [skill.id],
    soul: { name: handle, body: "# soul" },
    agent: { name: handle, body: "# agent" },
    position: { name: handle, body: "# pos" },
  });
}

function stubTurn(
  reply: (input: { handle: string; userMessage: string }) => string,
) {
  return async (input: { handle: string; userMessage: string }) => ({
    body: reply(input),
    parts: [],
    source: "local" as const,
    system: "",
  });
}

test("project channel roster caps at 6; #general does not", () => {
  const store = new GuildStore(tempHome());
  staffBot(store, "qa");
  const seventh = staffBot(store, "legal");
  const room = store.createChannel("quest");
  const six = store.listBots().filter((bot) => bot.id !== seventh.id);
  assert.equal(six.length, CHANNEL_ROSTER_CAP);
  for (const bot of six) store.addMember(room.id, bot.id);
  assert.equal(store.getRoom(room.id)?.memberIds.length, CHANNEL_ROSTER_CAP);
  assert.throws(
    () => store.addMember(room.id, seventh.id),
    /最多 6 席/,
  );
  const general = store.listChannels().find((ch) => ch.name === "general");
  assert.ok(general?.memberIds.includes(seventh.id));
});

test("bot line-start specs hand off to each named seat in parallel", async () => {
  const store = new GuildStore(tempHome());
  const room = store.createChannel("sortie");
  const marketing = store.listBots().find((bot) => bot.handle === "marketing");
  const design = store.listBots().find((bot) => bot.handle === "design");
  const infra = store.listBots().find((bot) => bot.handle === "infra");
  assert.ok(marketing && design && infra);
  store.addMember(room.id, marketing.id);
  store.addMember(room.id, design.id);
  store.addMember(room.id, infra.id);
  const asked: string[] = [];
  const starts: number[] = [];
  const posted = await postUserMessage(
    store,
    room.id,
    "@marketing 把圖和上版拆給兩席",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: async (input) => {
        asked.push(`${input.handle}:${input.userMessage}`);
        starts.push(Date.now());
        if (input.handle === "marketing") {
          return {
            body: [
              "我這輪不改 README。圖落地再說。",
              "@design",
              "Goal: 四張圖",
              "Files: docs/readme-hall-2026-08-29.png",
              "@infra",
              "Goal: 圖過了才上版",
              "Files: README.md",
            ].join("\n"),
            parts: [],
            source: "local" as const,
            system: "",
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
        return {
          body: "收到 " + input.handle,
          parts: [],
          source: "local" as const,
          system: "",
        };
      },
    },
  );
  assert.equal(posted.replies.length, 3);
  const authors = posted.replies.map((row) => row.author);
  assert.equal(authors[0], marketing.id);
  assert.ok(authors.includes(design.id));
  assert.ok(authors.includes(infra.id));
  const designAsk = asked.find((row) => row.startsWith("design:"));
  const infraAsk = asked.find((row) => row.startsWith("infra:"));
  assert.ok(designAsk && /交棒給 @design/.test(designAsk));
  assert.ok(infraAsk && /交棒給 @infra/.test(infraAsk));
  assert.match(designAsk, /四張圖/);
  assert.doesNotMatch(designAsk, /上版/);
  assert.match(infraAsk, /上版/);
  assert.doesNotMatch(infraAsk, /四張圖/);
  const hopStarts = starts.slice(1);
  assert.equal(hopStarts.length, 2);
  assert.ok(Math.max(...hopStarts) - Math.min(...hopStarts) < 80);
});

test("finished speaker drops live before handoff seats start", async () => {
  const store = new GuildStore(tempHome());
  const room = store.createChannel("pass");
  const marketing = store.listBots().find((bot) => bot.handle === "marketing");
  const design = store.listBots().find((bot) => bot.handle === "design");
  assert.ok(marketing && design);
  store.addMember(room.id, marketing.id);
  store.addMember(room.id, design.id);
  let releaseHop!: () => void;
  const hopGate = new Promise<void>((resolve) => {
    releaseHop = resolve;
  });
  const pending = postUserMessage(
    store,
    room.id,
    "@marketing 把圖拆給設計",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: async (input) => {
        if (input.handle === "marketing") {
          return {
            body: ["先交棒。", "@design", "Goal: 四張圖"].join("\n"),
            parts: [],
            source: "local",
            system: "",
          };
        }
        await hopGate;
        return {
          body: "收到 " + input.handle,
          parts: [],
          source: "local",
          system: "",
        };
      },
    },
  );
  for (let i = 0; i < 40; i++) {
    if (
      store.getLiveBotTurn(room.id, design.id) &&
      store.listMessages(room.id).some((msg) => msg.author === marketing.id)
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.ok(
    store.listMessages(room.id).some((msg) => msg.author === marketing.id),
    "marketing reply must land before hops finish",
  );
  assert.equal(store.getLiveBotTurn(room.id, marketing.id), null);
  const hopLive = store.getLiveBotTurn(room.id, design.id);
  assert.ok(hopLive);
  assert.equal(hopLive?.steps[0]?.name, "handoff");
  assert.match(String(hopLive?.steps[0]?.detail), /@marketing/);
  releaseHop();
  const done = await pending;
  assert.equal(done.replies.length, 2);
  assert.equal(done.replies[0].author, marketing.id);
  assert.equal(done.replies[1].author, design.id);
});

test("bot @handle spec hands off once to that member", async () => {
  const store = new GuildStore(tempHome());
  const room = store.createChannel("spec");
  const pm = store.listBots().find((bot) => bot.handle === "pm");
  const rd = store.listBots().find((bot) => bot.handle === "rd");
  const design = store.listBots().find((bot) => bot.handle === "design");
  assert.ok(pm && rd && design);
  store.addMember(room.id, pm.id);
  store.addMember(room.id, rd.id);
  store.addMember(room.id, design.id);
  const asked: string[] = [];
  const posted = await postUserMessage(
    store,
    room.id,
    "@pm 拆給工程",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: stubTurn((input) => {
        asked.push(`${input.handle}:${input.userMessage}`);
        if (input.handle === "pm") {
          return "@rd\nGoal: 登入\nDone when: 測試綠\nConstraints: 不要改行銷\nFiles: auth.ts";
        }
        return "收到 spec";
      }),
    },
  );
  assert.equal(posted.replies.length, 2);
  assert.equal(posted.replies[0].author, pm.id);
  assert.equal(posted.replies[1].author, rd.id);
  assert.match(posted.replies[1].body, /收到 spec/);
  assert.ok(
    asked.some((row) => row.startsWith("rd:") && /交棒/.test(row)),
  );
  assert.ok(!posted.replies.some((row) => row.author === design.id));
});

test("bot @outsider does not grow the roster; @all in a bot reply stays quiet", async () => {
  const store = new GuildStore(tempHome());
  const room = store.createChannel("tight");
  const pm = store.listBots().find((bot) => bot.handle === "pm");
  const rd = store.listBots().find((bot) => bot.handle === "rd");
  const design = store.listBots().find((bot) => bot.handle === "design");
  assert.ok(pm && rd && design);
  store.addMember(room.id, pm.id);
  store.addMember(room.id, design.id);
  const outsider = await postUserMessage(
    store,
    room.id,
    "@pm 叫工程",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: stubTurn((input) =>
        input.handle === "pm" ? "@rd 進來幫忙" : "不該輪到我",
      ),
    },
  );
  assert.equal(outsider.replies.length, 1);
  assert.equal(outsider.replies[0].author, pm.id);
  assert.ok(!store.getRoom(room.id)?.memberIds.includes(rd.id));

  const blast = await postUserMessage(
    store,
    room.id,
    "@pm 通知大家",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: stubTurn((input) =>
        input.handle === "pm" ? "@all 全員開工" : "不該輪到我",
      ),
    },
  );
  assert.equal(blast.replies.length, 1);
  assert.equal(blast.replies[0].author, pm.id);
});

test("@handle cannot exceed the quest roster cap", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const { server, origin } = await listen(dataDir, {});
  try {
    const created = await json(origin, "/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "full" }),
    });
    const channelId = created.body.id as string;
    const skills = await json(origin, "/library/skills");
    const skillId = (skills.body as { id: string }[])[0]?.id;
    assert.ok(skillId);
    const seed = async (handle: string) => {
      const made = await json(origin, "/bots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: handle,
          handle,
          skillIds: [skillId],
          soul: { name: handle, body: "# soul" },
          agent: { name: handle, body: "# agent" },
          position: { name: handle, body: "# pos" },
        }),
      });
      assert.equal(made.status, 201);
      return made.body as { id: string; handle: string };
    };
    await seed("qa");
    const seventh = await seed("legal");
    const space = (await json(origin, "/workspace")).body as {
      bots: { id: string; handle: string }[];
    };
    const six = space.bots.filter((bot) => bot.id !== seventh.id);
    assert.equal(six.length, CHANNEL_ROSTER_CAP);
    for (const bot of six) {
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
      body: JSON.stringify({ body: `@${seventh.handle} 請進來` }),
    });
    assert.equal(posted.status, 400);
    assert.match(String(posted.body.error || ""), /最多 6 席/);
  } finally {
    await closeServer(server);
  }
});

test("a second bot can start while another is still live", async () => {
  const store = new GuildStore(tempHome());
  const room = store.createChannel("para");
  const infra = store.listBots().find((bot) => bot.handle === "infra");
  const marketing = store.listBots().find((bot) => bot.handle === "marketing");
  assert.ok(infra && marketing);
  store.addMember(room.id, infra.id);
  store.addMember(room.id, marketing.id);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = postUserMessage(
    store,
    room.id,
    "@infra 慢慢來",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: async (input) => {
        if (input.handle === "infra") await gate;
        return {
          body: `${input.handle} done`,
          parts: [],
          source: "local",
          system: "",
        };
      },
    },
  );
  for (let i = 0; i < 80; i++) {
    if (store.getLiveBotTurn(room.id, infra.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.ok(store.getLiveBotTurn(room.id, infra.id));
  const second = await postUserMessage(
    store,
    room.id,
    "@marketing 同時做",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: async (input) => ({
        body: `${input.handle} done`,
        parts: [],
        source: "local",
        system: "",
      }),
    },
  );
  assert.equal(second.replies.length, 1);
  assert.equal(second.replies[0].author, marketing.id);
  assert.ok(store.getLiveBotTurn(room.id, infra.id));
  release();
  const infraDone = await first;
  assert.equal(infraDone.replies[0].author, infra.id);
});

test("live turn is planted before MCP handshake", async () => {
  const store = new GuildStore(tempHome());
  const rd = store.listBots().find((bot) => bot.handle === "rd");
  assert.ok(rd);
  const room = store.openDm(rd.id);
  let releaseMcp!: () => void;
  const mcpGate = new Promise<never[]>((resolve) => {
    releaseMcp = () => resolve([]);
  });
  let releaseTurn!: () => void;
  const turnGate = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const pending = postUserMessage(
    store,
    room.id,
    "先看這支",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcpTools: mcpGate,
      turn: async () => {
        await turnGate;
        return {
          body: "收到",
          parts: [],
          source: "local",
          system: "",
        };
      },
    },
  );
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    if (store.getLiveBotTurn(room.id, rd.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.ok(
    store.getLiveBotTurn(room.id, rd.id),
    "live bubble must appear before MCP tools list",
  );
  assert.ok(Date.now() - t0 < 800);
  releaseMcp();
  releaseTurn();
  const done = await pending;
  assert.equal(done.replies[0].author, rd.id);
});

test("retry of a follow-up without @mention plants live before MCP", async () => {
  const store = new GuildStore(tempHome());
  const design = store.listBots().find((bot) => bot.handle === "design");
  assert.ok(design);
  const room = store.getRoom("channel-general");
  assert.ok(room);
  const first = await postUserMessage(
    store,
    room.id,
    "@design 改善這個prj",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: async () => ({
        body: "先畫一版",
        parts: [],
        source: "local",
        system: "",
      }),
    },
  );
  assert.equal(first.replies[0].author, design.id);
  const follow = await postUserMessage(
    store,
    room.id,
    "不，你這樣就少了RPG風格了",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: async () => ({
        body: "補上RPG",
        parts: [],
        source: "local",
        system: "",
      }),
    },
  );
  assert.equal(follow.replies[0].author, design.id);
  let releaseMcp!: () => void;
  const mcpGate = new Promise<never[]>((resolve) => {
    releaseMcp = () => resolve([]);
  });
  let releaseTurn!: () => void;
  const turnGate = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const pending = retryMessage(
    store,
    room.id,
    follow.message.id,
    undefined,
    process.env,
    undefined,
    {
      harvest: false,
      mcpTools: mcpGate,
      turn: async () => {
        await turnGate;
        return {
          body: "RPG 材質補上了",
          parts: [],
          source: "local",
          system: "",
        };
      },
    },
  );
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    if (store.getLiveBotTurn(room.id, design.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.ok(
    store.getLiveBotTurn(room.id, design.id),
    "重問 must show 美術 live before MCP handshake",
  );
  assert.ok(Date.now() - t0 < 800);
  releaseMcp();
  releaseTurn();
  const redone = await pending;
  assert.equal(redone.replies.length, 1);
  assert.equal(redone.replies[0].author, design.id);
});

test("abortTurn clears a leftover live row even without a controller", () => {
  const store = new GuildStore(tempHome());
  const room = store.createChannel("orphan-live");
  const infra = store.listBots().find((bot) => bot.handle === "infra");
  assert.ok(infra);
  store.setLiveTurn(room.id, {
    botId: infra.id,
    thinking: "",
    steps: [],
    startedAt: new Date().toISOString(),
  });
  assert.ok(store.getLiveBotTurn(room.id, infra.id));
  assert.equal(store.abortTurn(room.id, infra.id), true);
  assert.equal(store.getLiveBotTurn(room.id, infra.id), null);
});

test("aborting one live bot leaves the other running", async () => {
  const store = new GuildStore(tempHome());
  const room = store.createChannel("abort-one");
  const infra = store.listBots().find((bot) => bot.handle === "infra");
  const marketing = store.listBots().find((bot) => bot.handle === "marketing");
  assert.ok(infra && marketing);
  store.addMember(room.id, infra.id);
  store.addMember(room.id, marketing.id);
  let releaseInfra!: () => void;
  const infraGate = new Promise<void>((resolve) => {
    releaseInfra = resolve;
  });
  const first = postUserMessage(
    store,
    room.id,
    "@infra 慢慢來",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: async (input) => {
        if (input.handle === "infra") await infraGate;
        return {
          body: `${input.handle} done`,
          parts: [],
          source: "local",
          system: "",
        };
      },
    },
  );
  for (let i = 0; i < 80; i++) {
    if (store.getLiveBotTurn(room.id, infra.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  let releaseMkt!: () => void;
  const mktGate = new Promise<void>((resolve) => {
    releaseMkt = resolve;
  });
  const second = postUserMessage(
    store,
    room.id,
    "@marketing 同時做",
    process.env,
    undefined,
    undefined,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: async (input) => {
        if (input.handle === "marketing") await mktGate;
        if (input.signal && input.signal.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        return {
          body: `${input.handle} done`,
          parts: [],
          source: "local",
          system: "",
        };
      },
    },
  );
  for (let i = 0; i < 80; i++) {
    if (store.getLiveBotTurn(room.id, marketing.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.ok(store.getLiveBotTurn(room.id, marketing.id));
  assert.equal(store.abortTurn(room.id, marketing.id), true);
  assert.ok(store.getLiveBotTurn(room.id, infra.id));
  assert.equal(store.getLiveBotTurn(room.id, marketing.id), null);
  releaseMkt();
  const mkt = await second;
  assert.equal(mkt.replies.length, 0);
  releaseInfra();
  const infraDone = await first;
  assert.equal(infraDone.replies[0].author, infra.id);
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

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("image preview is stored on the message and kept out of the model prompt", async () => {
  const parsed = parseAttachments([
    {
      token: "[Image #1]",
      title: "shot.png",
      body: "a screenshot",
      preview: TINY_PNG,
    },
    {
      token: "[Image #2]",
      title: "bad.png",
      body: "nope",
      preview: "javascript:alert(1)",
    },
  ]);
  assert.equal(parsed?.[0]?.preview, TINY_PNG);
  assert.equal(parsed?.[1]?.preview, undefined);
  assert.equal(
    parseAttachments([
      {
        token: "[Image #1]",
        title: "huge.png",
        body: "x",
        preview: `data:image/png;base64,${"A".repeat(100_001)}`,
      },
    ])?.[0]?.preview,
    undefined,
  );

  const store = new GuildStore(tempHome());
  writeModelsFile(store.dataDir, { default: null, providers: {} });
  const pm = store.listBots().find((bot) => bot.handle === "pm");
  assert.ok(pm);
  const dm = store.openDm(pm.id);
  let seen = "";
  const posted = await postUserMessage(
    store,
    dm.id,
    "[Image #1] look",
    process.env,
    undefined,
    parsed,
    undefined,
    {
      harvest: false,
      mcp: false,
      turn: stubTurn((input) => {
        seen = input.userMessage;
        return "ok";
      }),
    },
  );
  assert.equal(posted.message.attachments?.[0]?.preview, TINY_PNG);
  assert.match(seen, /shot.png/);
  assert.doesNotMatch(seen, /data:image/);
});
