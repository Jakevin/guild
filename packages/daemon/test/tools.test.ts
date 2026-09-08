import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildChatSystem, HALL_RULES, WHISPER_RULES, localGenerate } from "../src/generate.ts";
import {
  childSpawnPolicy,
  readSpawn,
  runSpawnJobs,
  spawnJobs,
  spawnProfile,
} from "../src/subagent.ts";
import { IMAGE_GEN_TIMEOUT_MS, isSafeGeneratedName } from "../src/image-gen.ts";
import { AUX_ROLES, resolveLlm, writeModelsFile } from "../src/llm.ts";
import {
  builtinExecute,
  executeTool,
  formatToolTranscript,
  hostContext,
  MAX_TOOL_ROUNDS,
  SPAWN_TOOL_ROUNDS,
  nextToolRound,
  openaiTools,
  parseToolArgs,
  roundSignal,
  takeSteers,
  TOOL_LOOP_EXHAUSTED,
  TOOL_LOOP_STALL,
  TOOL_LOOP_WRAP,
  TOOL_SYSTEM,
  truncatedToolArgs,
  type ToolContext,
} from "../src/tools.ts";
import { assembleParts, bodyFromParts } from "../src/chat-parts.ts";

const OPEN = { sandbox: "full_access" as const };

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
  const result = await executeTool("run", { command: "pwd", workdir: dir }, OPEN);
  assert.equal(result.isError, false);
  assert.match(result.text, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("run has no default wall-clock; timeout is optional seconds (Pi bash)", async () => {
  const tools = openaiTools();
  const run = tools.find((tool) => tool.function.name === "run");
  assert.ok(run);
  const props = (run.function.parameters as { properties?: Record<string, unknown> })
    .properties;
  assert.ok(props?.timeout);
  assert.match(JSON.stringify(props.timeout), /no default timeout/);
  const timed = await executeTool("run", { command: "sleep 2", timeout: 0.2 });
  assert.equal(timed.isError, true);
  assert.match(timed.text, /timed out after 200ms/);
  const ac = new AbortController();
  const pending = executeTool(
    "run",
    { command: "sleep 5" },
    { signal: ac.signal },
  );
  ac.abort();
  await assert.rejects(pending, (err: unknown) => {
    return Boolean(err && typeof err === "object" && "name" in err && err.name === "AbortError");
  });
});

test("read write list round-trip a temp file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-tools-"));
  const path = join(dir, "note.txt");
  const wrote = await executeTool("write", { path, content: "hello guild" }, OPEN);
  assert.equal(wrote.isError, false);
  assert.match(wrote.text, /wrote /);
  assert.equal(readFileSync(path, "utf8"), "hello guild");
  const read = await executeTool("read", { path }, OPEN);
  assert.equal(read.isError, false);
  assert.equal(read.text, "hello guild");
  const listed = await executeTool("list", { path: dir }, OPEN);
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
  assert.match(TOOL_SYSTEM, /\bcomputer\b/);
  assert.match(TOOL_SYSTEM, /axset/);
  assert.match(TOOL_SYSTEM, /Never say you cannot access/);
  assert.match(TOOL_SYSTEM, /exit code/);
  assert.match(TOOL_SYSTEM, /image_gen/);
  assert.match(TOOL_SYSTEM, /\btts\b/);
  assert.match(TOOL_SYSTEM, /spawn/);
  assert.match(TOOL_SYSTEM, /read_only seat can still spawn/);
  assert.match(TOOL_SYSTEM, /run in parallel/i);
  assert.match(TOOL_SYSTEM, /read_spawn/);
  assert.match(TOOL_SYSTEM, /cronjob/);
  assert.match(TOOL_SYSTEM, /每10分鐘/);
  assert.match(hostContext(), /home=/);
  const cron = openaiTools().find((tool) => tool.function.name === "cronjob");
  assert.ok(cron);
  const props = (cron.function.parameters as { properties?: Record<string, unknown> })
    .properties;
  assert.ok(props?.scope);
  assert.ok(props?.delivery);
});

test("SubAgent aux role is on the models page and resolveLlm uses it", () => {
  assert.ok(AUX_ROLES.some((role) => role.id === "spawn" && role.name === "SubAgent"));
  const dir = mkdtempSync(join(tmpdir(), "guild-spawn-model-"));
  const env = { XAI_API_KEY: "xai-test" };
  const providers = {
    xai: {
      name: "xAI",
      baseUrl: "https://api.x.ai/v1" as const,
      api: "openai-completions" as const,
      apiKey: "xai-test",
      models: [{ id: "grok-4.6" }, { id: "grok-4.5" }],
    },
  };
  writeModelsFile(dir, {
    default: { provider: "xai", model: "grok-4.6" },
    aux: {},
    providers,
  });
  assert.equal(resolveLlm(dir, env, "spawn")?.model, "grok-4.6");
  writeModelsFile(dir, {
    default: { provider: "xai", model: "grok-4.6" },
    aux: { spawn: { provider: "xai", model: "grok-4.5" } },
    providers,
  });
  assert.equal(resolveLlm(dir, env, "chat")?.model, "grok-4.6");
  assert.equal(resolveLlm(dir, env, "spawn")?.model, "grok-4.5");
  assert.equal(resolveLlm(dir, env, "generate")?.model, "grok-4.6");
  assert.equal(resolveLlm(dir, env, "compression")?.model, "grok-4.6");
});

test("image_gen without credentials fails fast", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-nogen-"));
  const started = Date.now();
  const result = await executeTool(
    "image_gen",
    { prompt: "a red circle" },
    { ...OPEN, dataDir: dir, env: {} },
  );
  assert.equal(result.isError, true);
  assert.match(result.text, /沒有可用的生圖模型/);
  assert.ok(Date.now() - started < 2_000);
});

test("image_gen requires a prompt", async () => {
  const result = await executeTool("image_gen", { prompt: "" }, OPEN);
  assert.equal(result.isError, true);
  assert.match(result.text, /empty argument/);
});

test("generated file names reject traversal", () => {
  assert.equal(isSafeGeneratedName("abc.jpg"), true);
  assert.equal(isSafeGeneratedName("../oauth.json"), false);
  assert.equal(isSafeGeneratedName("a/b.jpg"), false);
});

test("image_gen timeout is separate from the LLM round", () => {
  assert.equal(IMAGE_GEN_TIMEOUT_MS, 300_000);
  const oauth = readFileSync(new URL("../src/oauth.ts", import.meta.url), "utf8");
  assert.match(oauth, /STREAM_IDLE_TIMEOUT_MS = 300_000/);
  assert.match(oauth, /not a turn wall clock/);
  assert.doesNotMatch(oauth, /LLM_ROUND_TIMEOUT_MS/);
});

test("roundSignal is user Stop only", () => {
  const controller = new AbortController();
  assert.equal(roundSignal({}), undefined);
  assert.equal(roundSignal({ signal: controller.signal }), controller.signal);
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
  assert.match(system, /invoked with \/name/);
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
  assert.match(system, /\/name matching a subagent/);
  assert.match(system, /Skipping spawn and reading the whole tree yourself is the wrong default/);
});

test("chat system owns a seat and hands off with a spec", () => {
  const system = buildChatSystem({
    botName: "RD",
    handle: "rd",
    soul: "# Soul",
    agent: "# Agent",
    position: "# Position",
  });
  assert.match(system, /# Hall/);
  assert.match(system, /written spec/);
  assert.match(system, /start of a line/);
  assert.match(system, /Stay quiet/);
  assert.match(system, /short recap before more tools/);
  assert.match(system, /End with what changed/);
  assert.match(system, /Do not @all/);
  assert.match(system, /even if the human only named you this turn/);
  assert.match(system, /latest human message is the live task/);
  assert.match(system, /Channel.md is room procedure/);
  assert.match(system, /dated standing notes, not the live task/);
  assert.match(system, /catalog is availability/);
  assert.match(system, /<available_subagents>/);
  assert.match(system, /`explorer`/);
  assert.match(HALL_RULES, /Spawn first when/);
  assert.match(HALL_RULES, /Do not skip spawn/);
  assert.match(HALL_RULES, /do not start this turn/);
  assert.match(HALL_RULES, /派工 list/);
  assert.match(HALL_RULES, /1:1 交辦/);
  assert.match(HALL_RULES, /Do not wait for the human to press a button/);
  assert.match(HALL_RULES, /that is the authorization/);
  assert.match(HALL_RULES, /Do not invent a second wait/);
  assert.match(HALL_RULES, /do the live task this turn/);
  assert.match(HALL_RULES, /on this quest's roster/);
});

test("hall system lists this quest's roster and forbids off-roster @handle", () => {
  const system = buildChatSystem({
    botName: "Infra",
    handle: "infra",
    soul: "# Soul",
    agent: "# Agent",
    position: "# Position",
    rosterHandles: ["pm", "infra", "design", "marketing"],
  });
  assert.match(system, /This quest's roster: @pm @infra @design @marketing/);
  assert.match(system, /Only these seats may be @handle'd/);
  assert.doesNotMatch(system, /@rd\b/);
  const whisper = buildChatSystem({
    botName: "Infra",
    handle: "infra",
    soul: "# Soul",
    agent: "# Agent",
    position: "# Position",
    rosterHandles: ["pm", "infra"],
    whisper: true,
  });
  assert.doesNotMatch(whisper, /This quest's roster/);
});

test("whisper system does not hand off to other seats", () => {
  const system = buildChatSystem({
    botName: "PM",
    handle: "pm",
    soul: "# Soul",
    agent: "# Agent",
    position: "# Position",
    whisper: true,
  });
  assert.match(system, /# Whisper/);
  assert.match(system, /Only you speak here/);
  assert.match(system, /Do not @handle other bots/);
  assert.doesNotMatch(system, /# Hall/);
  assert.doesNotMatch(system, /even if the human only named you this turn/);
  assert.match(WHISPER_RULES, /1:1 whisper/);
  assert.match(WHISPER_RULES, /latest human message is the live task/);
  assert.match(WHISPER_RULES, /that is the authorization/);
});

test("child spawn cannot escalate a read_only parent", () => {
  assert.deepEqual(childSpawnPolicy("read_only", false), {
    sandbox: "read_only",
    allowWrite: false,
  });
  assert.deepEqual(childSpawnPolicy("full_access", true), {
    sandbox: "read_only",
    allowWrite: false,
  });
  assert.deepEqual(childSpawnPolicy("full_access", false), {
    sandbox: "full_access",
    allowWrite: true,
  });
});

test("local agent markdown has Memory Plan Act Skills harness sections", () => {
  const md = localGenerate("agent", "先寫測試");
  assert.match(md.body, /## Memory/);
  assert.match(md.body, /## Plan/);
  assert.match(md.body, /## Act/);
  assert.match(md.body, /## Skills/);
  assert.match(md.body, /先寫測試/);
});

test("spawn without dataDir fails fast", async () => {
  const result = await executeTool("spawn", { prompt: "find auth" });
  assert.equal(result.isError, true);
  assert.match(result.text, /dataDir/);
});

test("spawnJobs accepts Pi task/agent and tasks[]", () => {
  assert.deepEqual(spawnJobs({ task: "find x", agent: "explorer" }), [
    { prompt: "find x", name: "explorer", description: "" },
  ]);
  const jobs = spawnJobs({
    tasks: [
      { prompt: "survey auth", name: "explorer" },
      { task: "critique the diff", agent: "reviewer" },
    ],
  });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].name, "explorer");
  assert.equal(jobs[1].prompt, "critique the diff");
});

test("spawnProfile maps Devin luna profiles", () => {
  assert.equal(spawnProfile("luna-explore"), "explorer");
  assert.equal(spawnProfile("luna-general"), "worker");
  assert.equal(spawnProfile("explorer"), "explorer");
  assert.deepEqual(
    spawnJobs({
      title: "trace lights",
      task: "read-only survey",
      profile: "luna-explore",
    }),
    [
      {
        prompt: "read-only survey",
        name: "explorer",
        description: "trace lights",
      },
    ],
  );
});

test("background spawn returns agent_id without waiting; read_spawn waits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-bg-"));
  const ctx = { dataDir: dir, env: {} };
  const started = Date.now();
  const launched = await runSpawnJobs(
    {
      task: "find auth",
      profile: "luna-explore",
      title: "survey auth",
      is_background: true,
    },
    ctx,
  );
  assert.equal(launched.isError, false);
  assert.ok(Date.now() - started < 400);
  assert.match(launched.text, /agent_id:/);
  const id = /agent_id: (\S+)/.exec(launched.text)?.[1];
  assert.ok(id);
  const peek = await readSpawn({ agent_id: id, block: false }, ctx);
  assert.match(peek.text, /running|completed|failed/);
  const waited = await readSpawn({ agent_id: id, block: true }, ctx);
  assert.match(waited.text, /survey auth/);
  assert.match(waited.text, /no model|empty|failed|completed/i);
});

test("read_spawn finds a background spawn after dispatch clones ctx", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-bg-dispatch-"));
  const root: ToolContext = { dataDir: dir, env: {} };
  root.dispatch = (name, args, rest) => builtinExecute(name, args, rest);
  const launched = await executeTool(
    "spawn",
    {
      task: "find auth",
      profile: "luna-explore",
      title: "survey auth",
      background: true,
    },
    root,
  );
  assert.equal(launched.isError, false);
  const id = /agent_id: (\S+)/.exec(launched.text)?.[1];
  assert.ok(id);
  const waited = await executeTool(
    "read_spawn",
    { agent_id: id, block: true },
    root,
  );
  assert.doesNotMatch(waited.text, /unknown agent_id/);
  assert.match(waited.text, /survey auth/);
});

test("background spawn child abort follows the parent signal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-bg-abort-"));
  const parent = new AbortController();
  const ctx: ToolContext = { dataDir: dir, env: {}, signal: parent.signal };
  const launched = await runSpawnJobs(
    { task: "find auth", background: true, title: "x" },
    ctx,
  );
  const id = /agent_id: (\S+)/.exec(launched.text)?.[1];
  assert.ok(id);
  const handle = ctx.spawnHandles?.get(id);
  assert.ok(handle?.abort);
  parent.abort();
  assert.equal(handle.abort.signal.aborted, true);
});

test("spawn accepts Pi task alias", async () => {
  const result = await executeTool("spawn", { task: "find auth", agent: "explorer" });
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
    { ...OPEN, allowWrite: false },
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

test("assembleParts interleaves recap text with the tool round that followed", () => {
  const parts = assembleParts({
    thinking: "plan",
    beats: [
      { text: "先對 Title。" },
      {
        traces: [
          {
            name: "read",
            args: { path: "index.html" },
            text: "ok",
            isError: false,
          },
        ],
      },
      { text: "四城都對了。" },
    ],
    traces: [
      {
        name: "read",
        args: { path: "index.html" },
        text: "ok",
        isError: false,
      },
    ],
    text: "先對 Title。\n\n四城都對了。",
  });
  assert.equal(parts.map((part) => part.type).join(","), "thinking,text,tool,text");
  assert.equal(bodyFromParts(parts), "先對 Title。\n\n四城都對了。");
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


test("README documents the Hermes-shaped harness without claiming 128 or Hermes itself", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const zh = readFileSync(join(root, "README.zh.md"), "utf8");
  const ja = readFileSync(join(root, "README.ja.md"), "utf8");
  assert.ok(MAX_TOOL_ROUNDS > 8);
  for (const body of [readme, zh, ja]) {
    assert.match(body, /@handle.+chatReply.+HarnessService\.turn.+runAgentLoop/s);
    assert.match(body, /buildChatSystem/);
    assert.match(body, /Promise\.all/);
    assert.match(body, /<user_steer>/);
    assert.match(body, /AbortSignal/);
    assert.match(body, /gateTool/);
    assert.match(body, /full_access/);
    assert.match(body, /packages\/daemon\/src\/harness\.ts/);
    assert.match(body, /generate\.ts/);
    assert.match(body, /tools\.ts/);
    assert.match(body, /browser\.ts/);
    assert.doesNotMatch(body, /128 (tool )?rounds?/i);
    assert.doesNotMatch(body, /128 回合/);
    assert.doesNotMatch(body, /MAX_TOOL_ROUNDS/);
    assert.doesNotMatch(body, /Guild is Hermes/i);
    assert.doesNotMatch(body, /is the Codex app-server harness/);
    assert.doesNotMatch(body, /OS sandbox/);
    assert.doesNotMatch(body, /automatic approval/i);
  }
  assert.match(readme, /## The harness/);
  assert.match(readme, /borrowed one shape, not a codebase/);
  assert.match(readme, /not the Codex app-server harness/);
  assert.match(readme, /There is no approval step/);
  assert.match(readme, /snapshots your Chrome logins by default/);
  assert.match(readme, /no import \/ consent prompt/);
  assert.match(zh, /## Harness 是怎麼跑的/);
  assert.match(zh, /借的是一個形，不是 codebase/);
  assert.match(zh, /這不是 Codex app-server 的 harness/);
  assert.match(zh, /沒有審批步驟/);
  assert.match(zh, /預設帶你的 Chrome 登入/);
  assert.match(zh, /沒有匯入、沒有同意步驟/);
  assert.match(ja, /## ハーネスのまわし方/);
  assert.match(ja, /借りたのは形ひとつで、codebase ではない/);
  assert.match(ja, /Codex app-server のハーネスではない/);
  assert.match(ja, /承認ステップは無い/);
  assert.match(ja, /既定で Chrome のログインをスナップショット/);
  assert.match(ja, /import も同意プロンプトも無い/);
});

test("tool loop last-resort round fuse and Hermes wrap tools=None", () => {
  assert.ok(MAX_TOOL_ROUNDS > 8);
  assert.equal(nextToolRound(0), "continue");
  assert.equal(nextToolRound(8), "continue");
  assert.equal(nextToolRound(MAX_TOOL_ROUNDS - 2), "continue");
  assert.equal(nextToolRound(MAX_TOOL_ROUNDS - 1), "wrap");
  assert.equal(nextToolRound(MAX_TOOL_ROUNDS), "stop");
  assert.ok(SPAWN_TOOL_ROUNDS > 8);
  assert.ok(SPAWN_TOOL_ROUNDS < MAX_TOOL_ROUNDS);
  assert.equal(nextToolRound(SPAWN_TOOL_ROUNDS - 2, 1), "continue");
  assert.equal(nextToolRound(SPAWN_TOOL_ROUNDS - 1, 1), "wrap");
  assert.equal(nextToolRound(SPAWN_TOOL_ROUNDS, 1), "stop");
  assert.equal(nextToolRound(SPAWN_TOOL_ROUNDS, 0), "continue");
  assert.match(TOOL_LOOP_EXHAUSTED, /再送一次/);
  const oauth = readFileSync(new URL("../src/oauth.ts", import.meta.url), "utf8");
  const llm = readFileSync(new URL("../src/llm.ts", import.meta.url), "utf8");
  const loop = readFileSync(new URL("../src/harness.ts", import.meta.url), "utf8");
  assert.doesNotMatch(oauth, /too many tool rounds/);
  assert.doesNotMatch(oauth, /round < 8/);
  assert.doesNotMatch(llm, /round < 8/);
  assert.doesNotMatch(llm, /工具回合用完了/);
  assert.match(oauth, /runAgentLoop/);
  assert.match(llm, /runAgentLoop/);
  assert.match(loop, /nextToolRound/);
  assert.match(TOOL_LOOP_WRAP, /without calling any more tools/);
  assert.match(TOOL_LOOP_WRAP, /maximum number of tool-calling iterations/);
  assert.doesNotMatch(TOOL_LOOP_STALL, /maximum number of tool-calling iterations/);
  assert.match(loop, /TOOL_LOOP_STALL/);
  assert.match(loop, /wrapPrompt/);
  assert.match(llm, /wrap\s*\? \{\}\s*: \{ tools: catalog, tool_choice: "auto" \}/);
  assert.doesNotMatch(llm, /wrap[\s\S]{0,120}tool_choice:\s*"none"/);
  assert.match(llm, /wrap \? \{\} : \{ tools \}/);
  assert.match(llm, /wrap \? \{\} : \{ tools, tool_choice: "auto" \}/);
  assert.match(oauth, /useTools && !wrap \? \{ tools \}/);
  const cc = readFileSync(
    new URL("../src/commandcode-generate.ts", import.meta.url),
    "utf8",
  );
  assert.match(cc, /wrap \? \{\} : \{ tools: catalog \}/);
});

test("truncated tool args are not executed", async () => {
  const parsed = parseToolArgs("{", false);
  assert.equal(parsed.__guild_truncated, true);
  assert.deepEqual(parseToolArgs("{\"path\":\"a\"}", true).__guild_truncated, true);
  const ran = await executeTool("run", truncatedToolArgs());
  assert.equal(ran.isError, true);
  assert.match(ran.text, /truncated/);
  assert.doesNotMatch(ran.text, /exit code/);
});
