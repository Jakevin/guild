import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chatReply } from "../src/generate.ts";
import { toLiveTurn } from "../src/handlers.ts";
import { writeModelsFile } from "../src/llm.ts";
import { closeServer, listen as listenApp } from "./app.ts";

const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-home-"));
}

async function listen(dataDir: string, env: NodeJS.ProcessEnv = {}) {
  const app = await listenApp(dataDir, env);
  return { server: app.server, origin: app.origin };
}

test("chatReply without a model skips host tools", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const result = await chatReply({
    botName: "RD",
    handle: "rd",
    soul: "soul",
    agent: "agent",
    position: "position",
    history: [],
    userMessage: "請跑 echo guild-should-not-run",
    dataDir,
    env: {},
    model: null,
    skills: [
      {
        name: "debugger",
        slug: "debugger",
        body: "SECRET_SKILL_BODY_MUST_NOT_RUN",
      },
    ],
  });
  assert.equal(result.source, "local");
  assert.match(result.body, /收到/);
  assert.match(result.body, /沒有可用模型/);
  assert.match(result.body, /本機工具還沒辦法跑/);
  assert.equal(result.parts.length, 1);
  assert.equal(result.parts[0]?.type, "text");
  assert.doesNotMatch(result.body, /SECRET_SKILL_BODY_MUST_NOT_RUN/);
  assert.doesNotMatch(result.body, /guild-should-not-run[\s\S]*guild-should-not-run/);
});

test("DM POST uses the same no-model turn for every seeded bot", async () => {
  const dataDir = tempHome();
  const { server, origin } = await listen(dataDir, {});
  try {
    writeModelsFile(dataDir, { default: null, providers: {} });
    const space = await fetch(`${origin}/workspace`).then((r) => r.json()) as {
      bots: { id: string; handle: string }[];
    };
    assert.ok(space.bots.length >= 2);
    for (const bot of space.bots) {
      const res = await fetch(`${origin}/dms/${encodeURIComponent(bot.id)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: `你好 @${bot.handle}` }),
      });
      assert.equal(res.status, 201);
      const payload = (await res.json()) as {
        replies: {
          author: string;
          body: string;
          parts?: { type: string }[];
        }[];
      };
      assert.equal(payload.replies.length, 1);
      assert.equal(payload.replies[0].author, bot.id);
      assert.match(payload.replies[0].body, /收到/);
      assert.match(payload.replies[0].body, /沒有可用模型/);
      const parts = payload.replies[0].parts ?? [];
      assert.ok(parts.length >= 1);
      assert.ok(parts.every((part) => part.type === "text"));
      assert.ok(!parts.some((part) => part.type === "tool" || part.type === "skill"));
    }
  } finally {
    await closeServer(server);
  }
});

test("chat page can render Think Skill Bash and Deep diving", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const css = readFileSync(
    new URL("../src/public/chat.css", import.meta.url),
    "utf8",
  );
  assert.match(html, /t\("think"\)/);
  assert.match(html, /t\("skill"\)/);
  assert.match(html, /t\("bash"\)/);
  assert.match(html, /t\("deepDiving"\)/);
  assert.match(html, /dsh-trace/);
  assert.match(html, /t\("trace.steps"\)/);
  assert.match(html, /function traceSummary/);
  assert.match(html, /live-steps/);
  assert.match(html, /function liveBot/);
  assert.match(html, /msg bot live/);
  assert.match(html, /function pollLive/);
  assert.match(html, /function refreshTraj/);
  assert.match(html, /function mergeLiveTraj/);
  assert.match(html, /trajFollow/);
  assert.match(html, /event.live/);
  assert.match(html, /resumeCurrentLive/);
  assert.match(html, /stopTurn/);
  assert.match(html, /data-live-stop/);
  assert.match(html, /data-live-steer/);
  assert.match(html, /insertIntoBotTurn/);
  assert.match(html, /slice\(-5\)/);
  assert.match(html, /live\.steer/);
  assert.match(html, /enqueuePending/);
  assert.match(html, /dispatchBusySend/);
  assert.match(html, /splitSendTargets/);
  assert.match(html, /inFlightBotIds/);
  assert.match(html, /replyAuthorId/);
  assert.match(html, /formatMsgClock/);
  assert.match(html, /msgStamp/);
  assert.match(html, /finishedAt/);
  assert.match(html, /day-rule/);
  assert.doesNotMatch(html, /\.disabled = stop/);
  assert.match(css, /dsh-trace:not\(\[open\]\)/);
  assert.match(css, /\.live-steps/);
  assert.match(css, /tbody tr:nth-child\(even\) td \{ background: #303030/);
  assert.doesNotMatch(css, /tbody tr:nth-child\(even\) \{ background: #111/);
});

test("live turn pins Think and keeps at most 5 rows", () => {
  const traces = Array.from({ length: 8 }, (_, i) => ({
    name: "read",
    args: { path: `f${i}.ts` },
    text: "",
    isError: false,
    running: i === 7,
  }));
  const live = toLiveTurn("bot-1", {
    thinking: "plan the work\nmore",
    traces,
  });
  assert.equal(live.botId, "bot-1");
  assert.equal(live.steps.length, 5);
  assert.equal(live.steps[0].name, "think");
  assert.equal(live.steps[0].detail, "plan the work");
  assert.equal(live.steps[4].name, "read");
  assert.equal(live.steps[4].detail, "f7.ts");
  assert.equal(live.steps[4].running, true);
  const toolsOnly = toLiveTurn("bot-1", { thinking: "", traces });
  assert.equal(toolsOnly.steps.length, 5);
  assert.equal(toolsOnly.steps[0].name, "read");
  assert.equal(toolsOnly.steps[0].detail, "f3.ts");
  assert.equal(live.traces?.length, 8);
  assert.equal(live.traces?.[7]?.running, true);
  const many = toLiveTurn("bot-1", {
    thinking: "",
    traces: Array.from({ length: 110 }, (_, i) => ({
      name: "read",
      args: { path: `f${i}.ts` },
      text: "",
      isError: false,
    })),
  });
  assert.ok((many.traces?.length ?? 0) < 110);
  assert.equal(many.traces?.at(-1)?.args?.path, "f109.ts");
});
