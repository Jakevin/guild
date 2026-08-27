import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { hostList, hostRead, hostTree } from "../src/host-browse.ts";
import { closeServer, listen as listenApp } from "./app.ts";

const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "guild-host-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "note.txt"), "hello guild host");
  writeFileSync(join(dir, "sub", "inner.md"), "# inner\n");
  return dir;
}

test("hostList and hostRead round-trip a temp folder", () => {
  const dir = tempDir();
  const listed = hostList(dir);
  assert.equal(listed.path, dir);
  assert.ok(listed.entries.some((entry) => entry.name === "note.txt" && entry.kind === "file"));
  assert.ok(listed.entries.some((entry) => entry.name === "sub" && entry.kind === "dir"));
  const file = hostRead(join(dir, "note.txt"));
  assert.equal(file.text, "hello guild host");
  const tree = hostTree(dir);
  assert.match(tree.text, /note\.txt/);
  assert.match(tree.text, /sub\//);
});

test("GET /host/ls and /host/read serve local files", async () => {
  const dir = tempDir();
  const dataDir = mkdtempSync(join(tmpdir(), "guild-home-"));
  const { server, origin } = await listenApp(dataDir, {});
  try {
    const ls = await fetch(
      `${origin}/host/ls?path=${encodeURIComponent(dir)}`,
    ).then(async (res) => ({ status: res.status, body: await res.json() }));
    assert.equal(ls.status, 200);
    assert.ok(
      (ls.body.entries as { name: string }[]).some((entry) => entry.name === "note.txt"),
    );
    const read = await fetch(
      `${origin}/host/read?path=${encodeURIComponent(join(dir, "note.txt"))}`,
    ).then(async (res) => ({ status: res.status, body: await res.json() }));
    assert.equal(read.status, 200);
    assert.equal(read.body.text, "hello guild host");
    const missing = await fetch(`${origin}/host/ls?path=/no/such/guild-path`).then(
      async (res) => ({ status: res.status, body: await res.json() }),
    );
    assert.equal(missing.status, 404);
  } finally {
    await closeServer(server);
  }
});

test("chat plus menu can attach files skills git rules and commands", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  assert.match(html, /attach-pop/);
  assert.match(html, /data-attach="upload"/);
  assert.match(html, /data-attach="files"/);
  assert.match(html, /data-attach="dirs"/);
  assert.match(html, /data-attach="skills"/);
  assert.match(html, /data-attach="conv"/);
  assert.match(html, /data-attach="git"/);
  assert.match(html, /data-attach="rules"/);
  assert.match(html, /data-attach="term"/);
  assert.match(html, /data-attach="tree"/);
  assert.match(html, /data-attach="slash"/);
  assert.match(html, /composeSendBody/);
  assert.match(html, /\/host\/ls/);
  assert.match(html, /data-chip-insert/);
  assert.match(html, /insertAttachToken/);
  assert.match(html, /nextAttachToken/);
});
