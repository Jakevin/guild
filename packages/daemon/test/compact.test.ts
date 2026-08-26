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
  assert.ok(plan.recent.length >= 6);
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
  assert.match(packed.messages[0].content, /compacted/i);
  assert.equal(packed.messages[packed.messages.length - 1].content, "what next");
  const lastRecent = packed.messages[packed.messages.length - 2];
  assert.equal(lastRecent.content, toModelMessage(history[15]).content);
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
