import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseAgentFile } from "../src/agent-file.ts";
import { listHostAgents } from "../src/host-agents.ts";
import { mergeSpawnRefs, resolveSubagent } from "../src/subagent.ts";
import { createGuildServer, listenGuildServer } from "../src/server.ts";
import { GuildStore } from "../src/store.ts";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("parseAgentFile reads Codex TOML including triple-quoted instructions", () => {
  const parsed = parseAgentFile(
    `name = "explorer"
description = "Codebase search specialist"
nickname_candidates = ["Explorer"]
model = "gpt-5.6-luna"
model_reasoning_effort = "low"
sandbox_mode = "read-only"

developer_instructions = """
Role: codebase search specialist.
Find files.
"""
`,
    "fallback",
  );
  assert.equal(parsed.name, "explorer");
  assert.match(parsed.description, /Codebase search/);
  assert.match(parsed.instructions, /Role: codebase search/);
  assert.equal(parsed.model, "gpt-5.6-luna");
  assert.equal(parsed.reasoning, "low");
  assert.equal(parsed.readOnly, true);
});

test("parseAgentFile reads Grok markdown frontmatter", () => {
  const parsed = parseAgentFile(
    `---
name: plan
description: >
  Planning agent.
permission_mode: plan
---

You produce a plan. Do not edit files.
`,
    "plan",
  );
  assert.equal(parsed.name, "plan");
  assert.match(parsed.description, /Planning agent/);
  assert.match(parsed.instructions, /Do not edit files/);
  assert.equal(parsed.readOnly, true);
});

test("listHostAgents reads Codex TOML and Grok markdown, skips empty roles", () => {
  const home = tempDir("guild-host-agents-home-");
  const cwd = tempDir("guild-host-agents-cwd-");
  mkdirSync(join(home, ".codex/agents"), { recursive: true });
  writeFileSync(
    join(home, ".codex/agents/explorer.toml"),
    `name = "explorer"
description = "Search"
sandbox_mode = "read-only"
developer_instructions = """
Find files.
"""
`,
  );
  mkdirSync(join(home, ".grok/bundled/agents"), { recursive: true });
  writeFileSync(
    join(home, ".grok/bundled/agents/explore.md"),
    `---
name: explore
description: Fast explorer
permission_mode: plan
---

Read-only search.
`,
  );
  mkdirSync(join(home, ".grok/bundled/roles"), { recursive: true });
  writeFileSync(
    join(home, ".grok/bundled/roles/explore.toml"),
    `description = "role only"
default_capability_mode = "read-only"
`,
  );
  mkdirSync(join(cwd, ".codex/agents"), { recursive: true });
  writeFileSync(
    join(cwd, ".codex/agents/reviewer.toml"),
    `name = "reviewer"
description = "Review"
developer_instructions = """
Review the diff.
"""
`,
  );

  const listed = listHostAgents({ home, cwd });
  const slugs = listed.map((item) => item.slug).sort();
  assert.deepEqual(slugs, ["explore", "explorer", "reviewer"]);
  assert.ok(!listed.some((item) => item.path.includes("roles")));
  const explorer = listed.find((item) => item.slug === "explorer");
  assert.equal(explorer?.host, "codex");
  assert.equal(explorer?.readOnly, true);
  assert.match(explorer?.instructions || "", /Find files/);
  const explore = listed.find((item) => item.slug === "explore");
  assert.equal(explore?.host, "grok");
});

test("mergeSpawnRefs prefers Guild user, then host, then catalog", () => {
  const merged = mergeSpawnRefs(
    [
      {
        name: "Explorer",
        slug: "explorer",
        instructions: "catalog",
        readOnly: true,
        source: "catalog",
      },
      {
        name: "Custom",
        slug: "custom",
        instructions: "user",
        readOnly: false,
        source: "user",
      },
    ],
    [
      {
        name: "explorer",
        slug: "explorer",
        instructions: "host-codex",
        readOnly: true,
        source: "host",
      },
    ],
  );
  assert.equal(merged.find((item) => item.slug === "explorer")?.instructions, "host-codex");
  assert.equal(merged.find((item) => item.slug === "custom")?.instructions, "user");
});

test("resolveSubagent falls back to worker", () => {
  const hit = resolveSubagent("no-such", []);
  assert.equal(hit.slug, "worker");
  assert.match(hit.instructions, /No matching library entry/);
});

test("GET /library/subagents includes catalog and custom TOML", async () => {
  const dataDir = tempDir("guild-subagents-data-");
  const store = new GuildStore(dataDir);
  const created = store.createLibrary("subagents", {
    name: "qa-runner",
    body: `name = "qa-runner"
description = "Run tests"
developer_instructions = """
Run the test suite.
"""
`,
  });
  assert.equal(created.slug, "qa-runner");
  const server = createGuildServer({ dataDir });
  const listening = await listenGuildServer(server, "127.0.0.1", 0);
  const origin = `http://127.0.0.1:${listening.port}`;
  try {
    const listed = await fetch(`${origin}/library/subagents`);
    assert.equal(listed.status, 200);
    const body = (await listed.json()) as { slug: string }[];
    const slugs = body.map((item) => item.slug);
    assert.ok(slugs.includes("explorer"));
    assert.ok(slugs.includes("worker"));
    assert.ok(slugs.includes("reviewer"));
    assert.ok(slugs.includes("qa-runner"));
    const page = await fetch(`${origin}/subagents`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /子代理庫/);
    const add = await fetch(`${origin}/subagents/add`);
    assert.equal(add.status, 200);
    const host = await fetch(`${origin}/library/subagents/host`);
    assert.equal(host.status, 200);
    assert.ok(Array.isArray(await host.json()));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
