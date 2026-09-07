import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPACT_THRESHOLD_TOKENS,
  captureUsageAnchor,
  markCompactDeferred,
  markCompacted,
  noteProviderUsage,
  peekRoomUsage,
  resetRoomUsageForTests,
  resolvePressure,
  shouldCompress,
  shouldDeferToRealUsage,
  anchoredContextTokens,
} from "../src/usage-anchor.ts";
import { planCompact } from "../src/compact.ts";

test("captureUsageAnchor stores the priced prefix fingerprint", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
  ];
  const anchor = captureUsageAnchor(1200, 80, messages);
  assert.ok(anchor);
  assert.equal(anchor.promptTokens, 1200);
  assert.equal(anchor.baseCount, 2);
  assert.equal(anchor.baseLastRole, "user");
  assert.equal(captureUsageAnchor(0, 10, messages), null);
});

test("anchoredContextTokens adds only the delta after the priced prefix", () => {
  const sent = [
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
  ];
  const anchor = captureUsageAnchor(1000, 50, sent)!;
  const withReply = [
    ...sent,
    { role: "assistant", content: "hi" },
    { role: "tool", content: "out" },
  ];
  const tokens = anchoredContextTokens(withReply, anchor, (delta) => {
    assert.equal(delta.length, 1);
    assert.equal((delta[0] as { role: string }).role, "tool");
    return 40;
  });
  assert.equal(tokens, 1090);
  assert.equal(anchoredContextTokens(sent.slice(0, 1), anchor, () => 0), null);
});

test("Hermes gate: rough over threshold waits once; real never waits", () => {
  assert.equal(
    shouldDeferToRealUsage({
      source: "rough",
      tokens: COMPACT_THRESHOLD_TOKENS + 1,
      threshold: COMPACT_THRESHOLD_TOKENS,
      window: 400_000,
      alreadyWaited: false,
    }),
    true,
  );
  assert.equal(
    shouldDeferToRealUsage({
      source: "rough",
      tokens: COMPACT_THRESHOLD_TOKENS + 1,
      threshold: COMPACT_THRESHOLD_TOKENS,
      window: 400_000,
      alreadyWaited: true,
    }),
    false,
  );
  assert.equal(
    shouldDeferToRealUsage({
      source: "real",
      tokens: COMPACT_THRESHOLD_TOKENS + 1,
      threshold: COMPACT_THRESHOLD_TOKENS,
      window: 400_000,
      alreadyWaited: false,
    }),
    false,
  );
  assert.equal(
    shouldDeferToRealUsage({
      source: "rough",
      tokens: 400_000,
      threshold: COMPACT_THRESHOLD_TOKENS,
      window: 400_000,
      alreadyWaited: false,
    }),
    false,
  );
  assert.equal(shouldCompress(COMPACT_THRESHOLD_TOKENS, COMPACT_THRESHOLD_TOKENS), false);
  assert.equal(shouldCompress(COMPACT_THRESHOLD_TOKENS + 1, COMPACT_THRESHOLD_TOKENS), true);
});

test("awaiting real usage after compact reports 0 pressure", () => {
  const pressure = resolvePressure({
    rough: 200_000,
    lastPromptTokens: -1,
    awaitingAfterCompact: true,
  });
  assert.equal(pressure.tokens, 0);
  assert.equal(pressure.source, "real");
});

test("planCompact without a room still compacts on a rough over-budget", () => {
  resetRoomUsageForTests();
  const history = Array.from({ length: 24 }, (_, i) => ({
    id: "m" + i,
    author: i % 2 === 0 ? "you" : "bot-rd",
    body: "x".repeat(800) + " " + i,
  }));
  const plan = planCompact({
    system: "sys",
    history,
    userMessage: "now",
    tokenLimit: 1_200,
  });
  assert.equal(plan.mode, "compact");
});

test("planCompact with a room defers the first rough over-budget", () => {
  resetRoomUsageForTests();
  const history = Array.from({ length: 24 }, (_, i) => ({
    id: "m" + i,
    author: i % 2 === 0 ? "you" : "bot-rd",
    body: "x".repeat(800) + " " + i,
  }));
  const first = planCompact({
    system: "sys",
    history,
    userMessage: "now",
    tokenLimit: 1_200,
    roomId: "room-a",
  });
  assert.equal(first.mode, "full");
  assert.equal(peekRoomUsage("room-a")?.waitedOnce, true);
  const second = planCompact({
    system: "sys",
    history,
    userMessage: "now",
    tokenLimit: 1_200,
    roomId: "room-a",
  });
  assert.equal(second.mode, "compact");
});

test("planCompact uses last provider prompt tokens instead of a high rough guess", () => {
  resetRoomUsageForTests();
  noteProviderUsage("room-b", [{ role: "user", content: "hi" }], {
    input: 400,
    output: 20,
  });
  const history = Array.from({ length: 24 }, (_, i) => ({
    id: "m" + i,
    author: i % 2 === 0 ? "you" : "bot-rd",
    body: "x".repeat(800) + " " + i,
  }));
  const plan = planCompact({
    system: "sys",
    history,
    userMessage: "now",
    tokenLimit: 1_200,
    roomId: "room-b",
  });
  assert.equal(plan.mode, "full");
});

test("markCompacted then real usage clears the post-compact latch", () => {
  resetRoomUsageForTests();
  markCompactDeferred("room-c");
  markCompacted("room-c");
  assert.equal(peekRoomUsage("room-c")?.lastPromptTokens, -1);
  noteProviderUsage("room-c", [{ role: "user", content: "hi" }], {
    input: 900,
    output: 10,
  });
  assert.equal(peekRoomUsage("room-c")?.lastPromptTokens, 900);
  assert.equal(peekRoomUsage("room-c")?.awaitingAfterCompact, false);
});
