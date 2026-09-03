import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SECURITY = join(ROOT, "SECURITY.md");

test("SECURITY.md states restart, /host scope, and workspace_write is not a jail", () => {
  const md = readFileSync(SECURITY, "utf8");
  assert.match(md, /No hot reload/);
  assert.match(md, /no HMR/i);
  assert.match(md, /\/host\/\*/);
  assert.match(md, /not a chroot/);
  assert.match(md, /mcp\.json/);
  assert.match(md, /cross-origin refused/);
  assert.match(md, /workspace_write` is a Guild tool gate, not a shell jail/);
  assert.match(md, /plus `\/tmp` and `\{GUILD_HOME\}\/cache`/);
  assert.match(md, /execFile\(\$SHELL, \["-lc", command\]\)/);
  assert.match(md, /Seatbelt/);
  assert.match(md, /launch\.env/);
});
