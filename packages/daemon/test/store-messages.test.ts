import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { GUILD_DB_FILE, TRAJECTORY_HOT_CAP } from "../src/db.ts";
import { GuildStore, isFailedAssistantReply } from "../src/store.ts";
import type { TrajectoryDraft } from "../src/trajectory.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-messages-"));
}

function trajDraft(i: number): TrajectoryDraft {
  return {
    ts: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    turnId: `t${i}`,
    kind: "tool",
    summary: `row ${i}`,
  };
}

function readJsonl(path: string): { seq: number; summary: string }[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { seq: number; summary: string });
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

test("deleteMessage removes one row and leaves the rest", () => {
  const home = tempHome();
  const store = new GuildStore(home);
  store.appendMessage("channel-general", "you", "one");
  const two = store.appendMessage("channel-general", "you", "two");
  store.appendMessage("channel-general", "you", "three");
  const removed = store.deleteMessage("channel-general", two.id);
  assert.equal(removed.body, "two");
  assert.deepEqual(
    store.listMessages("channel-general").map((item) => item.body),
    ["one", "three"],
  );
  assert.equal(store.lastMessagePreview("channel-general")?.body, "three");
  assert.throws(
    () => store.deleteMessage("channel-general", two.id),
    /message not found/,
  );
  store.close();
});

test("new turn drops that bot's last failed reply", () => {
  const home = tempHome();
  const store = new GuildStore(home);
  try {
    const design = store.listBots().find((bot) => bot.handle === "design");
    assert.ok(design);
    assert.equal(isFailedAssistantReply("Connection error."), true);
    assert.equal(isFailedAssistantReply("Failed to fetch"), true);
    assert.equal(isFailedAssistantReply("here are the stills"), false);
    store.appendMessage("channel-general", "you", "make stills");
    store.appendMessage("channel-general", design.id, "Connection error.");
    store.appendMessage("channel-general", "you", "try again");
    const removed = store.dropLastFailedReply("channel-general", design.id);
    assert.equal(removed?.body, "Connection error.");
    assert.deepEqual(
      store.listMessages("channel-general").map((item) => item.body),
      ["make stills", "try again"],
    );
    store.appendMessage("channel-general", design.id, "here are the stills");
    assert.equal(store.dropLastFailedReply("channel-general", design.id), null);
    assert.equal(
      store.listMessages("channel-general").at(-1)?.body,
      "here are the stills",
    );
  } finally {
    store.close();
  }
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

test("appendTrajectory waits until the room is idle before spilling to jsonl", () => {
  const home = tempHome();
  const store = new GuildStore(home);
  const extra = 5;
  const total = TRAJECTORY_HOT_CAP + extra;
  const warehouse = join(home, "rooms", "channel-general", "trajectory.jsonl");
  try {
    const signal = store.beginTurn("channel-general", ["bot-a", "bot-b"]);
    const written = store.appendTrajectory(
      "channel-general",
      Array.from({ length: total }, (_, i) => trajDraft(i)),
    );
    assert.equal(written.length, total);
    assert.equal(written[0]?.seq, 0);
    assert.equal(written[total - 1]?.seq, total - 1);
    assert.equal(store.listTrajectory("channel-general").length, total);
    assert.equal(existsSync(warehouse), false);

    store.appendTrajectory("channel-general", [trajDraft(total)]);
    assert.equal(store.listTrajectory("channel-general").length, total + 1);
    assert.equal(existsSync(warehouse), false);

    store.endTurn("channel-general", signal);
    const listed = store.listTrajectory("channel-general");
    assert.equal(listed.length, TRAJECTORY_HOT_CAP);
    assert.deepEqual(
      listed.map((item) => item.seq),
      Array.from({ length: TRAJECTORY_HOT_CAP }, (_, i) => extra + 1 + i),
    );
    assert.deepEqual(
      readJsonl(warehouse).map((item) => item.seq),
      Array.from({ length: extra + 1 }, (_, i) => i),
    );
    assert.equal(listed[listed.length - 1]?.seq, total);

    const next = store.appendTrajectory("channel-general", [trajDraft(total + 1)]);
    assert.equal(next[0]?.seq, total + 1);
    assert.equal(store.listTrajectory("channel-general").length, TRAJECTORY_HOT_CAP + 1);
    assert.deepEqual(
      readJsonl(warehouse).map((item) => item.seq),
      Array.from({ length: extra + 1 }, (_, i) => i),
    );
    store.endTurn("channel-general");
    const after = store.listTrajectory("channel-general");
    assert.equal(after.length, TRAJECTORY_HOT_CAP);
    assert.equal(after[0]?.seq, extra + 2);
    assert.equal(after[after.length - 1]?.seq, total + 1);
    assert.deepEqual(
      readJsonl(warehouse).map((item) => item.seq),
      Array.from({ length: extra + 2 }, (_, i) => i),
    );

    const other = store.createChannel("warehouse-other");
    store.appendTrajectory(other.id, [trajDraft(0), trajDraft(1)]);
    store.endTurn(other.id);
    assert.equal(store.listTrajectory(other.id).length, 2);
    assert.equal(
      existsSync(join(home, "rooms", other.id, "trajectory.jsonl")),
      false,
    );
  } finally {
    store.close();
  }
});

test("opening the store spills sqlite overflow that predated the warehouse", () => {
  const home = tempHome();
  const store = new GuildStore(home);
  try {
    store.appendTrajectory("channel-general", [trajDraft(0)]);
  } finally {
    store.close();
  }

  const sqlite = new DatabaseSync(join(home, GUILD_DB_FILE));
  const insert = sqlite.prepare(
    `INSERT INTO trajectory (
       room_id, seq, ts, turn_id, bot_id, kind, summary, payload, result, duration_ms, is_error
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const extra = 5;
  for (let i = 1; i < TRAJECTORY_HOT_CAP + extra; i++) {
    const draft = trajDraft(i);
    insert.run(
      "channel-general",
      i,
      draft.ts,
      draft.turnId,
      null,
      draft.kind,
      draft.summary,
      null,
      null,
      null,
      0,
    );
  }
  sqlite.close();

  const again = new GuildStore(home);
  try {
    const listed = again.listTrajectory("channel-general");
    assert.equal(listed.length, TRAJECTORY_HOT_CAP);
    assert.equal(listed[0]?.seq, extra);
    assert.equal(listed[listed.length - 1]?.seq, TRAJECTORY_HOT_CAP + extra - 1);
    assert.deepEqual(
      readJsonl(join(home, "rooms", "channel-general", "trajectory.jsonl")).map(
        (item) => item.seq,
      ),
      Array.from({ length: extra }, (_, i) => i),
    );
  } finally {
    again.close();
  }
});

test("legacy trajectory.jsonl under the cap imports into sqlite and is deleted", () => {
  const home = tempHome();
  const store = new GuildStore(home);
  store.close();

  const path = join(home, "rooms", "channel-general", "trajectory.jsonl");
  mkdirSync(join(home, "rooms", "channel-general"), { recursive: true });
  writeFileSync(
    path,
    [0, 1]
      .map((i) => JSON.stringify({ ...trajDraft(i), seq: i }) + "\n")
      .join(""),
  );

  const again = new GuildStore(home);
  try {
    assert.deepEqual(
      again.listTrajectory("channel-general").map((item) => item.seq),
      [0, 1],
    );
    assert.equal(existsSync(path), false);
  } finally {
    again.close();
  }
});

test("legacy trajectory.jsonl over the cap keeps the prefix in the warehouse", () => {
  const home = tempHome();
  const store = new GuildStore(home);
  store.close();

  const extra = 7;
  const total = TRAJECTORY_HOT_CAP + extra;
  const path = join(home, "rooms", "channel-general", "trajectory.jsonl");
  mkdirSync(join(home, "rooms", "channel-general"), { recursive: true });
  writeFileSync(
    path,
    Array.from({ length: total }, (_, i) =>
      JSON.stringify({ ...trajDraft(i), seq: i }),
    ).join("\n") + "\n",
  );

  const again = new GuildStore(home);
  try {
    const listed = again.listTrajectory("channel-general");
    assert.equal(listed.length, TRAJECTORY_HOT_CAP);
    assert.equal(listed[0]?.seq, extra);
    assert.equal(listed[listed.length - 1]?.seq, total - 1);
    assert.deepEqual(
      readJsonl(path).map((item) => item.seq),
      Array.from({ length: extra }, (_, i) => i),
    );
    const next = again.appendTrajectory("channel-general", [trajDraft(total)]);
    assert.equal(next[0]?.seq, total);
  } finally {
    again.close();
  }
});
