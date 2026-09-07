import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  answerComputerGrant,
  abortComputerGrant,
  computerAllowed,
  computerGrantPath,
  pendingComputerGrant,
  persistComputerAllow,
  waitComputerGrant,
} from "../src/computer-grant.ts";
import {
  computerToolEnabled,
  isBrowserOpenTarget,
  isBrowserOwnerName,
  ownerFromWindowLine,
  runComputer,
} from "../src/computer.ts";
import { gateTool } from "../src/harness.ts";
import { executeTool, guildTools, TOOL_SYSTEM } from "../src/tools.ts";
import { writeModelsFile } from "../src/llm.ts";
import { closeServer, listen as listenApp } from "./app.ts";
import { GuildStore } from "../src/store.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-computer-"));
}

test("computer allow persists; deny is this-turn only", async () => {
  const dataDir = tempHome();
  assert.equal(computerAllowed(dataDir), false);
  persistComputerAllow(dataDir);
  assert.equal(computerAllowed(dataDir), true);
  const saved = JSON.parse(readFileSync(computerGrantPath(dataDir), "utf8")) as {
    allowed: boolean;
  };
  assert.equal(saved.allowed, true);

  const dataDir2 = tempHome();
  const signal = new AbortController().signal;
  const waiting = waitComputerGrant({
    dataDir: dataDir2,
    roomId: "room-a",
    botId: "bot-a",
    signal,
    onWait: () => {},
  });
  assert.equal(pendingComputerGrant("room-a", "bot-a"), true);
  assert.equal(answerComputerGrant("room-a", "bot-a", false, dataDir2), true);
  assert.equal(await waiting, false);
  assert.equal(computerAllowed(dataDir2), false);

  const t0 = Date.now();
  const again = await waitComputerGrant({
    dataDir: dataDir2,
    roomId: "room-a",
    botId: "bot-a",
    signal,
  });
  assert.equal(again, false);
  assert.ok(Date.now() - t0 < 80);

  const next = new AbortController().signal;
  const second = waitComputerGrant({
    dataDir: dataDir2,
    roomId: "room-a",
    botId: "bot-a",
    signal: next,
    onWait: () => {},
  });
  assert.equal(pendingComputerGrant("room-a", "bot-a"), true);
  assert.equal(answerComputerGrant("room-a", "bot-a", true, dataDir2), true);
  assert.equal(await second, true);
  assert.equal(computerAllowed(dataDir2), true);
});

test("abort drops a pending computer grant without persisting allow", async () => {
  const dataDir = tempHome();
  const ac = new AbortController();
  const pending = waitComputerGrant({
    dataDir,
    roomId: "room-b",
    botId: "bot-b",
    signal: ac.signal,
    onWait: () => {},
  });
  abortComputerGrant("room-b", "bot-b");
  assert.equal(await pending, false);
  assert.equal(computerAllowed(dataDir), false);
  assert.equal(pendingComputerGrant("room-b", "bot-b"), false);
});

test("read_only sandbox refuses computer; workspace_write does not hide it on macOS", () => {
  assert.equal(computerToolEnabled("linux"), false);
  assert.equal(computerToolEnabled("darwin"), true);
  const refused = gateTool("computer", { action: "idle" }, { sandbox: "read_only" });
  assert.ok(refused?.isError);
  assert.equal(
    gateTool("computer", { action: "idle" }, { sandbox: "workspace_write" }),
    null,
  );
  assert.match(TOOL_SYSTEM, /\bcomputer\b/);
  if (process.platform === "darwin") {
    const tools = guildTools([], { sandbox: "workspace_write" });
    assert.ok(tools.some((tool) => tool.name === "computer"));
    const locked = guildTools([], { sandbox: "read_only" });
    assert.ok(!locked.some((tool) => tool.name === "computer"));
  }
});

test("computer without a grant and no live seat refuses", async () => {
  const dataDir = tempHome();
  const result = await executeTool(
    "computer",
    { action: "idle" },
    { dataDir, sandbox: "workspace_write" },
  );
  assert.equal(result.isError, true);
  assert.match(result.text, /computer_refused|macOS only/);
});

test("POST /channels/:id/computer answers a pending grant", async () => {
  const dataDir = tempHome();
  writeModelsFile(dataDir, { default: null, providers: {} });
  const { server, origin } = await listenApp(dataDir, {});
  try {
    const created = await fetch(`${origin}/channels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ops" }),
    });
    const channel = (await created.json()) as { id: string };
    const store = new GuildStore(dataDir);
    const pm = store.listBots().find((bot) => bot.handle === "pm");
    assert.ok(pm);
    const waiting = waitComputerGrant({
      dataDir,
      roomId: channel.id,
      botId: pm.id,
      signal: new AbortController().signal,
      onWait: () => {},
    });
    const posted = await fetch(`${origin}/channels/${channel.id}/computer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: pm.id, allow: true }),
    });
    assert.equal(posted.status, 200);
    const body = (await posted.json()) as { allowed: boolean };
    assert.equal(body.allowed, true);
    assert.equal(await waiting, true);
    assert.equal(computerAllowed(dataDir), true);
    assert.equal(existsSync(computerGrantPath(dataDir)), true);
  } finally {
    await closeServer(server);
  }
});

test("runComputer idle works after allow on macOS", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("guildmac is darwin");
    return;
  }
  const dataDir = tempHome();
  persistComputerAllow(dataDir);
  const result = await runComputer(
    { action: "idle" },
    { dataDir, askComputer: async () => true },
  );
  if (result.isError && /swiftc|Command Line Tools/.test(result.text)) {
    t.skip(result.text);
    return;
  }
  assert.equal(result.isError, false);
  assert.match(result.text, /idle=/);
});

test("browser owner match is exact, not substring arc", () => {
  assert.equal(isBrowserOwnerName("Google Chrome"), true);
  assert.equal(isBrowserOwnerName("Arc"), true);
  assert.equal(isBrowserOwnerName("Archive Utility"), false);
  assert.equal(isBrowserOwnerName("Microsoft Edge"), true);
  const line =
    "id=1 pid=2 owner=Archive Utility on=on 100x80 +0,0 title=Archive Utility";
  assert.equal(ownerFromWindowLine(line), "Archive Utility");
  assert.equal(isBrowserOwnerName(ownerFromWindowLine(line)), false);
  assert.equal(isBrowserOpenTarget("/Applications/Arc.app"), true);
  assert.equal(isBrowserOpenTarget("/Applications/Brave Browser.app"), true);
  assert.equal(isBrowserOpenTarget("/Applications/TextEdit.app"), false);
});

test("computer catalog names ax, see, and pid-default writes", () => {
  if (process.platform !== "darwin") return;
  const tool = guildTools([], { sandbox: "workspace_write" }).find(
    (item) => item.name === "computer",
  );
  assert.ok(tool);
  assert.match(tool.description, /\bax\b/);
  assert.match(tool.description, /\bsee\b/);
  assert.match(tool.description, /without stealing focus/);
});

test("runComputer hud and ax after allow on macOS", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("guildmac is darwin");
    return;
  }
  const dataDir = tempHome();
  persistComputerAllow(dataDir);
  const hud = await runComputer(
    { action: "hud", ms: 80 },
    { dataDir, askComputer: async () => true },
  );
  if (hud.isError && /swiftc|Command Line Tools/.test(hud.text)) {
    t.skip(hud.text);
    return;
  }
  assert.equal(hud.isError, false);
  assert.match(hud.text, /hud /);

  const listed = await runComputer(
    { action: "windows" },
    { dataDir, askComputer: async () => true },
  );
  assert.equal(listed.isError, false);
  const id = /id=(\d+)/.exec(listed.text)?.[1];
  if (!id) {
    t.skip("no windows");
    return;
  }
  const ax = await runComputer(
    { action: "ax", window: id },
    { dataDir, askComputer: async () => true },
  );
  if (ax.isError && /accessibility/.test(ax.text)) {
    t.skip(ax.text);
    return;
  }
  assert.equal(ax.isError, false);
  assert.match(ax.text, /^ax /);
});
