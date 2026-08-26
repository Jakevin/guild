import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildChatSystem } from "../src/generate.ts";
import { IMAGE_GEN_TIMEOUT_MS, isSafeGeneratedName } from "../src/image-gen.ts";
import {
  executeTool,
  formatToolTranscript,
  hostContext,
  LLM_ROUND_TIMEOUT_MS,
  MAX_TOOL_ROUNDS,
  nextToolRound,
  takeSteers,
  TOOL_LOOP_EXHAUSTED,
  TOOL_SYSTEM,
} from "../src/tools.ts";
import { assembleParts, bodyFromParts } from "../src/chat-parts.ts";

test("run executes on this machine", async () => {
  const result = await executeTool("run", { command: "echo guild-local" });
  assert.equal(result.isError, false);
  assert.match(result.text, /guild-local/);
  assert.match(result.text, /\[exit code: 0\]/);
});

test("run nonzero exit is a result, not a tool crash", async () => {
  const result = await executeTool("run", { command: "false" });
  assert.equal(result.isError, false);
  assert.match(result.text, /\[exit code: 1\]/);
});

test("run honors workdir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-run-cwd-"));
  const result = await executeTool("run", { command: "pwd", workdir: dir });
  assert.equal(result.isError, false);
  assert.match(result.text, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("read write list round-trip a temp file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-tools-"));
  const path = join(dir, "note.txt");
  const wrote = await executeTool("write", { path, content: "hello guild" });
  assert.equal(wrote.isError, false);
  assert.match(wrote.text, /wrote /);
  assert.equal(readFileSync(path, "utf8"), "hello guild");
  const read = await executeTool("read", { path });
  assert.equal(read.isError, false);
  assert.equal(read.text, "hello guild");
  const listed = await executeTool("list", { path: dir });
  assert.equal(listed.isError, false);
  assert.match(listed.text, /note\.txt/);
});

test("run refuses rm -rf /", async () => {
  const result = await executeTool("run", { command: "rm -rf /" });
  assert.equal(result.isError, true);
  assert.match(result.text, /refused/);
});

test("run refuses mkfs", async () => {
  const result = await executeTool("run", { command: "mkfs.ext4 /dev/sda" });
  assert.equal(result.isError, true);
  assert.match(result.text, /refused/);
});

test("takeSteers wraps mid-turn user text once", () => {
  const bag = ["  keep going  ", ""];
  const first = takeSteers({
    pullSteers: () => {
      const next = bag.splice(0);
      return next;
    },
  });
  assert.match(first || "", /<user_steer>/);
  assert.match(first || "", /keep going/);
  assert.match(first || "", /already working/);
  assert.equal(takeSteers({ pullSteers: () => [] }), null);
});

test("tool prompt claims local access", () => {
  assert.match(TOOL_SYSTEM, /local computer/i);
  assert.match(TOOL_SYSTEM, /Never say you cannot access/);
  assert.match(TOOL_SYSTEM, /exit code/);
  assert.match(TOOL_SYSTEM, /image_gen/);
  assert.match(TOOL_SYSTEM, /spawn/);
  assert.match(hostContext(), /home=/);
});

test("image_gen without credentials fails fast", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-nogen-"));
  const started = Date.now();
  const result = await executeTool(
    "image_gen",
    { prompt: "a red circle" },
    { dataDir: dir, env: {} },
  );
  assert.equal(result.isError, true);
  assert.match(result.text, /沒有可用的生圖模型/);
  assert.ok(Date.now() - started < 2_000);
});

test("image_gen requires a prompt", async () => {
  const result = await executeTool("image_gen", { prompt: "" });
  assert.equal(result.isError, true);
  assert.match(result.text, /empty argument/);
});

test("generated file names reject traversal", () => {
  assert.equal(isSafeGeneratedName("abc.jpg"), true);
  assert.equal(isSafeGeneratedName("../oauth.json"), false);
  assert.equal(isSafeGeneratedName("a/b.jpg"), false);
});

test("timeouts match Codex stream idle 300s", () => {
  assert.equal(IMAGE_GEN_TIMEOUT_MS, 300_000);
  assert.equal(LLM_ROUND_TIMEOUT_MS, 300_000);
});

test("skill tool loads staffed instructions", async () => {
  const miss = await executeTool("skill", { name: "debugger" });
  assert.equal(miss.isError, true);
  const hit = await executeTool(
    "skill",
    { name: "debugger" },
    { skills: [{ name: "debugger", slug: "debugger", body: "# Debugger\nLook at logs." }] },
  );
  assert.equal(hit.isError, false);
  assert.match(hit.text, /Look at logs/);
  assert.match(hit.text, /<skill_content name="debugger">/);
  assert.match(hit.text, /<skill_instructions>/);
  const slash = await executeTool(
    "skill",
    { name: "/debugger" },
    { skills: [{ name: "debugger", slug: "debugger", body: "# Debugger\nLook at logs." }] },
  );
  assert.equal(slash.isError, false);
  assert.match(slash.text, /Look at logs/);
});

test("chat system lists staffed skills as a DSH-style catalog", () => {
  const system = buildChatSystem({
    botName: "RD",
    handle: "rd",
    soul: "# Soul",
    agent: "# Agent",
    position: "# Position",
    skills: [
      {
        name: "Graphify",
        slug: "graphify",
        body: "SECRET_BODY",
        description: "Turn a codebase into a graph.",
      },
    ],
  });
  assert.match(system, /<available_skills>/);
  assert.match(system, /`graphify`: Turn a codebase into a graph\./);
  assert.doesNotMatch(system, /SECRET_BODY/);
});

test("chat system lists spawnable subagents", () => {
  const system = buildChatSystem({
    botName: "RD",
    handle: "rd",
    soul: "# Soul",
    agent: "# Agent",
    position: "# Position",
    subagents: [
      {
        name: "Explorer",
        slug: "explorer",
        description: "Search the tree",
        instructions: "SECRET_INSTRUCTIONS",
        readOnly: true,
      },
    ],
  });
  assert.match(system, /<available_subagents>/);
  assert.match(system, /`explorer` \(read-only\): Search the tree/);
  assert.doesNotMatch(system, /SECRET_INSTRUCTIONS/);
  assert.match(system, /spawn/);
});

test("spawn without dataDir fails fast", async () => {
  const result = await executeTool("spawn", { prompt: "find auth" });
  assert.equal(result.isError, true);
  assert.match(result.text, /dataDir/);
});

test("spawn depth 1 is rejected", async () => {
  const result = await executeTool(
    "spawn",
    { prompt: "find auth" },
    { dataDir: mkdtempSync(join(tmpdir(), "guild-spawn-")), spawnDepth: 1 },
  );
  assert.equal(result.isError, true);
  assert.match(result.text, /depth 1/);
});

test("read-only subagent cannot write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-ro-"));
  const result = await executeTool(
    "write",
    { path: join(dir, "x.txt"), content: "nope" },
    { allowWrite: false },
  );
  assert.equal(result.isError, true);
  assert.match(result.text, /read-only/);
});

test("skill lookup does not leak another bot's catalog", async () => {
  const leaked = await executeTool(
    "skill",
    { name: "debugger" },
    {
      skills: [
        { name: "planner", slug: "planner", body: "SECRET_OTHER_BOT_SKILL" },
      ],
    },
  );
  assert.equal(leaked.isError, true);
  assert.doesNotMatch(leaked.text, /SECRET_OTHER_BOT_SKILL/);
  assert.match(leaked.text, /unknown skill/);
});

test("assembleParts orders Think, tools, Skill, text", () => {
  const parts = assembleParts({
    thinking: "I should inspect RAM.",
    traces: [
      {
        name: "skill",
        args: { name: "debugger" },
        text: "use logs",
        isError: false,
      },
      {
        name: "run",
        args: { command: "sysctl hw.memsize" },
        text: "hw.memsize: 1",
        isError: false,
      },
    ],
    text: "32 GB.",
  });
  assert.equal(parts[0]?.type, "thinking");
  assert.equal(parts[1]?.type, "skill");
  assert.equal(parts[2]?.type, "tool");
  assert.equal(parts[3]?.type, "text");
  assert.equal(bodyFromParts(parts), "32 GB.");
});

test("assembleParts strips leaked skill XML from the visible reply", () => {
  const parts = assembleParts({
    traces: [
      {
        name: "skill",
        args: { name: "graphify" },
        text: '<skill_content name="graphify">\n<skill_instructions>\nDo graphs.\n</skill_instructions>\n</skill_content>',
        isError: false,
      },
    ],
    text: '<skill_content name="graphify">secret dump</skill_content>\n\n圖建好了。',
  });
  const text = parts.find((part) => part.type === "text");
  assert.equal(text && "text" in text ? text.text : "", "圖建好了。");
  assert.equal(bodyFromParts(parts), "圖建好了。");
});

test("formatToolTranscript prefixes 本機", () => {
  const text = formatToolTranscript([
    {
      name: "run",
      args: { command: "sysctl hw.memsize" },
      text: "hw.memsize: 1",
      isError: false,
    },
  ]);
  assert.match(text, /^本機\n/);
  assert.match(text, /\$ sysctl hw.memsize/);
  assert.match(text, /hw\.memsize: 1/);
});

test("tool loop follows Codex: no 8-round budget, fuse is last-resort", () => {
  assert.ok(MAX_TOOL_ROUNDS > 8);
  assert.equal(nextToolRound(0), "continue");
  assert.equal(nextToolRound(8), "continue");
  assert.equal(nextToolRound(MAX_TOOL_ROUNDS - 2), "continue");
  assert.equal(nextToolRound(MAX_TOOL_ROUNDS - 1), "wrap");
  assert.equal(nextToolRound(MAX_TOOL_ROUNDS), "stop");
  assert.match(TOOL_LOOP_EXHAUSTED, /再送一次/);
  const oauth = readFileSync(new URL("../src/oauth.ts", import.meta.url), "utf8");
  const llm = readFileSync(new URL("../src/llm.ts", import.meta.url), "utf8");
  assert.doesNotMatch(oauth, /too many tool rounds/);
  assert.doesNotMatch(oauth, /round < 8/);
  assert.doesNotMatch(llm, /round < 8/);
  assert.doesNotMatch(llm, /工具回合用完了/);
  assert.match(oauth, /nextToolRound/);
  assert.match(llm, /nextToolRound/);
});
