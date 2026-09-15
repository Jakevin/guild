import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canReuseCheckpoint,
  packHistory,
  planCompact,
  toModelMessage,
  trimSendMessages,
} from "../src/compact.ts";
import { compactIdleRooms, resetIdleCompactLockForTests } from "../src/idle-compact.ts";
import { GuildStore } from "../src/store.ts";
import { peekRoomUsage, resetRoomUsageForTests } from "../src/usage-anchor.ts";

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

test("compact summarizer treats shipped version cuts as Closed history", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../src/compact.ts", import.meta.url)),
    "utf8",
  );
  assert.match(src, /BACKGROUND only/);
  assert.match(src, /never an open Goal/);
});

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
  assert.match(packed.messages[0].content, /Do not revive Closed cuts/);
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
  assert.match(fitted[0].content, /Do not revive Closed cuts/);
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

function fillFat(store: GuildStore, roomId: string, botId: string): void {
  for (let i = 0; i < 16; i += 1) {
    store.appendMessage(
      roomId,
      i % 2 === 0 ? "you" : botId,
      `${"y".repeat(1_200)} ${i}`,
    );
  }
}

test("idle compact writes a checkpoint for a fat idle room and skips live turns", async () => {
  resetRoomUsageForTests();
  resetIdleCompactLockForTests();
  const dataDir = tempDir();
  const store = new GuildStore(dataDir);
  try {
    const general = store.listChannels().find((room) => room.id === "channel-general");
    assert.ok(general);
    const rd = store.listBots().find((bot) => bot.handle === "rd");
    assert.ok(rd);
    fillFat(store, general.id, rd.id);
    const fresh = await compactIdleRooms(store, {}, {
      idleMs: 60 * 60 * 1000,
      tokenLimit: 1_500,
      summarize: "local",
      limit: 20,
    });
    assert.equal(fresh.find((row) => row.roomId === general.id)?.skipped, "fresh");
    assert.equal(store.readCompact(general.id), null);

    const idle = await compactIdleRooms(store, {}, {
      idleMs: 0,
      tokenLimit: 1_500,
      summarize: "local",
      limit: 20,
    });
    assert.equal(idle.find((row) => row.roomId === general.id)?.compacted, true);
    assert.match(store.readCompact(general.id)?.summary || "", /compacted/i);
    assert.notEqual(peekRoomUsage(general.id)?.lastPromptTokens, -1);

    const livePack = await packHistory({
      system: "idle compact",
      history: store.listMessages(general.id).map((item) => ({
        id: item.id,
        author: item.author,
        body: item.body,
      })),
      userMessage: "now",
      dataDir,
      checkpoint: store.readCompact(general.id),
      tokenLimit: 1_500,
      summarize: "local",
      roomId: general.id,
    });
    assert.equal(livePack.compacted, true);
    assert.match(livePack.messages[0].content, /REFERENCE ONLY/);

    store.setLiveTurn(general.id, {
      botId: rd.id,
      thinking: "",
      steps: [],
    });
    const live = await compactIdleRooms(store, {}, {
      idleMs: 0,
      tokenLimit: 1_500,
      summarize: "local",
      limit: 20,
    });
    assert.equal(live.find((row) => row.roomId === general.id)?.skipped, "live");
  } finally {
    store.close();
    resetIdleCompactLockForTests();
    resetRoomUsageForTests();
  }
});

test("idle compact reuse does not block the next fat room", async () => {
  resetRoomUsageForTests();
  resetIdleCompactLockForTests();
  const dataDir = tempDir();
  const store = new GuildStore(dataDir);
  try {
    const general = store.listChannels().find((room) => room.id === "channel-general");
    assert.ok(general);
    const rd = store.listBots().find((bot) => bot.handle === "rd");
    assert.ok(rd);
    const extra = store.createChannel("fat-two");
    fillFat(store, general.id, rd.id);
    fillFat(store, extra.id, rd.id);

    const first = await compactIdleRooms(store, {}, {
      idleMs: 0,
      tokenLimit: 1_500,
      summarize: "local",
      limit: 1,
    });
    assert.equal(first.filter((row) => row.compacted).length, 1);
    const done = first.find((row) => row.compacted)?.roomId;
    assert.ok(done);

    const second = await compactIdleRooms(store, {}, {
      idleMs: 0,
      tokenLimit: 1_500,
      summarize: "local",
      limit: 1,
    });
    assert.equal(second.find((row) => row.roomId === done)?.skipped, "current");
    const other = done === general.id ? extra.id : general.id;
    assert.equal(second.find((row) => row.roomId === other)?.compacted, true);
  } finally {
    store.close();
    resetIdleCompactLockForTests();
    resetRoomUsageForTests();
  }
});

test("idle compact skips a second overlapping call", async () => {
  resetRoomUsageForTests();
  resetIdleCompactLockForTests();
  const dataDir = tempDir();
  const store = new GuildStore(dataDir);
  try {
    const general = store.listChannels().find((room) => room.id === "channel-general");
    assert.ok(general);
    const rd = store.listBots().find((bot) => bot.handle === "rd");
    assert.ok(rd);
    fillFat(store, general.id, rd.id);
    const first = compactIdleRooms(store, {}, {
      idleMs: 0,
      tokenLimit: 1_500,
      summarize: "local",
      limit: 1,
    });
    const overlap = await compactIdleRooms(store, {}, {
      idleMs: 0,
      tokenLimit: 1_500,
      summarize: "local",
      limit: 1,
    });
    assert.deepEqual(overlap, []);
    assert.equal((await first).find((row) => row.roomId === general.id)?.compacted, true);
  } finally {
    store.close();
    resetIdleCompactLockForTests();
    resetRoomUsageForTests();
  }
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
