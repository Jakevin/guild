import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  lastFreebuffTurnForTest,
  resetFreebuffBridgeForTest,
} from "../src/freebuff-bridge.ts";
import {
  FREEBUFF_CHAT_DEFAULT_MODEL,
  FREEBUFF_CHAT_PICKER_ID,
  FREEBUFF_TOOL_SYSTEM,
  completeFreebuffChat,
  formatGuildToolResults,
  parseGuildToolsEnvelope,
  withFreebuffToolSystem,
} from "../src/freebuff-chat.ts";
import { HALL_RULES } from "../src/generate.ts";
import { TOOL_SYSTEM } from "../src/tools.ts";
import { fakeSdkPage, hookFakeSdk } from "./freebuff-sdk-harness.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-freebuff-tools-"));
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

test("image_gen is in the advertised guild_tools fence list", () => {
  assert.match(FREEBUFF_TOOL_SYSTEM, /image_gen/);
  assert.match(FREEBUFF_TOOL_SYSTEM, /```guild_tools/);
  const swapped = withFreebuffToolSystem(TOOL_SYSTEM);
  assert.match(swapped, /image_gen/);
  assert.match(swapped, /Allowed names:/);
  const withMcp = withFreebuffToolSystem(TOOL_SYSTEM, {
    mcpTools: [
      {
        callName: "mcp__docs__search",
        server: "docs",
        tool: "search",
        description: "search",
        inputSchema: { type: "object" },
      },
    ],
  });
  assert.match(withMcp, /mcp__docs__search/);
  assert.match(withMcp, /image_gen/);
});

test("parseGuildToolsEnvelope keeps the last legal fence and fills missing ids", () => {
  const parsed = parseGuildToolsEnvelope(`
prose
\`\`\`guild_tools
[{"id":"old","name":"read","args":{"path":"/tmp/a"}}]
\`\`\`
\`\`\`guild_tools
not json
\`\`\`
\`\`\`guild_tools
[{"name":"run","args":{"command":"df -h"}},{"id":"keep","name":"list","args":{"path":"."}}]
\`\`\`
ignore this
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.calls.length, 2);
  assert.equal(parsed.calls[0]?.id, "c0");
  assert.equal(parsed.calls[0]?.name, "run");
  assert.equal(parsed.calls[1]?.id, "keep");
  assert.match(parsed.text, /prose/);
  assert.doesNotMatch(parsed.text, /ignore this/);
  assert.doesNotMatch(parsed.text, /df -h/);
});

test("broken guild_tools fence with no legal fence is freebuff_tool_parse", () => {
  const parsed = parseGuildToolsEnvelope(`
\`\`\`guild_tools
{not: an array}
\`\`\`
`);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.code, "freebuff_tool_parse");
  const none = parseGuildToolsEnvelope("just a reply");
  assert.equal(none.ok, true);
  if (!none.ok) return;
  assert.deepEqual(none.calls, []);
  assert.equal(none.text, "just a reply");
});

test("write args may contain markdown fences without truncating the JSON array", () => {
  const content = "# Title\n```js\nconsole.log(1)\n```\nmore";
  const parsed = parseGuildToolsEnvelope(`
ok
\`\`\`guild_tools
[{"name":"write","args":{"path":"README.md","content":${JSON.stringify(content)}}}]
\`\`\`
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0]?.name, "write");
  assert.equal(parsed.calls[0]?.args.path, "README.md");
  assert.equal(parsed.calls[0]?.args.content, content);
});

test("guild_tools opener without a closer still parses a complete JSON array", () => {
  const parsed = parseGuildToolsEnvelope(`head
\`\`\`guild_tools
[{"name":"run","args":{"command":"df -h"}}]
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.calls[0]?.name, "run");
  assert.equal(parsed.calls[0]?.args.command, "df -h");
  assert.equal(parsed.text, "head");
});

test("guild_tools opener that never yields a legal array is freebuff_tool_parse", () => {
  const unclosed = parseGuildToolsEnvelope(`prose that must not be the final reply
\`\`\`guild_tools
`);
  assert.equal(unclosed.ok, false);
  if (unclosed.ok) return;
  assert.equal(unclosed.code, "freebuff_tool_parse");
  const truncated = parseGuildToolsEnvelope(`
\`\`\`guild_tools
[{"name":"write","args":{"content":"\`\`\`
`);
  assert.equal(truncated.ok, false);
  if (truncated.ok) return;
  assert.equal(truncated.code, "freebuff_tool_parse");
});

test("formatGuildToolResults wraps clipped tool output", () => {
  const block = formatGuildToolResults(
    [{ id: "c1", name: "run" }],
    [{ text: "ok" }],
  );
  assert.equal(
    block,
    `<guild_tool_result id="c1" name="run">\nok\n</guild_tool_result>`,
  );
});

test("lease match second Hall message does not contain the previous user full text", async () => {
  const home = tempHome();
  const page = fakeSdkPage();
  hookFakeSdk(home, page);
  await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: TOOL_SYSTEM,
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  page.autoReply = "second";
  const second = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: TOOL_SYSTEM,
    messages: [
      { role: "user", content: "hello there" },
      { role: "assistant", content: "pong" },
      { role: "user", content: "next question" },
    ],
    lease: { ...lease, userMessage: "next question" },
  });
  assert.equal(second.text, "second");
  const turn = lastFreebuffTurnForTest();
  assert.equal(turn?.mode, "B");
  assert.equal(turn?.paste, "next question");
  assert.doesNotMatch(turn?.paste || "", /hello there/);
});

test("Mode C suffix does not contain the round-0 user blob", async () => {
  const home = tempHome();
  const page = fakeSdkPage({
    replies: [
      '```guild_tools\n[{"name":"run","args":{"command":"echo guild-mode-c"}}]\n```\nplease ignore',
      "disk looks fine",
    ],
  });
  hookFakeSdk(home, page);
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: TOOL_SYSTEM,
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  assert.equal(done.text, "disk looks fine");
  assert.ok(page.prompts.length >= 2);
  const suffix = page.prompts[1] || "";
  assert.match(suffix, /<guild_tool_result id="c0" name="run">/);
  assert.match(suffix, /guild-mode-c/);
  assert.doesNotMatch(suffix, /hello there/);
  assert.doesNotMatch(suffix, /please ignore/);
  assert.equal(lastFreebuffTurnForTest()?.mode, "C");
  assert.equal(done.traces?.some((row) => row.name === "run"), true);
});

test("broken fence from the SDK is freebuff_tool_parse", async () => {
  const home = tempHome();
  hookFakeSdk(home, fakeSdkPage({ autoReply: "```guild_tools\n{broken\n```" }));
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: TOOL_SYSTEM,
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  assert.match(done.text, /freebuff_tool_parse/);
  assert.match(done.text, /^模型請求失敗：Freebuff Chat: freebuff_tool_parse — /);
});

test("unknown tool name still loops back as guild_tool_result", async () => {
  const home = tempHome();
  const page = fakeSdkPage({
    replies: [
      '```guild_tools\n[{"name":"not_a_real_tool","args":{}}]\n```',
      "gave up",
    ],
  });
  hookFakeSdk(home, page);
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: TOOL_SYSTEM,
    messages: [{ role: "user", content: "hello there" }],
    lease,
  });
  assert.equal(done.text, "gave up");
  const suffix = page.prompts[1] || lastFreebuffTurnForTest()?.paste || "";
  assert.match(suffix, /<guild_tool_result id="c0" name="not_a_real_tool">/);
  assert.match(suffix, /unknown tool: not_a_real_tool/);
  assert.equal(lastFreebuffTurnForTest()?.mode, "C");
});
