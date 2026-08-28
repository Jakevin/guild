import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  callMcpTool,
  callName,
  closeMcpSessions,
  listActiveMcp,
  listGuildMcp,
  listHostMcp,
  listMcpToolRefs,
  removeGuildMcp,
  upsertGuildMcp,
} from "../src/mcp.ts";
import { executeTool } from "../src/tools.ts";

const ECHO = fileURLToPath(new URL("./fixtures/echo-mcp.mjs", import.meta.url));

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "guild-mcp-"));
}

test("MCP lives in mcp.json not the skills library", () => {
  const dir = tempDir();
  const saved = upsertGuildMcp(dir, "echo", {
    command: process.execPath,
    args: [ECHO],
  });
  assert.equal(saved.source, "user");
  assert.equal(saved.name, "echo");
  assert.equal(listGuildMcp(dir).length, 1);
  const skillsDir = join(dir, "library", "skills");
  assert.equal(listGuildMcp(dir)[0].id.startsWith("guild:"), true);
  assert.doesNotMatch(saved.id, /skills/);
  void skillsDir;
});

test("stdio MCP lists tools and echoes", async () => {
  const dir = tempDir();
  upsertGuildMcp(dir, "echo", {
    command: process.execPath,
    args: [ECHO],
  });
  const refs = await listMcpToolRefs(dir, tempDir());
  assert.equal(refs.length, 1);
  assert.equal(refs[0].callName, callName("echo", "echo"));
  const result = await callMcpTool(dir, refs[0].callName, { text: "hello-mcp" }, refs);
  assert.equal(result.isError, false);
  assert.match(result.text, /hello-mcp/);
  const viaTools = await executeTool(
    refs[0].callName,
    { text: "via-tool" },
    { dataDir: dir, mcpTools: refs },
  );
  assert.equal(viaTools.isError, false);
  assert.match(viaTools.text, /via-tool/);
  removeGuildMcp(dir, "echo");
  assert.equal(listGuildMcp(dir).length, 0);
  closeMcpSessions();
});

test("host Codex TOML mcp_servers can be imported", () => {
  const home = tempDir();
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    join(home, ".codex", "config.toml"),
    `[mcp_servers.docs]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
`,
  );
  const host = listHostMcp(home);
  const docs = host.find((item) => item.name === "docs" && item.host === "Codex");
  assert.ok(docs);
  const dir = tempDir();
  const imported = upsertGuildMcp(dir, docs.name, docs.launch);
  assert.equal(imported.name, "docs");
  assert.equal(imported.launch.command, "npx");
  assert.ok(imported.launch.args.includes("@upstash/context7-mcp"));
});

test("docs say host MCP is live without importing", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const zh = readFileSync(join(root, "README.zh.md"), "utf8");
  const ja = readFileSync(join(root, "README.ja.md"), "utf8");
  const security = readFileSync(join(root, "SECURITY.md"), "utf8");
  assert.match(readme, /No import step/);
  assert.doesNotMatch(readme, /until you import/);
  assert.match(zh, /免匯入、直接 spawn/);
  assert.doesNotMatch(zh, /匯入 Guild 之後/);
  assert.match(ja, /import なしで spawn/);
  assert.doesNotMatch(ja, /Guild に import してから/);
  assert.match(security, /Host MCP is live without importing/);
  assert.match(security, /No import \/ consent prompt/);
});

test("host stdio MCP is used in chat without importing", async () => {
  const home = tempDir();
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    join(home, ".codex", "config.toml"),
    `[mcp_servers.echo]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(ECHO)}]
`,
  );
  const dir = tempDir();
  assert.equal(listGuildMcp(dir).length, 0);
  const active = listActiveMcp(dir, home);
  const echo = active.find((item) => item.name === "echo" && item.source === "host");
  assert.ok(echo);
  assert.equal(echo.enabled, true);
  const refs = await listMcpToolRefs(dir, home);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].callName, callName("echo", "echo"));
  const result = await callMcpTool(
    dir,
    refs[0].callName,
    { text: "host-direct" },
    refs,
    home,
  );
  assert.equal(result.isError, false);
  assert.match(result.text, /host-direct/);
  closeMcpSessions();
});
