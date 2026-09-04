import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CDP_EVAL_TIMEOUT_MS,
  chromeBinaryCandidates,
  chromeLaunchArgs,
} from "../src/chrome-launch.ts";
import {
  acquireFreebuffMutex,
  doctorFreebuff,
  freebuffMutexHeld,
  logoutFreebuff,
  pollFreebuffLogin,
  resetFreebuffBridgeForTest,
  setFreebuffSdkHooks,
  startFreebuffLogin,
} from "../src/freebuff-bridge.ts";
import {
  FREEBUFF_CHAT_DEFAULT_MODEL,
  FREEBUFF_CHAT_PICKER_ID,
  completeFreebuffChat,
  freebuffJsonPath,
  isFreebuffChatEnabled,
  sessionUsable,
  setFreebuffPluginActive,
  stripWebBridgePicker,
} from "../src/freebuff-chat.ts";
import { setFreebuffCredentialsPathForTest } from "../src/freebuff-auth.ts";
import { DEFAULT_MODELS, llmComplete, publicModels, writeModelsFile } from "../src/llm.ts";
import { StoreError } from "../src/store.ts";
import { closeApp, listen } from "./app.ts";
import {
  fakeSdkPage,
  hookFakeSdk,
  loginFetch,
  writeOfficialCreds,
} from "./freebuff-sdk-harness.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-freebuff-bridge-"));
}

function webBridgeTarget(model = FREEBUFF_CHAT_DEFAULT_MODEL) {
  return {
    providerId: FREEBUFF_CHAT_PICKER_ID,
    model,
    baseUrl: "freebuff-chat",
    apiKey: "session",
    api: "openai-completions" as const,
    transport: "web-bridge" as const,
    sessionReady: false,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  await resetFreebuffBridgeForTest();
});

test("chromeBinary candidates cover Edge and Brave on Windows", () => {
  const win = chromeBinaryCandidates("win32", {
    LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local",
  });
  assert.ok(win.some((path) => path.includes("msedge.exe")));
  assert.ok(win.some((path) => path.includes("(x86)")));
  assert.ok(win.some((path) => path.includes("Brave")));
  const mac = chromeBinaryCandidates("darwin");
  assert.ok(mac.some((path) => path.includes("Google Chrome")));
  assert.ok(mac.some((path) => path.includes("Microsoft Edge")));
  assert.ok(mac.some((path) => path.includes("Brave Browser")));
  const linux = chromeBinaryCandidates("linux");
  assert.ok(linux.some((path) => path.includes("chrome")));
  assert.ok(linux.some((path) => path.includes("chromium")));
  assert.ok(linux.some((path) => path.includes("brave")));
});

test("chrome launch flags bind loopback, never headless, and CDP eval is 10s", () => {
  const args = chromeLaunchArgs(9333, "/tmp/freebuff-profile");
  assert.ok(args.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(args.some((flag) => flag.startsWith("--remote-debugging-port=")));
  assert.ok(args.some((flag) => flag.startsWith("--user-data-dir=")));
  assert.ok(args.includes("--no-first-run"));
  assert.ok(args.includes("--no-default-browser-check"));
  assert.ok(args.includes("--disable-sync"));
  assert.ok(!args.some((flag) => flag.includes("headless")));
  assert.equal(CDP_EVAL_TIMEOUT_MS, 10_000);
});

test("login accepts the live CLI code shape with numeric expiresAt", async () => {
  const home = tempHome();
  const creds = join(home, "creds.json");
  const expiresAt = Date.now() + 3_600_000;
  setFreebuffSdkHooks({
    credentialsPath: creds,
    fetch: (async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/cli/code")) {
        return new Response(
          JSON.stringify({
            fingerprintId: "enhanced-live",
            fingerprintHash: "abc123",
            loginUrl: "https://freebuff.com/login?auth_code=live",
            expiresAt,
            expiresInMs: 3_600_000,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch,
  });
  const status = await startFreebuffLogin(home);
  assert.equal(status.pending, true);
  assert.equal(status.ready, false);
  assert.equal(status.loginUrl, "https://freebuff.com/login?auth_code=live");
  assert.equal(status.error, undefined);
});

test("login without a token starts official device login and returns loginUrl", async () => {
  const home = tempHome();
  const creds = join(home, "creds.json");
  setFreebuffSdkHooks({
    credentialsPath: creds,
    fetch: loginFetch(),
  });
  const status = await startFreebuffLogin(home);
  assert.equal(status.pending, true);
  assert.equal(status.ready, false);
  assert.equal(status.loginUrl, "https://freebuff.com/login?cli=abc");
  assert.equal(freebuffMutexHeld(), false);
  assert.equal(sessionUsable(home), false);
  const json = freebuffJsonPath(home);
  assert.equal(statSync(json).mode & 0o777, 0o600);
});

test("poll writes credentials and connectedAt when device login completes", async () => {
  const home = tempHome();
  const creds = join(home, "creds.json");
  setFreebuffSdkHooks({
    credentialsPath: creds,
    fetch: loginFetch({ user: true }),
  });
  await startFreebuffLogin(home);
  const polled = await pollFreebuffLogin(home);
  assert.equal(polled.ready, true);
  assert.equal(sessionUsable(home), true);
  assert.equal(polled.pending, false);
  assert.equal(JSON.parse(readFileSync(creds, "utf8")).default.authToken, "tok-live");
  assert.equal(statSync(creds).mode & 0o777, 0o600);
});

test("Connect with existing Codex credentials is instant and does not fetch", async () => {
  const home = tempHome();
  const creds = join(home, "creds.json");
  writeOfficialCreds(creds, "already");
  let fetches = 0;
  setFreebuffSdkHooks({
    credentialsPath: creds,
    fetch: (async () => {
      fetches += 1;
      throw new Error("should not fetch");
    }) as typeof fetch,
  });
  const status = await startFreebuffLogin(home);
  assert.equal(status.ready, true);
  assert.equal(sessionUsable(home), true);
  assert.equal(fetches, 0);
});

test("poll stays pending until the official status returns a user", async () => {
  const home = tempHome();
  const creds = join(home, "creds.json");
  setFreebuffSdkHooks({
    credentialsPath: creds,
    fetch: loginFetch({ user: false }),
  });
  await startFreebuffLogin(home);
  const first = await pollFreebuffLogin(home);
  assert.equal(first.pending, true);
  assert.equal(first.ready, false);
  const second = await pollFreebuffLogin(home);
  assert.equal(second.pending, true);
  assert.equal(second.error, undefined);
});

test("poll returns cached status without the login API when the mutex is held", async () => {
  const home = tempHome();
  const creds = join(home, "creds.json");
  setFreebuffSdkHooks({
    credentialsPath: creds,
    fetch: loginFetch(),
  });
  await startFreebuffLogin(home);
  const lock = await acquireFreebuffMutex({ queue: true });
  try {
    const cached = await pollFreebuffLogin(home);
    assert.equal(cached.pending, true);
    assert.equal(cached.ready, false);
  } finally {
    lock.release();
  }
});

test("login and doctor are 409 freebuff_busy while a turn holds the mutex", async () => {
  const home = tempHome();
  const lock = await acquireFreebuffMutex({ queue: true });
  try {
    await assert.rejects(
      () => startFreebuffLogin(home),
      (err: unknown) =>
        err instanceof StoreError && err.status === 409 && err.message === "freebuff_busy",
    );
    await assert.rejects(
      () => doctorFreebuff(home),
      (err: unknown) =>
        err instanceof StoreError && err.status === 409 && err.message === "freebuff_busy",
    );
  } finally {
    lock.release();
  }
});

test("nested spawnDepth>=1 is freebuff_busy without acquire", async () => {
  const home = tempHome();
  const idle = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    toolCtx: { spawnDepth: 1 },
  });
  assert.match(idle.text, /freebuff_busy/);
  assert.equal(freebuffMutexHeld(), false);
  const lock = await acquireFreebuffMutex({ queue: true });
  const started = Date.now();
  try {
    const done = await completeFreebuffChat({
      dataDir: home,
      target: webBridgeTarget(),
      toolCtx: { spawnDepth: 1 },
    });
    assert.match(done.text, /freebuff_busy/);
    assert.ok(Date.now() - started < 500);
    assert.equal(freebuffMutexHeld(), true);
  } finally {
    lock.release();
  }
});

test("chat queue:true waits for the mutex then fails closed if unsigned", async () => {
  const home = tempHome();
  const lock = await acquireFreebuffMutex({ queue: true });
  const pending = completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
  });
  await sleep(30);
  lock.release();
  const done = await pending;
  assert.match(done.text, /freebuff_login_required/);
  assert.match(done.text, /^模型請求失敗：Freebuff Chat:/);
});

test("disabled plugin / GUILD_FREEBUFF_CHAT=0 returns freebuff_disabled, not Zen", async () => {
  const home = tempHome();
  writeModelsFile(home, {
    ...structuredClone(DEFAULT_MODELS),
    default: { provider: FREEBUFF_CHAT_PICKER_ID, model: FREEBUFF_CHAT_DEFAULT_MODEL },
  });
  setFreebuffPluginActive(false);
  const off = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
  });
  assert.match(off.text, /freebuff_disabled/);
  const lock = await acquireFreebuffMutex({ queue: true });
  const started = Date.now();
  try {
    const queued = await completeFreebuffChat({
      dataDir: home,
      target: webBridgeTarget(),
    });
    assert.match(queued.text, /freebuff_disabled/);
    assert.ok(Date.now() - started < 200);
    assert.equal(freebuffMutexHeld(), true);
  } finally {
    lock.release();
  }
  setFreebuffPluginActive(true);
  const envOff = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    toolCtx: { env: { GUILD_FREEBUFF_CHAT: "0" } },
  });
  assert.match(envOff.text, /freebuff_disabled/);
  const done = await llmComplete({
    dataDir: home,
    env: { GUILD_FREEBUFF_CHAT: "0" },
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.ok(done);
  assert.match(done.text, /freebuff_disabled/);
  assert.equal(done.provider, FREEBUFF_CHAT_PICKER_ID);
});

test("SDK turn uses costMode=free, official agent, and denies remote file/shell tools", async () => {
  const home = tempHome();
  const page = fakeSdkPage();
  hookFakeSdk(home, page);
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: "Be brief.",
    messages: [{ role: "user", content: "hello there" }],
  });
  assert.equal(done.text, "pong");
  assert.equal(page.lastOptions?.costMode, "free");
  assert.equal(page.lastOptions?.agent, "base3-free-deepseek-flash");
  const denied = page.lastOptions?.overrideTools as Record<string, unknown>;
  assert.equal(typeof denied.read_files, "function");
  assert.equal(typeof denied.write_file, "function");
  assert.equal(typeof denied.run_terminal_command, "function");
  assert.match(page.prompts[0] || "", /hello there/);
  assert.match(page.prompts[0] || "", /```guild_tools/);
});

test("unknown Chat floor id is freebuff_limited_mode", async () => {
  const home = tempHome();
  hookFakeSdk(home, fakeSdkPage());
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget("gpt-5.6-luna"),
    messages: [{ role: "user", content: "hi" }],
  });
  assert.match(done.text, /freebuff_limited_mode/);
});

test("logout clears Guild connectedAt and keeps official credentials", async () => {
  const home = tempHome();
  const creds = hookFakeSdk(home, fakeSdkPage());
  assert.equal(sessionUsable(home), true);
  const after = await logoutFreebuff(home);
  assert.equal(after.ready, false);
  assert.equal(sessionUsable(home), false);
  assert.equal(existsSync(creds), true);
  assert.equal(JSON.parse(readFileSync(creds, "utf8")).default.authToken, "test-token");
});

test("doctor is ok only with token + connectedAt", async () => {
  const home = tempHome();
  hookFakeSdk(home, fakeSdkPage());
  const report = await doctorFreebuff(home);
  assert.equal(report.ok, true);
  assert.equal(report.sessionUsable, true);
  assert.equal(report.phase, "sdk");
  assert.equal(report.chrome, "missing");
  await logoutFreebuff(home);
  const cold = await doctorFreebuff(home);
  assert.equal(cold.ok, false);
  assert.equal(cold.code, "freebuff_login_required");
});

test("stripWebBridgePicker drops web-bridge picker rows", () => {
  const home = tempHome();
  const listed = publicModels(home, {});
  assert.ok(listed.picker.some((row) => row.kind === "web-bridge"));
  const stripped = stripWebBridgePicker(listed);
  assert.deepEqual(stripped.webBridges, []);
  assert.equal(
    stripped.picker.some((row) => row.kind === "web-bridge"),
    false,
  );
  assert.equal(isFreebuffChatEnabled({ GUILD_FREEBUFF_CHAT: "0" }), false);
});

test("settings HTTP: web routes, busy 409, disabled 503, env strip", { timeout: 60_000 }, async () => {
  const home = tempHome();
  const app = await listen(home);
  try {
    const listed = await fetch(`${app.origin}/settings/web`).then(async (res) => ({
      status: res.status,
      body: await res.json(),
    }));
    assert.equal(listed.status, 200);
    assert.equal(listed.body.bridges[0].id, "freebuff-chat");
    assert.equal(listed.body.bridges[0].kind, "web-bridge");

    const models = await fetch(`${app.origin}/settings/models`).then((res) => res.json());
    assert.ok(models.picker.some((row: { kind: string }) => row.kind === "web-bridge"));
    assert.ok(models.webBridges?.length);

    const lock = await acquireFreebuffMutex({ queue: true });
    try {
      const busy = await fetch(`${app.origin}/settings/web/freebuff-chat/login`, {
        method: "POST",
      }).then(async (res) => ({ status: res.status, body: await res.json() }));
      assert.equal(busy.status, 409);
      assert.equal(busy.body.error, "freebuff_busy");
      const doctor = await fetch(`${app.origin}/settings/web/freebuff-chat/doctor`, {
        method: "POST",
      }).then(async (res) => ({ status: res.status, body: await res.json() }));
      assert.equal(doctor.status, 409);
      assert.equal(doctor.body.error, "freebuff_busy");
    } finally {
      lock.release();
    }
  } finally {
    await closeApp(app);
  }

  const stripped = await listen(home, { ...process.env, GUILD_FREEBUFF_CHAT: "0" });
  try {
    const models = await fetch(`${stripped.origin}/settings/models`).then((res) => res.json());
    assert.equal(
      models.picker.some((row: { kind: string }) => row.kind === "web-bridge"),
      false,
    );
    assert.deepEqual(models.webBridges, []);
    const web = await fetch(`${stripped.origin}/settings/web`).then(async (res) => ({
      status: res.status,
      body: await res.json(),
    }));
    assert.equal(web.status, 200);
    assert.deepEqual(web.body, { bridges: [] });
    for (const path of [
      "/settings/web/freebuff-chat/login",
      "/settings/web/freebuff-chat/poll",
      "/settings/web/freebuff-chat/logout",
      "/settings/web/freebuff-chat/doctor",
    ]) {
      const res = await fetch(`${stripped.origin}${path}`, { method: "POST" }).then(
        async (r) => ({ status: r.status, body: await r.json() }),
      );
      assert.equal(res.status, 503, path);
      assert.equal(res.body.error, "freebuff_disabled", path);
    }
  } finally {
    await closeApp(stripped);
  }

  const disabled = await listen(home, {}, { patches: [{ id: "freebuff", disabled: true }] });
  try {
    const web = await fetch(`${disabled.origin}/settings/web`).then(async (res) => ({
      status: res.status,
      body: await res.json(),
    }));
    assert.equal(web.status, 200);
    assert.deepEqual(web.body, { bridges: [] });
    const login = await fetch(`${disabled.origin}/settings/web/freebuff-chat/login`, {
      method: "POST",
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
    assert.equal(login.status, 503);
    assert.equal(login.body.error, "freebuff_disabled");
    const models = await fetch(`${disabled.origin}/settings/models`).then((res) => res.json());
    assert.equal(
      models.picker.some((row: { kind: string }) => row.kind === "web-bridge"),
      false,
    );
  } finally {
    await closeApp(disabled);
  }
});

test("cordis.yml registers freebuff and tools closeBrowser does not import the bridge", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const yml = readFileSync(join(root, "cordis.yml"), "utf8");
  assert.match(yml, /id: freebuff/);
  assert.match(yml, /plugins\/freebuff\.ts/);
  const tools = readFileSync(join(root, "src/plugins/tools.ts"), "utf8");
  assert.match(tools, /closeBrowser/);
  assert.doesNotMatch(tools, /closeFreebuffBrowser/);
  const plugin = readFileSync(join(root, "src/plugins/freebuff.ts"), "utf8");
  assert.match(plugin, /closeFreebuffBrowser/);
  assert.match(plugin, /ctx\.effect/);
});

test("sessionUsable after Connect uses the official credentials path", async () => {
  const home = tempHome();
  const creds = join(home, "creds.json");
  writeOfficialCreds(creds);
  setFreebuffCredentialsPathForTest(creds);
  assert.equal(sessionUsable(home), false);
  await startFreebuffLogin(home);
  assert.equal(sessionUsable(home), true);
});
