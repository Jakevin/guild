import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { writeModelsFile } from "../src/llm.ts";
import { postUserMessage } from "../src/handlers.ts";
import { CHANNEL_ROSTER_CAP, GuildStore } from "../src/store.ts";
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
  assert.equal(isBroadcastMention("@all 全員"), true);
  assert.equal(isBroadcastMention("照 @marketing 的方案"), false);
  assert.deepEqual(
    mentionedHandles(
      "@pm 照 @marketing 的方案。Channel.md → @rd → 改一行",
      handles,
    ),
    ["pm", "marketing", "rd"],
  );
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
  assert.match(html, /if \(ids\.length\) \{/);
  assert.match(html, /id="assign"/);
  assert.match(html, /data-assign/);
  assert.match(html, /assigneeId/);
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
