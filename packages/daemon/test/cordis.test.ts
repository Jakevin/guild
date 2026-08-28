import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { healthPayload } from "../src/handlers.ts";
import { createGuildContext } from "../src/start.ts";
import { closeApp, listen, tempHome } from "./app.ts";

const DAEMON_ROOT = fileURLToPath(new URL("..", import.meta.url));

async function getJson(origin: string, path: string) {
  const response = await fetch(`${origin}${path}`);
  const body: unknown = await response.json();
  return { status: response.status, body };
}

async function postJson(origin: string, path: string, payload: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

test("shipped Cordis boot serves /health", async () => {
  const app = await listen(tempHome());
  try {
    const { status, body } = await getJson(app.origin, "/health");
    assert.equal(status, 200);
    assert.deepEqual(body, healthPayload());
    assert.deepEqual(body, {
      status: "ok",
      ready: true,
      service: "guildd",
    });
  } finally {
    await closeApp(app);
  }
});

test("MCP disabled via composition: empty GET, 503 POST, chat still 200", async () => {
  const app = await listen(tempHome(), {}, { patches: [{ id: "mcp", disabled: true }] });
  try {
    const listed = await getJson(app.origin, "/mcp/servers");
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body, []);

    const created = await postJson(app.origin, "/mcp/servers", {
      name: "echo",
      command: "node",
      args: ["echo-mcp.mjs"],
    });
    assert.equal(created.status, 503);
    assert.deepEqual(created.body, { error: "mcp_disabled" });

    const chat = await postJson(app.origin, "/channels/channel-general/messages", {
      body: "@pm ping",
    });
    assert.equal(chat.status, 201);
    const payload = chat.body as { replies?: unknown[]; message?: { body: string } };
    assert.ok(payload.message);
    assert.ok(Array.isArray(payload.replies));
    assert.ok((payload.replies?.length ?? 0) > 0);
  } finally {
    await closeApp(app);
  }
});

test("disposing the Cordis root fiber closes the listen port", async () => {
  const app = await listen(tempHome());
  const origin = app.origin;
  const health = await getJson(origin, "/health");
  assert.equal(health.status, 200);
  await closeApp(app);
  await assert.rejects(async () => {
    const response = await fetch(`${origin}/health`);
    await response.arrayBuffer();
  });
});

test("ctx.tools registers builtins and undoes a custom tool", async () => {
  const app = await listen(tempHome());
  try {
    assert.equal(app.ctx.tools.has("run"), true);
    assert.equal(app.ctx.tools.has("write"), true);
    const undo = app.ctx.tools.register("ping", async () => ({
      text: "pong",
      isError: false,
    }));
    const ping = await app.ctx.tools.execute("ping", {});
    assert.equal(ping.text, "pong");
    undo();
    const gone = await app.ctx.tools.execute("ping", {});
    assert.match(gone.text, /unknown tool: ping/);
    assert.equal(app.ctx.tools.has("mcp__echo__x"), true);
  } finally {
    await closeApp(app);
  }
});

test("composition without store does not listen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-cordis-"));
  const configPath = join(dir, "empty.yml");
  writeFileSync(
    configPath,
    "- id: logger\n  name: '@cordisjs/plugin-logger-console'\n",
  );
  await assert.rejects(
    () =>
      createGuildContext(
        {
          ...process.env,
          GUILD_HOME: tempHome(),
          GUILD_HOST: "127.0.0.1",
          GUILD_PORT: "0",
        },
        { configPath },
      ),
    /guildd did not listen/,
  );
  void DAEMON_ROOT;
});
