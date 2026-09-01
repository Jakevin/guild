import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  defaultWorkspace,
  gateTool,
  parseSandbox,
  pathInsideWorkspace,
  policyFor,
  policyFromEnv,
  runAgentLoop,
  sandboxFromPosition,
} from "../src/harness.ts";
import { executeTool, guildTools } from "../src/tools.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "guild-harness-"));
}

test("parseSandbox defaults to full_access", () => {
  assert.equal(parseSandbox(undefined), "full_access");
  assert.equal(parseSandbox("nope"), "full_access");
  assert.equal(parseSandbox("read_only"), "read_only");
  assert.equal(policyFromEnv({}).sandbox, "full_access");
  assert.equal(policyFromEnv({ GUILD_SANDBOX: "workspace_write" }).sandbox, "workspace_write");
});

test("sandboxFromPosition reads the Tools line", () => {
  assert.equal(
    sandboxFromPosition("# RD\n\n## Tools\nsandbox: workspace_write\n"),
    "workspace_write",
  );
  assert.equal(sandboxFromPosition("# PM\n\n- sandbox: read_only\n"), "read_only");
  assert.equal(sandboxFromPosition("# no line"), undefined);
});

test("policyFor: env wins over position; position wins over default", () => {
  const position = "## Tools\nsandbox: workspace_write\n";
  assert.equal(policyFor({}, { position }).sandbox, "workspace_write");
  assert.equal(
    policyFor({ GUILD_SANDBOX: "read_only" }, { position }).sandbox,
    "read_only",
  );
  assert.equal(
    policyFor({ GUILD_SANDBOX: "full_access" }, { position }).sandbox,
    "full_access",
  );
  assert.equal(policyFor({}).workspace, defaultWorkspace());
  assert.equal(
    existsSync(join(defaultWorkspace(), "packages/daemon/cordis.yml")),
    true,
  );
});

test("read_only refuses run/write/mcp and allows read", async () => {
  const dir = tempDir();
  const path = join(dir, "note.txt");
  writeFileSync(path, "hello");
  const ctx = { sandbox: "read_only" as const, workspace: dir };
  const wrote = await executeTool("write", { path, content: "x" }, ctx);
  assert.equal(wrote.isError, true);
  assert.match(wrote.text, /read_only/);
  const ran = await executeTool("run", { command: "echo hi" }, ctx);
  assert.equal(ran.isError, true);
  assert.match(ran.text, /read_only/);
  const mcp = await executeTool("mcp__echo__ping", {}, ctx);
  assert.equal(mcp.isError, true);
  const read = await executeTool("read", { path }, ctx);
  assert.equal(read.isError, false);
  assert.equal(read.text, "hello");
  const names = guildTools([], ctx).map((tool) => tool.name);
  assert.deepEqual(
    names.sort(),
    ["list", "read", "read_spawn", "skill", "spawn"].sort(),
  );
  assert.equal(gateTool("spawn", { prompt: "survey the tree" }, ctx), null);
  assert.equal(gateTool("read_spawn", { agent_id: "x" }, ctx), null);
});

test("runAgentLoop runs a round's tools in parallel", async () => {
  const started: number[] = [];
  const result = await runAgentLoop({
    toolCtx: {
      dispatch: async (name) => {
        started.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { text: `did:${name}`, isError: false };
      },
    },
    ask: async ({ round }) => {
      if (round === 0) {
        return {
          calls: [
            { id: "1", name: "read", args: { path: "a" } },
            { id: "2", name: "list", args: { path: "b" } },
          ],
          text: "",
        };
      }
      return { calls: [], text: "ok" };
    },
  });
  assert.equal(result?.text, "ok");
  assert.equal(result?.traces.length, 2);
  assert.ok(started.length === 2);
  assert.ok(Math.abs(started[1] - started[0]) < 50);
});

test("workspace_write allows write inside and refuses outside", async () => {
  const workspace = tempDir();
  const inside = join(workspace, "ok.txt");
  const outside = join(tempDir(), "nope.txt");
  const ctx = { sandbox: "workspace_write" as const, workspace };
  const ok = await executeTool("write", { path: inside, content: "in" }, ctx);
  assert.equal(ok.isError, false);
  assert.equal(readFileSync(inside, "utf8"), "in");
  const bad = await executeTool("write", { path: outside, content: "out" }, ctx);
  assert.equal(bad.isError, true);
  assert.match(bad.text, /outside workspace/);
  assert.equal(pathInsideWorkspace(inside, workspace), true);
  assert.equal(pathInsideWorkspace(outside, workspace), false);
});

test("workspace_write refuses run cwd outside the workspace", async () => {
  const workspace = tempDir();
  const outside = tempDir();
  const ctx = { sandbox: "workspace_write" as const, workspace };
  const bad = await executeTool("run", { command: "pwd", workdir: outside }, ctx);
  assert.equal(bad.isError, true);
  assert.match(bad.text, /outside workspace/);
  const ok = await executeTool("run", { command: "pwd" }, ctx);
  assert.equal(ok.isError, false);
  assert.match(ok.text, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("workspace_write refuses mcp", async () => {
  const refused = gateTool("mcp__echo__ping", {}, {
    sandbox: "workspace_write",
    workspace: tempDir(),
  });
  assert.ok(refused);
  assert.match(refused.text, /mcp/);
});

test("full_access is unchanged", async () => {
  const result = await executeTool("run", { command: "echo guild-harness" });
  assert.equal(result.isError, false);
  assert.match(result.text, /guild-harness/);
});

test("runAgentLoop asks the model then executes tools", async () => {
  let round = 0;
  const applied: string[] = [];
  const result = await runAgentLoop({
    toolCtx: {
      dispatch: async (name) => ({ text: `did:${name}`, isError: false }),
    },
    ask: async () => {
      round += 1;
      if (round === 1) {
        return { calls: [{ id: "1", name: "run", args: { command: "true" } }], text: "" };
      }
      return { calls: [], text: "final" };
    },
    onTools: (_calls, outcomes) => {
      applied.push(outcomes[0]?.text ?? "");
    },
  });
  assert.equal(result?.text, "final");
  assert.equal(result?.traces[0]?.name, "run");
  assert.deepEqual(applied, ["did:run"]);
  assert.equal(round, 2);
});

test("executeTool dispatch uses the tools table, not a local switch", async () => {
  const names: string[] = [];
  const result = await executeTool("run", { command: "echo skip-me" }, {
    dispatch: async (name) => {
      names.push(name);
      return { text: `via-table:${name}`, isError: false };
    },
  });
  assert.deepEqual(names, ["run"]);
  assert.equal(result.text, "via-table:run");
});
