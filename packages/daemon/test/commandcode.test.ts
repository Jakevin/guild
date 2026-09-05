import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  COMMANDCODE_API_BASE,
  COMMANDCODE_DEFAULT_MODEL,
  COMMANDCODE_PICKER_ID,
  COMMANDCODE_PROVIDER_API_BASE,
  apiForModelId,
  buildCommandCodeAuthUrl,
  isCommandCodeProvider,
  isCommandCodeUpgradeRequired,
  parseCommandCodeAuthFile,
  parseCommandCodeCatalog,
  parseCommandCodeStreamLine,
  projectSlugFromPath,
  readGenerateRound,
  refreshCommandCodeCatalog,
  resolveCommandCodeAuth,
  sanitizeCommandCodeApiKey,
  setCommandCodeHooksForTest,
  writeCommandCodeState,
} from "../src/commandcode.ts";
import {
  LOGIN_ALLOWED_ORIGINS,
  LOGIN_START_PORT,
  startCommandCodeLogin,
  waitCommandCodeLogin,
} from "../src/commandcode-login.ts";
import { commandCodeGenerateConfig } from "../src/commandcode-generate.ts";
import { publicModels, resolveLlm, setShownModels, writeModelsFile } from "../src/llm.ts";
import { OPENCODE_FREE_PROVIDER_ID } from "../src/opencode-free.ts";
import { closeServer, listen as listenApp } from "./app.ts";
import { GuildStore } from "../src/store.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-commandcode-"));
}

function writeAuthFile(home: string, body: unknown): string {
  const path = join(home, ".commandcode", "auth.json");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  return path;
}

test("Command Code picker id, bases, and claude vs openai route", () => {
  assert.equal(COMMANDCODE_PICKER_ID, "commandcode");
  assert.equal(isCommandCodeProvider("commandcode"), true);
  assert.equal(isCommandCodeProvider("command-code"), true);
  assert.equal(isCommandCodeProvider("openai"), false);
  assert.equal(COMMANDCODE_API_BASE, "https://api.commandcode.ai");
  assert.equal(COMMANDCODE_PROVIDER_API_BASE, "https://api.commandcode.ai/provider/v1");
  assert.equal(apiForModelId("claude-sonnet-5"), "anthropic-messages");
  assert.equal(apiForModelId("deepseek/deepseek-v4-flash"), "openai-completions");
  assert.equal(COMMANDCODE_DEFAULT_MODEL, "deepseek/deepseek-v4-flash");
  assert.equal(projectSlugFromPath("/Users/me/My Repo"), "users-me-my-repo");
});

test("sanitizeApiKey strips paste wrappers; auth.json shapes match the official CLI", () => {
  assert.equal(sanitizeCommandCodeApiKey("  user_abc  "), "user_abc");
  assert.equal(
    parseCommandCodeAuthFile({ apiKey: "user_direct" }),
    "user_direct",
  );
  assert.equal(
    parseCommandCodeAuthFile({ commandcode: { type: "api", key: "user_nested" } }),
    "user_nested",
  );
  assert.equal(
    parseCommandCodeAuthFile({
      "command-code": { type: "oauth", access: "user_oauth" },
    }),
    "user_oauth",
  );
});

test("resolveCommandCodeAuth prefers Guild store, then env, then ~/.commandcode/auth.json", () => {
  const home = tempHome();
  const userHome = tempHome();
  setCommandCodeHooksForTest({ homedir: () => userHome });
  try {
    assert.equal(resolveCommandCodeAuth(home, {}).token, undefined);
    writeAuthFile(userHome, { apiKey: "user_cli" });
    assert.equal(resolveCommandCodeAuth(home, {}).token, "user_cli");
    assert.equal(resolveCommandCodeAuth(home, {}).source, "cli-auth");
    assert.equal(
      resolveCommandCodeAuth(home, { COMMAND_CODE_API_KEY: "user_env" }).token,
      "user_env",
    );
    writeCommandCodeState(home, { apiKey: "user_guild" });
    assert.equal(resolveCommandCodeAuth(home, { COMMAND_CODE_API_KEY: "user_env" }).token, "user_guild");
    assert.equal(resolveCommandCodeAuth(home, {}).source, "guild");
  } finally {
    setCommandCodeHooksForTest();
  }
});

test("live catalog parse keeps id/name and routes claude to anthropic-messages", () => {
  const models = parseCommandCodeCatalog({
    object: "list",
    data: [
      { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", context_length: 128000 },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", context_length: 200000 },
    ],
  });
  assert.equal(models.length, 2);
  assert.equal(models[0]?.id, "deepseek/deepseek-v4-flash");
  assert.equal(models[1]?.api, "anthropic-messages");
});

test("403 upgrade_required is the Pi generate fallback, not a generic HTTP error", () => {
  assert.equal(
    isCommandCodeUpgradeRequired({
      status: 403,
      body: { error: { code: "upgrade_required" } },
    }),
    true,
  );
  assert.equal(
    isCommandCodeUpgradeRequired({ status: 403, body: { error: { code: "nope" } } }),
    false,
  );
  assert.equal(isCommandCodeUpgradeRequired({ status: 401, body: { error: { code: "upgrade_required" } } }), false);
});

test("Go generate config includes YYYY-MM-DD date like official cmd", () => {
  const cfg = commandCodeGenerateConfig("/tmp/guild", Date.UTC(2026, 8, 5, 12));
  assert.equal(cfg.date, "2026-09-05");
  assert.equal(cfg.workingDir, "/tmp/guild");
  assert.equal(typeof cfg.environment, "string");
});

test("generate stream parser reads text-delta, reasoning, and tool-call JSONL", () => {
  assert.deepEqual(parseCommandCodeStreamLine("data: {\"type\":\"text-delta\",\"text\":\"hi\"}"), {
    type: "text-delta",
    text: "hi",
  });
  assert.equal(parseCommandCodeStreamLine(": ping"), undefined);
  assert.equal(parseCommandCodeStreamLine("data: [DONE]"), undefined);
  const round = readGenerateRound([
    { type: "reasoning-delta", text: "think " },
    { type: "reasoning-delta", text: "more" },
    { type: "text-delta", text: "Hello" },
    {
      type: "tool-call",
      toolCallId: "c1",
      toolName: "read",
      input: { path: "README.md" },
    },
    { type: "finish", finishReason: "tool-calls" },
  ]);
  assert.equal(round.text, "Hello");
  assert.equal(round.thinking, "think more");
  assert.equal(round.calls.length, 1);
  assert.equal(round.calls[0]?.name, "read");
  assert.equal((round.calls[0]?.args as { path?: string }).path, "README.md");
});

test("studio auth URL is the official cmd login loopback", () => {
  const url = buildCommandCodeAuthUrl({
    studioBase: "https://commandcode.ai",
    callback: "http://localhost:5959/callback",
    state: "abc",
  });
  assert.equal(
    url,
    "https://commandcode.ai/studio/auth/cli?callback=http%3A%2F%2Flocalhost%3A5959%2Fcallback&state=abc",
  );
  assert.ok(LOGIN_ALLOWED_ORIGINS.includes("https://commandcode.ai"));
  assert.equal(LOGIN_START_PORT, 5959);
});

test("loopback login stores the Studio-posted key after /alpha/whoami", async () => {
  const home = tempHome();
  const fetches: string[] = [];
  const started = await startCommandCodeLogin(home, {
    fetchImpl: async (input) => {
      fetches.push(String(input));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    startPort: 0,
  });
  assert.match(started.loginUrl, /\/studio\/auth\/cli\?callback=/);
  assert.equal(started.pending, true);
  const callback = new URL(started.loginUrl).searchParams.get("callback");
  const state = new URL(started.loginUrl).searchParams.get("state");
  assert.ok(callback);
  const posted = await fetch(callback, {
    method: "POST",
    headers: {
      origin: "https://commandcode.ai",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      apiKey: "user_from_studio",
      state,
      userId: "u1",
      userName: "Ada",
      keyName: "guild",
    }),
  });
  assert.equal(posted.status, 200);
  const done = await waitCommandCodeLogin(home);
  assert.equal(done.ready, true);
  assert.equal(resolveCommandCodeAuth(home, {}).token, "user_from_studio");
  assert.ok(fetches.some((url) => url.endsWith("/alpha/whoami")));
});

test("factory default stays OpenCode Free; Command Code is a ready picker only with a key", () => {
  const home = tempHome();
  const pub = publicModels(home, {});
  assert.equal(pub.default?.provider, OPENCODE_FREE_PROVIDER_ID);
  const row = pub.picker.find((item) => item.id === COMMANDCODE_PICKER_ID);
  assert.ok(row);
  assert.equal(row.kind, "commandcode");
  assert.equal(row.ready, false);
  assert.ok(row.models.some((model) => model.id === COMMANDCODE_DEFAULT_MODEL));
  const unsigned = resolveLlm(home, {}, "chat", {
    provider: COMMANDCODE_PICKER_ID,
    model: COMMANDCODE_DEFAULT_MODEL,
  });
  assert.ok(unsigned);
  assert.notEqual(unsigned.providerId, COMMANDCODE_PICKER_ID);
  writeCommandCodeState(home, { apiKey: "user_live" });
  const ready = publicModels(home, {});
  assert.equal(ready.picker.find((item) => item.id === COMMANDCODE_PICKER_ID)?.ready, true);
  const target = resolveLlm(home, {}, "spawn", {
    provider: COMMANDCODE_PICKER_ID,
    model: COMMANDCODE_DEFAULT_MODEL,
  });
  assert.ok(target);
  assert.equal(target.providerId, COMMANDCODE_PICKER_ID);
  assert.equal(target.transport, "commandcode");
  assert.equal(target.apiKey, "user_live");
  assert.equal(target.baseUrl, COMMANDCODE_PROVIDER_API_BASE);
});

test("live catalog refresh writes the official /provider/v1/models list, not the three-model floor", async () => {
  const home = tempHome();
  setCommandCodeHooksForTest({
    fetch: async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", context_length: 128000 },
            { id: "moonshotai/Kimi-K3", name: "Kimi K3", context_length: 1000000 },
            { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", context_length: 1000000 },
            { id: "claude-sonnet-5", name: "Claude Sonnet 5", context_length: 1000000 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  try {
    const models = await refreshCommandCodeCatalog(home, {}, true);
    assert.equal(models.length, 4);
    assert.ok(models.some((row) => row.id === "moonshotai/Kimi-K3"));
    assert.ok(models.some((row) => row.id === "gpt-5.6-luna"));
    const pub = publicModels(home, {});
    const ids = pub.picker.find((item) => item.id === COMMANDCODE_PICKER_ID)?.models.map((row) => row.id) ?? [];
    assert.ok(ids.includes("moonshotai/Kimi-K3"));
    assert.ok(ids.includes("claude-sonnet-5"));
  } finally {
    setCommandCodeHooksForTest();
  }
});

test("shownIds in models.json filters the hall picker; missing shown keeps the full catalog", async () => {
  const home = tempHome();
  setCommandCodeHooksForTest({
    fetch: async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", context_length: 128000 },
            { id: "moonshotai/Kimi-K3", name: "Kimi K3", context_length: 1000000 },
            { id: "claude-sonnet-5", name: "Claude Sonnet 5", context_length: 1000000 },
          ],
        }),
        { status: 200 },
      ),
  });
  try {
    await refreshCommandCodeCatalog(home, {}, true);
    writeCommandCodeState(home, { apiKey: "user_live" });
    assert.equal(publicModels(home, {}).picker.find((row) => row.id === COMMANDCODE_PICKER_ID)?.models.length, 3);
    setShownModels(home, COMMANDCODE_PICKER_ID, ["deepseek/deepseek-v4-flash", "moonshotai/Kimi-K3"]);
    const filtered = publicModels(home, {}).picker.find((row) => row.id === COMMANDCODE_PICKER_ID);
    assert.deepEqual(
      filtered?.models.map((row) => row.id),
      ["deepseek/deepseek-v4-flash", "moonshotai/Kimi-K3"],
    );
    assert.equal(publicModels(home, {}).commandCode?.catalog?.length, 3);
    assert.deepEqual(publicModels(home, {}).commandCode?.shownIds, [
      "deepseek/deepseek-v4-flash",
      "moonshotai/Kimi-K3",
    ]);
    setShownModels(home, COMMANDCODE_PICKER_ID, null);
    assert.equal(publicModels(home, {}).picker.find((row) => row.id === COMMANDCODE_PICKER_ID)?.models.length, 3);
    setShownModels(home, "xai-oauth", ["grok-4"]);
    const stored = JSON.parse(readFileSync(join(home, "models.json"), "utf8")) as {
      shown?: Record<string, string[]>;
    };
    assert.deepEqual(stored.shown?.["xai-oauth"], ["grok-4"]);
    assert.equal(stored.shown?.[COMMANDCODE_PICKER_ID], undefined);
  } finally {
    setCommandCodeHooksForTest();
  }
});

test("settings hall copy: Command Code card, Connect, not a Freebuff web-bridge", () => {
  const settings = readFileSync(
    fileURLToPath(new URL("../src/public/settings.html", import.meta.url)),
    "utf8",
  );
  assert.match(settings, /kind === "commandcode"/);
  assert.match(settings, /data-cc-login/);
  assert.match(settings, /data-cc-sync/);
  assert.match(settings, /data-shown-box/);
  assert.match(settings, /data-shown-all/);
  assert.match(settings, /data-sub-tab/);
  assert.match(settings, /account-tabs/);
  assert.match(settings, /account-models/);
  assert.match(settings, /account-models-count/);
  assert.match(settings, /orderShownRows/);
  assert.match(settings, /\/settings\/shown/);
  assert.match(settings, /\/settings\/commandcode\/login/);
  assert.match(settings, /\/settings\/commandcode\/sync/);
  assert.doesNotMatch(settings, /data-cc-shown/);
  assert.doesNotMatch(settings, /data-apply-model/);
  assert.doesNotMatch(settings, /saveCcShown/);
  assert.doesNotMatch(settings, /kind === "commandcode"[^;]*web-bridge/);
  const i18n = readFileSync(
    fileURLToPath(new URL("../src/public/i18n.js", import.meta.url)),
    "utf8",
  );
  assert.match(i18n, /\["settings\.commandCode"/);
  assert.match(i18n, /\["settings\.commandCodeHint"/);
  assert.match(i18n, /\["settings\.accountModels"/);
  assert.doesNotMatch(i18n, /\["settings\.applyModel"/);
});

test("GET /settings/models lists Command Code; login route returns a studio URL", async () => {
  const home = tempHome();
  writeModelsFile(home, { default: null, providers: {} });
  const store = new GuildStore(home);
  const { server, origin } = await listenApp(home, {});
  try {
    const models = await fetch(`${origin}/settings/models`);
    const body = (await models.json()) as {
      picker: { id: string; kind: string; ready: boolean }[];
      commandCode?: { id: string };
    };
    assert.ok(body.picker.some((row) => row.id === "commandcode" && row.kind === "commandcode"));
    assert.equal(body.commandCode?.id, "commandcode");
    const login = await fetch(`${origin}/settings/commandcode/login`, { method: "POST" });
    const started = (await login.json()) as { loginUrl?: string; pending?: boolean };
    assert.equal(login.status, 200);
    assert.match(String(started.loginUrl), /commandcode\.ai\/studio\/auth\/cli/);
    assert.equal(started.pending, true);
    await fetch(`${origin}/settings/commandcode/logout`, { method: "POST" });
  } finally {
    await closeServer(server);
    store.close();
  }
});

test("PATCH /settings/shown filters Command Code in the hall picker", async () => {
  const home = tempHome();
  writeModelsFile(home, { default: null, providers: {} });
  writeCommandCodeState(home, { apiKey: "user_live" });
  setCommandCodeHooksForTest({
    fetch: async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
            { id: "moonshotai/Kimi-K3", name: "Kimi K3" },
            { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
          ],
        }),
        { status: 200 },
      ),
  });
  const store = new GuildStore(home);
  const { server, origin } = await listenApp(home, {});
  try {
    await refreshCommandCodeCatalog(home, {}, true);
    const filtered = await fetch(`${origin}/settings/shown`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: COMMANDCODE_PICKER_ID,
        shownIds: ["deepseek/deepseek-v4-flash", "moonshotai/Kimi-K3"],
      }),
    });
    const body = (await filtered.json()) as {
      picker: { id: string; models: { id: string }[] }[];
      commandCode?: { catalog?: { id: string }[]; shownIds?: string[] | null };
    };
    assert.equal(filtered.status, 200);
    assert.deepEqual(
      body.picker.find((row) => row.id === COMMANDCODE_PICKER_ID)?.models.map((row) => row.id),
      ["deepseek/deepseek-v4-flash", "moonshotai/Kimi-K3"],
    );
    assert.equal(body.commandCode?.catalog?.length, 3);
    assert.deepEqual(body.commandCode?.shownIds, [
      "deepseek/deepseek-v4-flash",
      "moonshotai/Kimi-K3",
    ]);
    const all = await fetch(`${origin}/settings/shown`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: COMMANDCODE_PICKER_ID, shownIds: null }),
    });
    const restored = (await all.json()) as {
      picker: { id: string; models: { id: string }[] }[];
      commandCode?: { shownIds?: string[] | null };
    };
    assert.equal(all.status, 200);
    assert.equal(restored.picker.find((row) => row.id === COMMANDCODE_PICKER_ID)?.models.length, 3);
    assert.equal(restored.commandCode?.shownIds, null);
  } finally {
    setCommandCodeHooksForTest();
    await closeServer(server);
    store.close();
  }
});
