import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  lastFreebuffTurnForTest,
  logoutFreebuff,
  resetFreebuffBridgeForTest,
} from "../src/freebuff-bridge.ts";
import {
  FREEBUFF_CHAT_DEFAULT_MODEL,
  FREEBUFF_CHAT_PICKER_ID,
  FREEBUFF_COMPOSER_CHAR_BUDGET,
  FREEBUFF_PROGRESS_WAIT,
  FREEBUFF_TOOL_SYSTEM,
  completeFreebuffChat,
  stableFingerprint,
  withFreebuffToolSystem,
} from "../src/freebuff-chat.ts";
import { chatReply, HALL_RULES } from "../src/generate.ts";
import { DEFAULT_MODELS, writeModelsFile } from "../src/llm.ts";
import { TOOL_SYSTEM } from "../src/tools.ts";
import { fakeSdkPage, hookFakeSdk } from "./freebuff-sdk-harness.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-freebuff-stream-"));
}

function webBridgeTarget(model = FREEBUFF_CHAT_DEFAULT_MODEL) {
  return {
    providerId: FREEBUFF_CHAT_PICKER_ID,
    model,
    baseUrl: "freebuff-chat",
    apiKey: "session",
    api: "openai-completions" as const,
    transport: "web-bridge" as const,
    sessionReady: true,
  };
}

const lease = {
  roomId: "room-1",
  botId: "bot-1",
  throughId: "none",
  soul: "soul",
  agent: "agent",
  position: "position",
  skillIds: ["debugger"],
  channelMd: "channel notes",
  botMemory: "remember apples",
  channelMemory: "",
  userMessage: "hello there",
  hallRules: HALL_RULES,
};

afterEach(async () => {
  await resetFreebuffBridgeForTest();
});

test("withFreebuffToolSystem strips TOOL_SYSTEM and does not ship it to Freebuff", () => {
  const swapped = withFreebuffToolSystem(`intro\n\n${TOOL_SYSTEM}\n\noutro`);
  assert.match(swapped, /```guild_tools/);
  assert.match(swapped, /image_gen/);
  assert.doesNotMatch(swapped, /You ARE already running on the user's local computer/);
  assert.doesNotMatch(swapped, /text only/i);
  assert.equal(swapped.includes(FREEBUFF_TOOL_SYSTEM), true);
  assert.equal(withFreebuffToolSystem(swapped), swapped);
});

test("tryChatLlm packs at 88k, never leaseMatches, and stores the swapped system", async () => {
  const generateSrc = readFileSync(new URL("../src/generate.ts", import.meta.url), "utf8");
  assert.match(generateSrc, /tokenLimit: DEFAULT_AUTO_COMPACT_TOKENS/);
  assert.doesNotMatch(generateSrc, /tokenLimit:\s*32_?000/);
  assert.doesNotMatch(generateSrc, /\bleaseMatches\(/);
  assert.match(generateSrc, /withFreebuffToolSystem/);
  assert.match(generateSrc, /tools:\s*true/);
  assert.doesNotMatch(generateSrc, /tools:\s*webBridge\s*\?\s*false/);
  const home = tempHome();
  writeModelsFile(home, {
    ...structuredClone(DEFAULT_MODELS),
    default: { provider: FREEBUFF_CHAT_PICKER_ID, model: FREEBUFF_CHAT_DEFAULT_MODEL },
  });
  const reply = await chatReply({
    botName: "RD",
    handle: "rd",
    soul: "soul",
    agent: "agent",
    position: "position",
    history: [],
    userMessage: "hi",
    dataDir: home,
    env: {},
    model: { provider: FREEBUFF_CHAT_PICKER_ID, model: FREEBUFF_CHAT_DEFAULT_MODEL },
  });
  assert.equal(reply.source, "llm");
  assert.match(reply.system, /```guild_tools/);
  assert.match(reply.system, /image_gen/);
  assert.doesNotMatch(reply.system, /You ARE already running on the user's local computer/);
  assert.doesNotMatch(reply.system, /text only/i);
  assert.match(reply.body, /freebuff_login_required/);
});

test("Mode A pastes after mutex without TOOL_SYSTEM; Mode B pastes only the new user", async () => {
  const home = tempHome();
  const page = fakeSdkPage();
  hookFakeSdk(home, page);
  const first = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: `${TOOL_SYSTEM}\n\nBe brief.`,
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  assert.equal(first.text, "pong");
  const turnA = lastFreebuffTurnForTest();
  assert.equal(turnA?.mode, "A");
  assert.match(turnA?.paste || "", /hello there/);
  assert.match(turnA?.paste || "", /```guild_tools/);
  assert.match(turnA?.paste || "", /image_gen/);
  assert.doesNotMatch(turnA?.paste || "", /You ARE already running on the user's local computer/);
  page.autoReply = "again";
  const second = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: `${TOOL_SYSTEM}\n\nBe brief.`,
    messages: [
      { role: "user", content: "hello there" },
      { role: "assistant", content: "pong" },
      { role: "user", content: "next question" },
    ],
    lease: { ...lease, userMessage: "next question" },
  });
  assert.equal(second.text, "again");
  const turnB = lastFreebuffTurnForTest();
  assert.equal(turnB?.mode, "B");
  assert.equal(turnB?.paste, "next question");
  assert.doesNotMatch(turnB?.paste || "", /Be brief/);
  assert.equal(turnA?.leaseKey, turnB?.leaseKey);
});

test("Mode B prepends standing notes when MEMORY.md hash changes; fingerprint ignores MEMORY", async () => {
  const home = tempHome();
  hookFakeSdk(home, fakeSdkPage());
  await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "sys",
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  assert.equal(lastFreebuffTurnForTest()?.mode, "A");
  const sameFp = stableFingerprint(lease);
  const fpWithOtherMemory = stableFingerprint({ ...lease, soul: lease.soul });
  assert.equal(sameFp, fpWithOtherMemory);
  const page = fakeSdkPage({ autoReply: "noted" });
  hookFakeSdk(home, page);
  await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "sys",
    messages: [{ role: "user", content: "hello there" }],
    lease: { ...lease, botMemory: "remember oranges", userMessage: "hello there" },
  });
  const turn = lastFreebuffTurnForTest();
  assert.equal(turn?.mode, "B");
  assert.match(turn?.paste || "", /<guild_standing_notes>/);
  assert.match(turn?.paste || "", /remember oranges/);
  assert.match(turn?.paste || "", /hello there/);
});

test("soul change is a lease mismatch and starts Mode A", async () => {
  const home = tempHome();
  hookFakeSdk(home, fakeSdkPage());
  await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  const page = fakeSdkPage({ autoReply: "new thread" });
  hookFakeSdk(home, page);
  await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    messages: [{ role: "user", content: "hello there" }],
    lease: { ...lease, soul: "a different soul" },
  });
  assert.equal(lastFreebuffTurnForTest()?.mode, "A");
});

test("Mode A trims an 88k packed payload to the 32k composer budget", async () => {
  const home = tempHome();
  const page = fakeSdkPage();
  hookFakeSdk(home, page);
  const history = Array.from({ length: 24 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: "n".repeat(8_000) + String(i),
  }));
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "sys",
    messages: [...history, { role: "user", content: "now" }],
    lease: { ...lease, userMessage: "now" },
  });
  assert.equal(done.text, "pong");
  const paste = lastFreebuffTurnForTest()?.paste || "";
  assert.ok(paste.length <= FREEBUFF_COMPOSER_CHAR_BUDGET);
  assert.match(paste, /now/);
  assert.equal(lastFreebuffTurnForTest()?.mode, "A");
});

test("a 40k-character system is over the composer, not the old 32k-token window", async () => {
  const home = tempHome();
  const page = fakeSdkPage();
  hookFakeSdk(home, page);
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "S".repeat(40_000),
    messages: [{ role: "user", content: "hi" }],
    lease,
  });
  assert.match(done.text, /freebuff_context_too_large/);
  assert.equal(page.prompts.length, 0);
});

test("SDK run uses costMode=free and startStreamIdle, never clipboard paste", async () => {
  const home = tempHome();
  hookFakeSdk(home, fakeSdkPage());
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "sys",
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  assert.equal(done.text, "pong");
  const bridge = readFileSync(new URL("../src/freebuff-bridge.ts", import.meta.url), "utf8");
  assert.match(bridge, /costMode:\s*"free"/);
  assert.match(bridge, /startStreamIdle/);
  assert.match(bridge, /STREAM_IDLE_TIMEOUT_MS/);
  assert.doesNotMatch(bridge, /clipboard/i);
  assert.doesNotMatch(bridge, /Input\.insertText/);
});

test("stream emits suffix deltas", async () => {
  const home = tempHome();
  const page = fakeSdkPage({ streamChunks: ["Hello", " world"], autoReply: "Hello world" });
  hookFakeSdk(home, page);
  const seen: string[] = [];
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "sys",
    messages: [{ role: "user", content: "hello there" }],
    lease,
    toolCtx: {
      dataDir: home,
      spawnDepth: 0,
      allowWrite: true,
      onProgress: (update) => {
        if (update.thinking) seen.push(update.thinking);
      },
    },
  });
  assert.equal(done.text, "Hello world");
  assert.ok(seen.includes("Hello") || seen.includes("Hello world"));
  assert.ok(seen.includes(FREEBUFF_PROGRESS_WAIT) || seen.some((row) => /SDK|session/.test(row)));
});

test("idle Stop returns the freebuff_stream_idle table string, not StreamIdleError", async () => {
  const home = tempHome();
  const page = fakeSdkPage({ hang: true });
  hookFakeSdk(home, page, { streamIdleMs: 80 });
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "sys",
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  assert.match(done.text, /^模型請求失敗：Freebuff Chat: freebuff_stream_idle — /);
  assert.doesNotMatch(done.text, /Codex-style/);
  assert.doesNotMatch(done.text, /不是訂閱失效/);
  assert.doesNotMatch(done.text, /stream idle: no tokens/);
});

test("user Stop during stream throws AbortError", async () => {
  const home = tempHome();
  const page = fakeSdkPage({ hang: true });
  hookFakeSdk(home, page);
  const ctrl = new AbortController();
  const pending = completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "sys",
    messages: [{ role: "user", content: "hello there" }],
    lease,
    signal: ctrl.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  ctrl.abort();
  await assert.rejects(
    pending,
    (err: unknown) => err instanceof Error && err.name === "AbortError",
  );
});

test("logout drops tabLease so the next turn is Mode A", async () => {
  const home = tempHome();
  hookFakeSdk(home, fakeSdkPage());
  await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "sys",
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  assert.equal(lastFreebuffTurnForTest()?.mode, "A");
  await logoutFreebuff(home);
  hookFakeSdk(home, fakeSdkPage({ autoReply: "after-logout" }));
  const afterLogout = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "sys",
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  assert.equal(afterLogout.text, "after-logout");
  assert.equal(lastFreebuffTurnForTest()?.mode, "A");
});

test("late steer is a Mode C suffix and does not re-send the user message", async () => {
  const home = tempHome();
  const page = fakeSdkPage({ autoReply: "first" });
  hookFakeSdk(home, page);
  let pulls = 0;
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "sys",
    messages: [{ role: "user", content: "hello there" }],
    lease,
    toolCtx: {
      dataDir: home,
      spawnDepth: 0,
      allowWrite: true,
      pullSteers: () => {
        pulls += 1;
        return pulls === 2 ? ["also mention pears"] : [];
      },
    },
  });
  assert.equal(done.text, "first");
  const suffix = lastFreebuffTurnForTest()?.paste || "";
  if (lastFreebuffTurnForTest()?.mode === "C") {
    assert.match(suffix, /pears/);
    assert.doesNotMatch(suffix, /You ARE the model behind a Guild seat/);
    assert.notEqual(suffix.trim(), "hello there");
  }
});

test("production comments do not name Mode A or PR 4", () => {
  const compact = readFileSync(new URL("../src/compact.ts", import.meta.url), "utf8");
  const generate = readFileSync(new URL("../src/generate.ts", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../src/freebuff-chat.ts", import.meta.url), "utf8");
  assert.doesNotMatch(compact, /Mode A/);
  assert.doesNotMatch(generate, /after the mutex/);
  assert.doesNotMatch(chat, /PR 4/);
});
