import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertHostPathAllowed,
  hostGit,
  hostList,
  hostRead,
  hostTree,
} from "../src/host-browse.ts";
import { StoreError } from "../src/store.ts";
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

test("GET /host/read from a foreign Origin is refused", async () => {
  const dir = tempDir();
  const dataDir = mkdtempSync(join(tmpdir(), "guild-home-"));
  const { server, origin } = await listenApp(dataDir, {});
  try {
    const target = encodeURIComponent(join(dir, "note.txt"));
    const evil = await fetch(
      `${origin}/host/read?path=${target}`,
      { headers: { origin: "https://evil.example" } },
    ).then(async (res) => ({ status: res.status, body: await res.json() }));
    assert.equal(evil.status, 403);
    assert.equal(evil.body.error, "cross-origin refused");
    assert.ok(!JSON.stringify(evil.body).includes("hello guild host"));
    const ls = await fetch(`${origin}/host/ls?path=${target}`, {
      headers: { origin: "https://evil.example" },
    });
    assert.equal(ls.status, 403);
    const same = await fetch(`${origin}/host/read?path=${target}`, {
      headers: { origin },
    });
    assert.equal(same.status, 200);
    assert.equal((await same.json()).text, "hello guild host");
  } finally {
    await closeServer(server);
  }
});

test("chat plus menu can attach files skills git rules schedule and commands", () => {
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
  assert.match(html, /data-attach="cron"/);
  assert.match(html, /data-attach="slash"/);
  assert.match(html, /kind === "cron"/);
  assert.match(html, /openCronDialog/);
  assert.match(html, /id="cron-ask"/);
  assert.match(html, /cron\.askBody/);
  assert.doesNotMatch(html, /id="cron-schedule"/);
  assert.doesNotMatch(html, /id="cron-prompt"/);
  assert.match(html, /composeSendBody/);
  assert.match(html, /\/host\/ls/);
  assert.match(html, /data-chip-insert/);
  assert.match(html, /insertAttachToken/);
  assert.match(html, /nextAttachToken/);
});

/** Returns the thrown "host path refused" error, or fails if anything else. */
function refused(fn: () => unknown): StoreError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof StoreError, `expected StoreError, got ${String(error)}`);
    assert.equal(error.status, 403);
    assert.match(error.message, /host path refused/);
    return error;
  }
  assert.fail("expected the secret path to be refused");
}

function notRefused(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof StoreError && /host path refused/.test(error.message)) {
      assert.fail("path was refused as a secret");
    }
  }
}

test("hostRead refuses guild secrets before touching the disk", () => {
  // The deny runs before stat, so these 403 whether or not the file exists.
  refused(() => hostRead(join(homedir(), ".guild", "oauth.json")));
  refused(() => hostRead(join(homedir(), ".guild", "models.json")));
  refused(() => hostRead(join(homedir(), ".guild", "mcp.json")));
  refused(() => hostRead("~/.guild/mcp.json"));
  refused(() => hostList(join(homedir(), ".guild", "mcp.json")));
  refused(() => hostRead("~/.guild/oauth.json"));
  refused(() => hostRead(join(homedir(), ".guild", "browser-profile", "Default", "Cookies")));
  refused(() => hostList(join(homedir(), ".guild", "browser-profile")));
  refused(() => hostTree(join(homedir(), ".guild", "browser-profile")));
  refused(() => assertHostPathAllowed(join(homedir(), ".guild", "oauth.json")));
  // The rest of ~/.guild stays browsable for the attach picker.
  notRefused(() => hostList(join(homedir(), ".guild")));
});

test("hostRead refuses home credential files before stat", () => {
  // None of these need to exist: the denylist runs before any disk access.
  refused(() => hostRead(join(homedir(), ".claude.json")));
  refused(() => hostRead("~/.claude.json"));
  refused(() => hostRead(join(homedir(), ".npmrc")));
  refused(() => hostRead(join(homedir(), ".netrc")));
  refused(() => hostRead(join(homedir(), "_netrc")));
  refused(() => hostRead(join(homedir(), ".yarnrc.yml")));
  refused(() => hostRead(join(homedir(), ".git-credentials")));
  refused(() => hostRead(join(homedir(), ".env")));
  refused(() => hostRead(join(homedir(), ".env.local")));
  refused(() => hostRead(join(homedir(), ".env.production")));
  refused(() => hostRead(join(homedir(), ".pgpass")));
  refused(() => hostRead(join(homedir(), ".pypirc")));
  refused(() => hostRead(join(homedir(), ".my.cnf")));
  refused(() => hostRead(join(homedir(), "credentials.json")));
  refused(() => hostRead(join(tempDir(), "service-account.json")));
  refused(() => hostRead(join(tempDir(), ".env.staging")));
  // A project .npmrc is not the home npm login file.
  notRefused(() => hostRead(join(tempDir(), ".npmrc")));
});

test("hostRead refuses credential directories under $HOME", () => {
  refused(() => hostRead(join(homedir(), ".aws", "credentials")));
  refused(() => hostList(join(homedir(), ".aws")));
  refused(() => hostRead(join(homedir(), ".docker", "config.json")));
  refused(() => hostRead(join(homedir(), ".gnupg", "secring.gpg")));
  refused(() => hostRead(join(homedir(), ".claude", "settings.json")));
  refused(() => hostList(join(homedir(), ".claude")));
  refused(() => hostRead(join(homedir(), ".codex", "config.toml")));
  refused(() => hostRead(join(homedir(), ".cursor", "mcp.json")));
  refused(() => hostRead(join(homedir(), ".kube", "config")));
  refused(() => hostList(join(homedir(), ".kube")));
  refused(() => hostRead(join(homedir(), ".azure", "accessTokens.json")));
  refused(() => hostRead(join(homedir(), ".config", "gcloud", "credentials.json")));
  refused(() => hostRead(join(homedir(), ".config", "gh", "hosts.yml")));
  refused(() => hostRead(join(homedir(), "Library", "Keychains", "login.keychain-db")));
  refused(() => hostTree(join(homedir(), ".cursor")));
  // ~/.config itself is not a secret folder.
  notRefused(() => hostList(join(homedir(), ".config")));
});

test("hostRead refuses private keys but not public ones", () => {
  refused(() => hostRead(join(homedir(), ".ssh", "id_rsa")));
  refused(() => hostRead(join(homedir(), ".ssh", "id_ed25519")));
  refused(() => hostRead("~/.ssh/config"));
  refused(() => hostRead(join(homedir(), ".ssh", "authorized_keys")));
  notRefused(() => hostRead(join(homedir(), ".ssh", "id_rsa.pub")));
  notRefused(() => hostRead(join(homedir(), ".ssh", "id_ed25519.pub")));
  notRefused(() => hostList(join(homedir(), ".ssh")));

  const dir = tempDir();
  const privateCopy = join(dir, "id_rsa");
  writeFileSync(privateCopy, "-----BEGIN OPENSSH PRIVATE KEY-----");
  refused(() => hostRead(privateCopy));
  const pem = join(dir, "server.pem");
  writeFileSync(pem, "secret");
  refused(() => hostRead(pem));
  const pfx = join(dir, "store.pfx");
  writeFileSync(pfx, "secret");
  refused(() => hostRead(pfx));
  for (const suffix of [".key", ".p8", ".jks", ".keystore"]) {
    const secret = join(dir, `bundle${suffix}`);
    writeFileSync(secret, "secret");
    refused(() => hostRead(secret));
  }
  const p8 = join(dir, "AuthKey_abc123.p8");
  writeFileSync(p8, "secret");
  refused(() => hostRead(p8));
  const pub = join(dir, "id_ed25519.pub");
  writeFileSync(pub, "ssh-ed25519 AAAA public");
  assert.equal(hostRead(pub).text, "ssh-ed25519 AAAA public");
  // Listing a folder that merely *contains* a key name is not a content leak.
  assert.ok(hostList(dir).entries.some((entry) => entry.name === "id_ed25519.pub"));
});

test("/host/* still browses the home folder; only secrets are refused", () => {
  const dir = tempDir();
  assert.equal(hostList(dir).path, dir);
  notRefused(() => hostList(homedir()));
  if (existsSync("/etc/passwd")) {
    assert.match(hostRead("/etc/passwd").path, /passwd$/);
  }
});

test("GET /host/read refuses a secret path", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "guild-home-"));
  const { server, origin } = await listenApp(dataDir, {});
  try {
    const secret = encodeURIComponent(join(homedir(), ".guild", "oauth.json"));
    const res = await fetch(`${origin}/host/read?path=${secret}`).then(
      async (r) => ({ status: r.status, body: await r.json() }),
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "host path refused");
    const mcp = await fetch(
      `${origin}/host/read?path=${encodeURIComponent(join(homedir(), ".guild", "mcp.json"))}`,
    ).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal(mcp.status, 403);
    assert.equal(mcp.body.error, "host path refused");
    const ls = await fetch(
      `${origin}/host/ls?path=${encodeURIComponent(join(homedir(), ".guild", "browser-profile"))}`,
    );
    assert.equal(ls.status, 403);
  } finally {
    await closeServer(server);
  }
});

test("hostGit reads this checkout with a guarded git env", async () => {
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const info = await hostGit(join(repo, "packages", "daemon"));
  assert.match(info.text, /repo: /);
  assert.match(info.text, /## /);
  const temp = tempDir();
  await assert.rejects(() => hostGit(temp), /not a git repository/);
  await assert.rejects(
    () => hostGit(join(homedir(), ".ssh", "id_rsa")),
    /host path refused/,
  );
});
