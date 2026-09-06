import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canReuseCheckpoint,
  packHistory,
  planCompact,
  toModelMessage,
  trimSendMessages,
} from "../src/compact.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "guild-compact-"));
}

function items(n: number, body = "hello world") {
  return Array.from({ length: n }, (_, i) => ({
    id: "m" + i,
    author: i % 2 === 0 ? "you" : "bot-rd",
    body: body + " " + i,
  }));
}

test("short rooms send the full transcript, not a last-8 slice", () => {
  const history = items(20);
  const plan = planCompact({
    system: "You are RD.",
    history,
    userMessage: "continue",
  });
  assert.equal(plan.mode, "full");
  assert.equal(plan.recent.length, 20);
  assert.equal(plan.old.length, 0);
});

test("over-budget rooms compact the head and keep a recent tail", () => {
  const history = items(24, "x".repeat(800));
  const plan = planCompact({
    system: "sys",
    history,
    userMessage: "now",
    tokenLimit: 1_200,
  });
  assert.equal(plan.mode, "compact");
  assert.ok(plan.old.length >= 6);
  assert.ok(plan.recent.length >= 2);
  assert.equal(plan.old.length + plan.recent.length, 24);
  assert.equal(plan.recent[0].id, history[plan.old.length].id);
});

test("packHistory writes a compact prefix then recent turns", async () => {
  const history = items(16, "y".repeat(1_200));
  const packed = await packHistory({
    system: "You are RD.",
    history,
    userMessage: "what next",
    dataDir: tempDir(),
    tokenLimit: 1_500,
  });
  assert.equal(packed.compacted, true);
  assert.ok(packed.checkpoint?.summary);
  assert.match(packed.messages[0].content, /REFERENCE ONLY/);
  assert.match(packed.messages[0].content, /compacted/i);
  assert.doesNotMatch(packed.messages[0].content, /Understood/);
  assert.equal(packed.messages.some((row) => row.role === "assistant" && /Understood/.test(row.content)), false);
  assert.equal(packed.messages[packed.messages.length - 1].content, "what next");
  const lastRecent = packed.messages[packed.messages.length - 2];
  assert.equal(lastRecent.content, toModelMessage(history[15]).content);
});

test("tool parts count toward compact budget and are clipped in the payload", () => {
  const history = items(8, "ok").map((item, i) =>
    i % 2
      ? {
          ...item,
          parts: [
            {
              type: "tool" as const,
              name: "read",
              detail: "i18n.js",
              output: "x".repeat(40_000),
            },
          ],
        }
      : item,
  );
  const plan = planCompact({
    system: "sys",
    history,
    userMessage: "now",
    tokenLimit: 4_000,
  });
  assert.equal(plan.mode, "compact");
  const packed = toModelMessage(history[1]);
  assert.match(packed.content, /read i18n\.js/);
  assert.ok(packed.content.length < 12_000);
  assert.match(packed.content, /truncated/i);
});

test("few huge messages compact instead of sending the lot", () => {
  const history = items(4, "z".repeat(20_000));
  const plan = planCompact({
    system: "sys",
    history,
    userMessage: "now",
    tokenLimit: 8_000,
  });
  assert.equal(plan.mode, "compact");
  assert.ok(plan.recent.length < 4);
  assert.ok(plan.old.length >= 1);
});

test("packHistory summarize:local does not need an LLM and skips onCompact when omitted", async () => {
  let compactCalls = 0;
  const history = items(16, "y".repeat(1_200));
  const packed = await packHistory({
    system: "You are RD.",
    history,
    userMessage: "what next",
    dataDir: tempDir(),
    tokenLimit: 1_500,
    summarize: "local",
  });
  assert.equal(packed.compacted, true);
  assert.ok(packed.checkpoint?.summary);
  assert.match(packed.checkpoint?.summary || "", /compacted/i);
  const withCb = await packHistory({
    system: "You are RD.",
    history,
    userMessage: "what next",
    dataDir: tempDir(),
    tokenLimit: 1_500,
    summarize: "local",
    onCompact: () => {
      compactCalls += 1;
    },
  });
  assert.equal(withCb.compacted, true);
  assert.equal(compactCalls, 1);
});

test("trimSendMessages drops the oldest prefix to fit the budget", () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: "n".repeat(3_000),
  }));
  const trimmed = trimSendMessages(messages, 0, 8_000);
  assert.ok(trimmed.length < messages.length);
  assert.ok(trimmed.length >= 2);
  assert.equal(trimmed[trimmed.length - 1].content, messages[19].content);
});

test("trimSendMessages pins the system message", () => {
  const messages = [
    { role: "system", content: "SYS" },
    ...Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "n".repeat(3_000),
    })),
  ];
  const trimmed = trimSendMessages(messages, 0, 8_000);
  assert.equal(trimmed[0].role, "system");
  assert.equal(trimmed[0].content, "SYS");
});

test("trimSendMessages keeps Command Code tool-call rows with their results", () => {
  const messages = [
    { role: "system", content: "SYS" },
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "1", toolName: "read", input: { path: "a" } },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "1",
          toolName: "read",
          output: { type: "text", value: "x".repeat(20_000) },
        },
      ],
    },
    { role: "user", content: "and now" },
  ];
  const trimmed = trimSendMessages(messages, 0, 200);
  assert.equal(trimmed[0].role, "system");
  const roles = trimmed.map((row) => row.role);
  if (roles.includes("tool")) {
    const toolAt = roles.indexOf("tool");
    assert.equal(roles[toolAt - 1], "assistant");
  } else {
    assert.equal(roles.includes("tool"), false);
  }
});

test("trimSendMessages does not start on an orphan tool result", () => {
  const messages = [
    { role: "system", content: "SYS" },
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "1", type: "function", function: { name: "read", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "1", content: "x".repeat(20_000) },
    { role: "user", content: "and now" },
  ];
  const trimmed = trimSendMessages(messages, 0, 200);
  assert.equal(trimmed[0].role, "system");
  assert.notEqual(trimmed[1]?.role, "tool");
});

test("fitSendMessages inserts a reference-only prefix when compacting", async () => {
  const { fitSendMessages } = await import("../src/send-budget.ts");
  const messages = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: "n".repeat(3_000),
  }));
  const fitted = fitSendMessages(messages, 0, { budget: 8_000, compact: true });
  assert.ok(fitted.length < messages.length);
  assert.match(fitted[0].content, /REFERENCE ONLY/);
});

test("toModelMessage keeps this seat as assistant and other bots as hall lines", () => {
  const mine = toModelMessage(
    { author: "bot-rd", body: "I patched llm.ts" },
    "bot-rd",
  );
  assert.equal(mine.role, "assistant");
  assert.equal(mine.content, "I patched llm.ts");
  const other = toModelMessage(
    { author: "bot-design", body: "@rd ship the cover" },
    "bot-rd",
  );
  assert.equal(other.role, "user");
  assert.match(other.content, /^\[bot-design\] /);
});

test("a matching checkpoint is reused instead of summarizing again", () => {
  const old = items(8);
  const checkpoint = {
    throughId: old[7].id!,
    summary: "already compacted",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messageCount: 8,
  };
  assert.equal(canReuseCheckpoint(checkpoint, old), true);
  assert.equal(canReuseCheckpoint(checkpoint, old.slice(0, 7)), false);
});
