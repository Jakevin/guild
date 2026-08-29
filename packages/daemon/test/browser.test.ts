import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  chromeUserDataDir,
  cleanupRealProfileSnapshots,
  copyAuthFile,
  copyAuthProfile,
  lastUsedProfile,
  profileIsLocked,
  realProfileEnabled,
  SNAPSHOT_DONE_MARKER,
  snapshotDir,
  syncRealProfile,
} from "../src/browser.ts";
import { gateTool } from "../src/harness.ts";
import { executeTool, guildTools } from "../src/tools.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "guild-browser-"));
}

test("realProfileEnabled defaults on; 0/false/off disable it", () => {
  assert.equal(realProfileEnabled({}), true);
  assert.equal(realProfileEnabled({ GUILD_BROWSER_REAL_PROFILE: "" }), true);
  assert.equal(realProfileEnabled({ GUILD_BROWSER_REAL_PROFILE: "1" }), true);
  assert.equal(realProfileEnabled({ GUILD_BROWSER_REAL_PROFILE: "true" }), true);
  assert.equal(realProfileEnabled({ GUILD_BROWSER_REAL_PROFILE: "0" }), false);
  assert.equal(realProfileEnabled({ GUILD_BROWSER_REAL_PROFILE: "false" }), false);
  assert.equal(realProfileEnabled({ GUILD_BROWSER_REAL_PROFILE: "off" }), false);
});

test("docs say browser snapshots Chrome logins by default", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const zh = readFileSync(join(root, "README.zh.md"), "utf8");
  const ja = readFileSync(join(root, "README.ja.md"), "utf8");
  const security = readFileSync(join(root, "SECURITY.md"), "utf8");
  const first = readFileSync(join(root, "docs/first-mention.md"), "utf8");
  const firstZh = readFileSync(join(root, "docs/first-mention.zh.md"), "utf8");
  assert.match(readme, /snapshots your Chrome logins by default/);
  assert.doesNotMatch(readme, /off-login by default/);
  assert.match(zh, /預設帶你的 Chrome 登入/);
  assert.doesNotMatch(zh, /預設沒登入/);
  assert.match(ja, /既定で Chrome のログインをスナップショット/);
  assert.doesNotMatch(ja, /既定で未ログイン/);
  assert.match(security, /Default \(`GUILD_BROWSER_REAL_PROFILE=1`\)/);
  assert.match(first, /snapshots your Chrome logins by default/);
  assert.match(firstZh, /預設帶你的 Chrome 登入/);
});

test("lastUsedProfile reads Local State", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "Profile 1"));
  writeFileSync(
    join(dir, "Local State"),
    JSON.stringify({ profile: { last_used: "Profile 1" } }),
  );
  assert.equal(lastUsedProfile(dir), "Profile 1");
  assert.equal(lastUsedProfile(join(dir, "missing")), "Default");
});

test("lastUsedProfile falls back when named dir is missing", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "Default"));
  writeFileSync(
    join(dir, "Local State"),
    JSON.stringify({ profile: { last_used: "Profile 9" } }),
  );
  assert.equal(lastUsedProfile(dir), "Default");
});

test("copyAuthProfile copies cookies not Cache", () => {
  const src = join(tempDir(), "Default");
  const dest = join(tempDir(), "Default");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "Cookies"), "cookie-bytes");
  writeFileSync(join(src, "Cache"), "huge");
  mkdirSync(join(src, "Network"), { recursive: true });
  writeFileSync(join(src, "Network", "Cookies"), "net-cookies");
  copyAuthProfile(src, dest);
  assert.equal(readFileSync(join(dest, "Cookies"), "utf8"), "cookie-bytes");
  assert.equal(readFileSync(join(dest, "Network", "Cookies"), "utf8"), "net-cookies");
  assert.equal(
    (() => {
      try {
        readFileSync(join(dest, "Cache"), "utf8");
        return "copied-cache";
      } catch {
        return "skipped";
      }
    })(),
    "skipped",
  );
});

test("syncRealProfile snapshots last_used into Default under GUILD_HOME", () => {
  const home = tempDir();
  const dataDir = tempDir();
  const chrome = chromeUserDataDir(home, "darwin");
  mkdirSync(join(chrome, "Profile 1"), { recursive: true });
  writeFileSync(
    join(chrome, "Local State"),
    JSON.stringify({
      os_crypt: { encrypted_key: "keep-me" },
      profile: { last_used: "Profile 1" },
    }),
  );
  writeFileSync(join(chrome, "Profile 1", "Cookies"), "from-live");
  const root = syncRealProfile(dataDir, home, "darwin");
  assert.equal(root, snapshotDir(dataDir));
  assert.equal(
    readFileSync(join(root, "Default", "Cookies"), "utf8"),
    "from-live",
  );
  const state = JSON.parse(readFileSync(join(root, "Local State"), "utf8")) as {
    os_crypt: { encrypted_key: string };
    profile: { last_used: string };
  };
  assert.equal(state.profile.last_used, "Default");
  assert.equal(state.os_crypt.encrypted_key, "keep-me");
  assert.ok(existsSync(join(root, SNAPSHOT_DONE_MARKER)));
  if (process.platform !== "win32") {
    assert.equal(statSync(root).mode & 0o777, 0o700);
    assert.equal(statSync(join(dataDir, "browser-profile")).mode & 0o777, 0o700);
  }
});

test("copyAuthProfile skips Cache, IndexedDB, and sqlite journals", () => {
  const src = join(tempDir(), "Default");
  const dest = join(tempDir(), "Default");
  mkdirSync(src, { recursive: true });
  mkdirSync(join(src, "IndexedDB"), { recursive: true });
  writeFileSync(join(src, "Cookies"), "cookie-bytes");
  writeFileSync(join(src, "Cookies-journal"), "stale-journal");
  writeFileSync(join(src, "IndexedDB", "blob"), "idb");
  copyAuthProfile(src, dest);
  assert.equal(readFileSync(join(dest, "Cookies"), "utf8"), "cookie-bytes");
  assert.equal(existsSync(join(dest, "Cookies-journal")), false);
  assert.equal(existsSync(join(dest, "IndexedDB")), false);
});

test("copyAuthFile VACUUM INTO copies committed sqlite rows", () => {
  const dir = tempDir();
  const src = join(dir, "Cookies");
  const dest = join(dir, "out", "Cookies");
  const db = new DatabaseSync(src);
  db.exec(
    "CREATE TABLE cookies(host_key TEXT, name TEXT); INSERT INTO cookies VALUES ('nous.ai','c1'); INSERT INTO cookies VALUES ('nous.ai','c2');",
  );
  db.close();
  assert.equal(copyAuthFile(src, dest), true);
  const probe = new DatabaseSync(dest, { readOnly: true });
  const row = probe.prepare("select count(*) as n from cookies").get() as {
    n: number;
  };
  probe.close();
  assert.equal(row.n, 2);
  assert.equal(existsSync(`${dest}-journal`), false);
});

test("fresh snapshot copies last_used only; refresh overlays auth", () => {
  const home = tempDir();
  const dataDir = tempDir();
  const chrome = chromeUserDataDir(home, "darwin");
  mkdirSync(join(chrome, "Default"), { recursive: true });
  mkdirSync(join(chrome, "Profile 6", "Network"), { recursive: true });
  mkdirSync(join(chrome, "Profile 3"), { recursive: true });
  mkdirSync(join(chrome, "Profile 6", "Cache"), { recursive: true });
  writeFileSync(
    join(chrome, "Local State"),
    JSON.stringify({ profile: { last_used: "Profile 6" } }),
  );
  writeFileSync(join(chrome, "Default", "Cookies"), "default-signed-out");
  writeFileSync(join(chrome, "Profile 6", "Cookies"), "PROFILE6-SESSION");
  writeFileSync(join(chrome, "Profile 6", "Preferences"), "{}");
  writeFileSync(join(chrome, "Profile 6", "Cache", "big"), "x".repeat(100));
  writeFileSync(join(chrome, "Profile 3", "Cookies"), "PROFILE3-SHOULD-NOT-COPY");
  const root = syncRealProfile(dataDir, home, "darwin");
  assert.equal(readFileSync(join(root, "Default", "Cookies"), "utf8"), "PROFILE6-SESSION");
  assert.equal(existsSync(join(root, "Profile 3")), false);
  assert.equal(existsSync(join(root, "Profile 6")), false);
  assert.equal(existsSync(join(root, "Default", "Cache")), false);
  writeFileSync(join(root, "Default", "History"), "agent-session-history");
  writeFileSync(join(chrome, "Profile 6", "Cookies"), "PROFILE6-REFRESHED");
  syncRealProfile(dataDir, home, "darwin");
  assert.equal(
    readFileSync(join(root, "Default", "Cookies"), "utf8"),
    "PROFILE6-REFRESHED",
  );
  assert.equal(
    readFileSync(join(root, "Default", "History"), "utf8"),
    "agent-session-history",
  );
});

test("torn snapshot without done marker is rebuilt", () => {
  const home = tempDir();
  const dataDir = tempDir();
  const chrome = chromeUserDataDir(home, "darwin");
  mkdirSync(join(chrome, "Profile 6"), { recursive: true });
  writeFileSync(
    join(chrome, "Local State"),
    JSON.stringify({ profile: { last_used: "Profile 6" } }),
  );
  writeFileSync(join(chrome, "Profile 6", "Cookies"), "PROFILE6-SESSION");
  const dest = join(snapshotDir(dataDir), "Default");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "Cookies"), "HALF-COPY-GARBAGE");
  syncRealProfile(dataDir, home, "darwin");
  assert.equal(
    readFileSync(join(snapshotDir(dataDir), "Default", "Cookies"), "utf8"),
    "PROFILE6-SESSION",
  );
});

test("consent-off cleanup deletes the snapshot store", () => {
  const dataDir = tempDir();
  const store = join(dataDir, "browser-profile", "chrome", "Default");
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, "Cookies"), "secret");
  cleanupRealProfileSnapshots(dataDir);
  assert.equal(existsSync(join(dataDir, "browser-profile")), false);
  cleanupRealProfileSnapshots(dataDir);
});

test("profileIsLocked is false when the cookie db is readable", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "Default", "Network"), { recursive: true });
  writeFileSync(join(dir, "Default", "Network", "Cookies"), "db");
  assert.equal(profileIsLocked(dir, "Default"), false);
  assert.equal(profileIsLocked(join(dir, "empty"), "Default"), false);
});

test("read_only refuses browser; full_access lists the tool", async () => {
  const refused = gateTool("browser", { action: "open", url: "https://example.com" }, {
    sandbox: "read_only",
  });
  assert.ok(refused);
  assert.match(refused.text, /read_only/);
  const names = guildTools([], { sandbox: "full_access" }).map((tool) => tool.name);
  assert.ok(names.includes("browser"));
  const blocked = await executeTool(
    "browser",
    { action: "open", url: "https://example.com" },
    { sandbox: "read_only" },
  );
  assert.equal(blocked.isError, true);
});
