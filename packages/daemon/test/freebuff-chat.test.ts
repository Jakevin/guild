import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  FREEBUFF_CHAT_DEFAULT_MODEL,
  FREEBUFF_CHAT_FLOOR,
  FREEBUFF_CHAT_LOGIN_HINT,
  FREEBUFF_CHAT_PICKER_ID,
  FREEBUFF_CHAT_PROVIDER_ID,
  FREEBUFF_CHAT_URL,
  FREEBUFF_COMPOSER_CHAR_BUDGET,
  FREEBUFF_COMPOSER_TOKEN_BUDGET,
  FREEBUFF_ERROR_ZH,
  FREEBUFF_PROGRESS_QUEUE,
  FREEBUFF_PROGRESS_PASTE,
  FREEBUFF_PROGRESS_SEND,
  FREEBUFF_PROGRESS_WAIT,
  WEB_BRIDGE_PICKER_IDS,
  completeFreebuffChat,
  formatFreebuffError,
  isWebBridgeTarget,
  liveOrFloorModels,
  sessionUsable,
  type FreebuffErrorCode,
} from "../src/freebuff-chat.ts";
import {
  DEFAULT_MODELS,
  dispatchComplete,
  llmComplete,
  publicModels,
  resolveLlm,
  writeModelsFile,
} from "../src/llm.ts";
import {
  OPENCODE_FREE_DEFAULT_MODEL,
  OPENCODE_FREE_PROVIDER_ID,
} from "../src/opencode-free.ts";
import { setFreebuffCredentialsPathForTest } from "../src/freebuff-auth.ts";
import { writeOfficialCreds } from "./freebuff-sdk-harness.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-freebuff-"));
}

function writeFreebuffDefault(home: string, model = FREEBUFF_CHAT_DEFAULT_MODEL) {
  writeModelsFile(home, {
    ...structuredClone(DEFAULT_MODELS),
    default: { provider: FREEBUFF_CHAT_PICKER_ID, model },
  });
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

test("factory default remains OpenCode Free and floor catalog is offline", () => {
  assert.equal(DEFAULT_MODELS.default?.provider, OPENCODE_FREE_PROVIDER_ID);
  assert.equal(DEFAULT_MODELS.default?.model, OPENCODE_FREE_DEFAULT_MODEL);
  assert.equal(FREEBUFF_CHAT_PROVIDER_ID, "freebuff-chat");
  assert.equal(FREEBUFF_CHAT_PICKER_ID, "freebuff-chat");
  assert.ok(WEB_BRIDGE_PICKER_IDS.has("freebuff-chat"));
  assert.equal(FREEBUFF_CHAT_URL, "https://freebuff.com/chat");
  assert.equal(FREEBUFF_COMPOSER_CHAR_BUDGET, 32_000);
  assert.equal(FREEBUFF_COMPOSER_TOKEN_BUDGET, 8_000);
  assert.equal(FREEBUFF_CHAT_DEFAULT_MODEL, "deepseek-v4-flash-0731");
  const ids = FREEBUFF_CHAT_FLOOR.map((row) => row.id);
  assert.deepEqual(ids, ["deepseek-v4-flash-0731", "glm-5.3-flash"]);
});

test("sessionUsable needs connectedAt and an official CLI token", () => {
  const home = tempHome();
  const missing = join(home, "no-creds.json");
  setFreebuffCredentialsPathForTest(missing);
  try {
    assert.equal(sessionUsable(home), false);
    writeFileSync(
      join(home, "freebuff.json"),
      JSON.stringify({ connectedAt: "2026-09-04T00:00:00.000Z" }),
    );
    assert.equal(sessionUsable(home), false);
    mkdirSync(join(home, "freebuff-profile"));
    assert.equal(sessionUsable(home), false);
    const creds = join(home, "manicode-credentials.json");
    writeOfficialCreds(creds);
    setFreebuffCredentialsPathForTest(creds);
    assert.equal(sessionUsable(home), true);
    writeFileSync(join(home, "freebuff.json"), JSON.stringify({ connectedAt: "" }));
    assert.equal(sessionUsable(home), false);
  } finally {
    setFreebuffCredentialsPathForTest();
  }
});

test("liveOrFloorModels keeps probe ids and falls back to the floor", () => {
  const home = tempHome();
  assert.equal(liveOrFloorModels(home)[0]?.id, FREEBUFF_CHAT_DEFAULT_MODEL);
  writeFileSync(
    join(home, "freebuff.json"),
    JSON.stringify({ models: ["live-probe-id", "glm-5.3-flash"] }),
  );
  assert.deepEqual(
    liveOrFloorModels(home).map((row) => row.id),
    ["live-probe-id", "glm-5.3-flash"],
  );
});

test("formatFreebuffError keeps the hall prefix and codes", () => {
  const text = formatFreebuffError("freebuff_login_required");
  assert.match(text, /^模型請求失敗：Freebuff Chat: freebuff_login_required — /);
  assert.equal(formatFreebuffError(text), text);
  assert.match(
    formatFreebuffError("freebuff_unreachable_dispatch"),
    /freebuff_unreachable_dispatch/,
  );
  assert.match(
    formatFreebuffError("freebuff_stream_idle"),
    /^模型請求失敗：Freebuff Chat: freebuff_stream_idle — /,
  );
  assert.doesNotMatch(formatFreebuffError("freebuff_stream_idle"), /不是訂閱失效/);
});

test("default=freebuff-chat pins even when unsigned and XAI_API_KEY is set", async () => {
  const home = tempHome();
  writeFreebuffDefault(home);
  const env = { XAI_API_KEY: "xai-test" };
  const target = resolveLlm(home, env);
  assert.ok(target);
  assert.equal(target?.providerId, FREEBUFF_CHAT_PICKER_ID);
  assert.equal(target?.model, FREEBUFF_CHAT_DEFAULT_MODEL);
  assert.equal(target?.transport, "web-bridge");
  assert.equal(target?.sessionReady, false);
  assert.equal(isWebBridgeTarget(target!), true);

  const listed = publicModels(home, env);
  const pick = listed.picker.find((p) => p.id === FREEBUFF_CHAT_PICKER_ID);
  assert.equal(pick?.kind, "web-bridge");
  assert.equal(pick?.ready, false);
  assert.ok(pick?.models.some((m) => m.id === FREEBUFF_CHAT_DEFAULT_MODEL));
  assert.equal(listed.active?.provider, FREEBUFF_CHAT_PICKER_ID);
  assert.equal(listed.active?.ready, false);
  assert.equal(listed.webBridges?.[0]?.kind, "web-bridge");
  assert.equal(listed.webBridges?.[0]?.ready, false);

  const done = await llmComplete({
    dataDir: home,
    env,
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.ok(done);
  assert.match(done.text, /freebuff_login_required/);
  assert.match(done.text, /^模型請求失敗：Freebuff Chat:/);
  assert.equal(done.provider, FREEBUFF_CHAT_PICKER_ID);
  assert.deepEqual(done.traces, []);
});

test("prefer=openai unready does not fall back onto default freebuff-chat", () => {
  const home = tempHome();
  writeFreebuffDefault(home);
  const target = resolveLlm(
    home,
    { XAI_API_KEY: "xai-test" },
    "chat",
    { provider: "openai", model: "gpt-4.1-mini" },
  );
  assert.ok(target);
  assert.notEqual(target?.providerId, FREEBUFF_CHAT_PICKER_ID);
  assert.equal(isWebBridgeTarget(target!), false);
});

test("sidecar roles skip the web-bridge and use the ordinary chain", () => {
  const home = tempHome();
  writeFreebuffDefault(home);
  for (const role of ["spawn", "compression", "generate", "skills"] as const) {
    const target = resolveLlm(home, {}, role);
    assert.ok(target, role);
    assert.equal(isWebBridgeTarget(target!), false, role);
    assert.equal(target?.providerId, OPENCODE_FREE_PROVIDER_ID, role);
  }
});

test("validRef keeps live web-bridge model ids that are not on the floor", () => {
  const home = tempHome();
  writeFreebuffDefault(home, "live-probe-id");
  const listed = publicModels(home, {});
  assert.equal(listed.default?.provider, FREEBUFF_CHAT_PICKER_ID);
  assert.equal(listed.default?.model, "live-probe-id");
  const target = resolveLlm(home, {});
  assert.equal(target?.model, "live-probe-id");
});

test("completeFreebuffChat stub never returns null and rethrows AbortError", async () => {
  const home = tempHome();
  const target = webBridgeTarget();
  const done = await completeFreebuffChat({ dataDir: home, target });
  assert.ok(done);
  assert.match(done.text, /freebuff_login_required/);
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () =>
      completeFreebuffChat({
        dataDir: home,
        target,
        signal: ctrl.signal,
      }),
    (err: unknown) => err instanceof Error && err.name === "AbortError",
  );
});

test("dispatchComplete refuses web-bridge without fetch", async () => {
  const home = tempHome();
  let fetches = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetches += 1;
    return orig(...args);
  }) as typeof fetch;
  try {
    const result = await dispatchComplete(
      webBridgeTarget(),
      "sys",
      [{ role: "user", content: "hi" }],
      0.4,
      false,
      { dataDir: home, spawnDepth: 0, allowWrite: true },
    );
    assert.equal(fetches, 0);
    assert.ok(result);
    assert.match(result.text, /freebuff_unreachable_dispatch/);
    assert.match(result.text, /^模型請求失敗：Freebuff Chat:/);
    assert.deepEqual(result.traces, []);
  } finally {
    globalThis.fetch = orig;
  }
});

test("settings picker lists web-bridge and i18n names the bridge", () => {
  const settings = readFileSync(
    fileURLToPath(new URL("../src/public/settings.html", import.meta.url)),
    "utf8",
  );
  const i18n = readFileSync(
    fileURLToPath(new URL("../src/public/i18n.js", import.meta.url)),
    "utf8",
  );
  assert.match(settings, /kind === "web-bridge"/);
  assert.match(settings, /accountCard\(s, "web-bridge"\)/);
  assert.doesNotMatch(settings, /accountCard\(s, "web"\)/);
  assert.match(settings, /settings\.connectFirst/);
  assert.match(settings, /settings\.freebuffChat/);
  assert.match(settings, /settings\.freebuffLoginHint/);
  assert.match(settings, /id="picker-hint"/);
  assert.match(i18n, /settings\.freebuffChat/);
  assert.match(i18n, /settings\.freebuffChatHint/);
  assert.match(i18n, /settings\.freebuffDoctorFail/);
  assert.match(i18n, /live\.freebuffWait/);
  assert.match(i18n, /live\.freebuffQueue/);
  assert.match(settings, /data-web-login/);
  assert.match(settings, /\/settings\/web\/" \+ id \+ "\/login/);
  assert.match(settings, /data-web-logout/);
  assert.match(settings, /data-web-doctor/);
  assert.match(settings, /settings\.freebuffDoctorFail/);
  assert.match(settings, /function webBridgeError/);
  assert.match(settings, /if \(body\.error\)/);
  assert.match(settings, /freebuff_login_required/);
  assert.match(settings, /pendingWeb === id/);
  assert.match(settings, /webBridgeError\(body\.code \|\| body\.error\)/);
  assert.match(settings, /webBridgeError\(body\.error\) \|\| body\.error \|\| "poll failed"/);
  assert.match(settings, /body\.loginUrl/);
  assert.match(settings, /window\.open\(body\.loginUrl/);
  const bridge = readFileSync(
    fileURLToPath(new URL("../src/freebuff-bridge.ts", import.meta.url)),
    "utf8",
  );
  assert.match(bridge, /costMode:\s*"free"/);
  assert.match(bridge, /denyFreebuffRemoteTools/);
  assert.doesNotMatch(bridge, /Input\.insertText/);
  assert.match(settings, /settings\.probeFail/);
  assert.doesNotMatch(settings, /body\.chrome \|\| t\("settings\.probeFail"\)/);
  assert.match(settings, /settings\.webLoginOpened/);
  assert.match(settings, /error\.freebuff_busy/);
  assert.doesNotMatch(settings, /data-web-login.*\/settings\/oauth\//);
});

test("every hall error code has the Freebuff prefix and matching i18n", () => {
  const require = createRequire(import.meta.url);
  const { I18N } = require("../src/public/i18n.js") as {
    I18N: Record<string, Record<string, string>>;
  };
  const codes = Object.keys(FREEBUFF_ERROR_ZH) as FreebuffErrorCode[];
  assert.equal(codes.length, 17);
  for (const code of codes) {
    const text = formatFreebuffError(code);
    assert.match(text, new RegExp(`^模型請求失敗：Freebuff Chat: ${code} — `));
    assert.equal(text, `模型請求失敗：Freebuff Chat: ${code} — ${FREEBUFF_ERROR_ZH[code]}`);
    assert.equal(I18N["zh-Hant"][`error.${code}`], FREEBUFF_ERROR_ZH[code]);
    assert.ok(I18N.en[`error.${code}`]);
    assert.notEqual(I18N.en[`error.${code}`], I18N["zh-Hant"][`error.${code}`]);
  }
  assert.equal(I18N["zh-Hant"]["live.freebuffWait"], FREEBUFF_PROGRESS_WAIT);
  assert.equal(I18N["zh-Hant"]["live.freebuffQueue"], FREEBUFF_PROGRESS_QUEUE);
  assert.equal(I18N["zh-Hant"]["live.freebuffPaste"], FREEBUFF_PROGRESS_PASTE);
  assert.equal(I18N["zh-Hant"]["live.freebuffSend"], FREEBUFF_PROGRESS_SEND);
  assert.equal(I18N["zh-Hant"]["settings.freebuffLoginHint"], FREEBUFF_CHAT_LOGIN_HINT);
  assert.equal(formatFreebuffError("freebuff_login_required").startsWith("模型請求失敗"), true);
});
