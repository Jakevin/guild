import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeModelsFile } from "../src/llm.ts";
import { closeServer, listen as listenApp } from "./app.ts";
import { synthesizeTrajectory, turnTrajectoryEvents } from "../src/trajectory.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-traj-"));
}

test("turnTrajectoryEvents records system, tool, and assistant", () => {
  const events = turnTrajectoryEvents({
    turnId: "t1",
    botId: "bot-rd",
    system: "You are RD.",
    model: { provider: "xai-oauth", model: "grok-4.6" },
    thinking: "need to list files",
    traces: [
      {
        name: "run",
        args: { command: "ls" },
        text: "chat.html\n",
        isError: false,
      },
    ],
    text: "看到 chat.html 了。",
    source: "llm",
  });
  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds, ["model", "system", "thinking", "tool", "assistant"]);
  assert.match(JSON.stringify(events[3].payload), /ls/);
});

test("synthesizeTrajectory rebuilds a log from stored parts", () => {
  const events = synthesizeTrajectory([
    {
      id: "u1",
      roomId: "r",
      author: "you",
      body: "list files",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "a1",
      roomId: "r",
      author: "bot-rd",
      body: "ok",
      parts: [
        { type: "tool", name: "run", detail: "ls", output: "a.txt", isError: false },
        { type: "text", text: "ok" },
      ],
      createdAt: "2026-01-01T00:00:01.000Z",
    },
  ]);
  assert.equal(events[0].kind, "user");
  assert.equal(events[1].kind, "tool");
  assert.equal(events[1].botId, "bot-rd");
  assert.equal(events[2].kind, "assistant");
  assert.equal(events[2].botId, "bot-rd");
});

test("POST then GET trajectory includes the user event and a log file", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const { server, origin } = await listenApp(dataDir);
  try {
    const bots = (await fetch(`${origin}/workspace`).then((r) => r.json())) as {
      bots: { id: string; handle: string }[];
    };
    const rd = bots.bots.find((b) => b.handle === "rd");
    assert.ok(rd);
    const posted = await fetch(`${origin}/dms/${rd.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "ping trajectory" }),
    });
    assert.equal(posted.status, 201);
    const traj = await fetch(`${origin}/dms/${rd.id}/trajectory`).then((r) =>
      r.json(),
    );
    assert.equal(traj.source, "log");
    assert.ok(Array.isArray(traj.events));
    assert.ok(traj.events.some((e: { kind: string }) => e.kind === "user"));
    assert.ok(traj.events.some((e: { kind: string }) => e.kind === "assistant"));
    assert.ok(traj.events.some((e: { kind: string }) => e.kind === "system"));
  } finally {
    await closeServer(server);
  }
});
