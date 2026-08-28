import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GUILD_DB_FILE } from "../src/db.ts";
import { GuildStore } from "../src/store.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-messages-"));
}

test("appendMessage persists in sqlite across reopen", () => {
  const home = tempHome();
  const store = new GuildStore(home);
  store.appendMessage("channel-general", "you", "one");
  store.appendMessage("channel-general", "you", "two");
  assert.equal(existsSync(join(home, GUILD_DB_FILE)), true);
  assert.equal(
    existsSync(join(home, "rooms", "channel-general", "messages.jsonl")),
    false,
  );
  assert.deepEqual(
    store.listMessages("channel-general").map((item) => item.body),
    ["one", "two"],
  );
  store.close();
  const again = new GuildStore(home);
  assert.deepEqual(
    again.listMessages("channel-general").map((item) => item.body),
    ["one", "two"],
  );
  assert.equal(again.lastMessagePreview("channel-general")?.body, "two");
  again.close();
});

test("legacy jsonl and json import into sqlite then drop files", () => {
  const home = tempHome();
  const dir = join(home, "rooms", "channel-general");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "room.json"),
    `${JSON.stringify({
      id: "channel-general",
      kind: "channel",
      name: "general",
      memberIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    })}\n`,
  );
  writeFileSync(
    join(dir, "messages.jsonl"),
    `${JSON.stringify({
      id: "a",
      roomId: "channel-general",
      author: "you",
      body: "from-jsonl",
      createdAt: "2026-01-01T00:00:00.000Z",
    })}\n`,
  );
  const store = new GuildStore(home);
  try {
    const bodies = store.listMessages("channel-general").map((item) => item.body);
    assert.equal(bodies.includes("from-jsonl"), true);
    assert.equal(existsSync(join(dir, "messages.jsonl")), false);
    assert.equal(existsSync(join(dir, "room.json")), false);
  } finally {
    store.close();
  }

  const other = tempHome();
  const otherDir = join(other, "rooms", "channel-general");
  mkdirSync(otherDir, { recursive: true });
  writeFileSync(
    join(otherDir, "room.json"),
    `${JSON.stringify({
      id: "channel-general",
      kind: "channel",
      name: "general",
      memberIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    })}\n`,
  );
  writeFileSync(
    join(otherDir, "messages.json"),
    `${JSON.stringify(
      [
        {
          id: "old",
          roomId: "channel-general",
          author: "you",
          body: "legacy",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      null,
      2,
    )}\n`,
  );
  const jsonStore = new GuildStore(other);
  try {
    assert.equal(jsonStore.listMessages("channel-general")[0]?.body, "legacy");
    assert.equal(existsSync(join(otherDir, "messages.json")), false);
  } finally {
    jsonStore.close();
  }
});

test("update and truncate rewrite sqlite rows", () => {
  const home = tempHome();
  const store = new GuildStore(home);
  try {
    const first = store.appendMessage("channel-general", "you", "keep");
    const second = store.appendMessage("channel-general", "you", "drop");
    store.updateMessage("channel-general", first.id, "kept");
    store.truncateAfter("channel-general", first.id);
    assert.deepEqual(
      store.listMessages("channel-general").map((item) => item.body),
      ["kept"],
    );
    assert.equal(
      store.listMessages("channel-general").some((item) => item.id === second.id),
      false,
    );
  } finally {
    store.close();
  }
});

test("appendTrajectory assigns seq in sqlite", () => {
  const home = tempHome();
  const store = new GuildStore(home);
  try {
    const first = store.appendTrajectory("channel-general", [
      {
        ts: "2026-01-01T00:00:00.000Z",
        turnId: "t1",
        kind: "user",
        summary: "hi",
      },
    ]);
    const second = store.appendTrajectory("channel-general", [
      {
        ts: "2026-01-01T00:00:01.000Z",
        turnId: "t1",
        kind: "assistant",
        summary: "yo",
      },
    ]);
    assert.equal(first[0]?.seq, 0);
    assert.equal(second[0]?.seq, 1);
    assert.deepEqual(
      store.listTrajectory("channel-general").map((item) => item.seq),
      [0, 1],
    );
    assert.equal(
      existsSync(join(home, "rooms", "channel-general", "trajectory.jsonl")),
      false,
    );
  } finally {
    store.close();
  }
});
