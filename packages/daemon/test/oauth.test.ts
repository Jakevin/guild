import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  copilotIdeHeaders,
  formatOAuthError,
  isCopilotAutoOnlySku,
  listSubscriptions,
  oauthCredentialFromUnknown,
  oauthOmitsTemperature,
  parseCopilotPickerIds,
  isTransientLlmError,
  startStreamIdle,
  STREAM_IDLE_TIMEOUT_MS,
  StreamIdleError,
  withTransientRetries,
  xaiFromGrokAuthFile,
} from "../src/oauth.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-oauth-"));
}

test("parses Grok CLI nested auth.json as xAI oauth", () => {
  const exp = new Date(Date.now() + 3600_000).toISOString();
  const nested = {
    auth_mode: "oidc",
    key: "eyJhbGciOi.fake.access",
    refresh_token: "refresh-token-value",
    expires_at: exp,
  };
  const cred = xaiFromGrokAuthFile({
    "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": nested,
  });
  assert.equal(cred?.type, "oauth");
  assert.equal(cred?.access, "eyJhbGciOi.fake.access");
  assert.equal(cred?.refresh, "refresh-token-value");
  assert.ok((cred?.expires ?? 0) > Date.now() + 3000_000);
});

test("oauthCredentialFromUnknown reads ISO expires_at", () => {
  const exp = new Date(Date.now() + 7200_000).toISOString();
  const cred = oauthCredentialFromUnknown({
    key: "tok",
    refresh_token: "ref",
    expires_at: exp,
    auth_mode: "oidc",
  });
  assert.equal(cred?.type, "oauth");
  if (cred?.type === "oauth") {
    assert.equal(cred.access, "tok");
    assert.ok(Math.abs(cred.expires - Date.parse(exp)) < 1000);
  }
});

test("ChatGPT Codex and Copilot reasoning omit temperature", () => {
  assert.equal(oauthOmitsTemperature({ provider: "openai-codex" }), true);
  assert.equal(
    oauthOmitsTemperature({ provider: "github-copilot", copilotSession: true }),
    true,
  );
  assert.equal(
    oauthOmitsTemperature({ provider: "github-copilot", modelReasoning: true }),
    true,
  );
  assert.equal(
    oauthOmitsTemperature({ provider: "github-copilot", modelReasoning: false }),
    false,
  );
  assert.equal(oauthOmitsTemperature({ provider: "xai" }), false);
});

test("OAuth llmComplete rethrows AbortError instead of formatting a timeout", () => {
  const src = readFileSync(new URL("../src/llm.ts", import.meta.url), "utf8");
  const oauthArm = src.slice(src.indexOf("OAUTH_PICKER_IDS.has(target.providerId)"));
  const catchArm = oauthArm.slice(oauthArm.indexOf("} catch (error) {"));
  assert.match(
    catchArm.slice(0, 280),
    /if \(error instanceof Error && error.name === "AbortError"\) throw error/,
  );
  assert.match(formatOAuthError("xai", "aborted"), /逾時/);
});

test("formatOAuthError does not call a timeout a dead subscription", () => {
  assert.match(formatOAuthError("xai", "Request timed out."), /不是訂閱失效/);
  assert.doesNotMatch(formatOAuthError("xai", "Request timed out."), /訂閱請求失敗/);
  assert.match(formatOAuthError("xai", "terminated"), /不是訂閱失效/);
  const once = formatOAuthError("xai", "terminated");
  assert.equal(formatOAuthError("xai", once), once);
  assert.doesNotMatch(once, /模型請求失敗：模型請求失敗/);
  assert.match(formatOAuthError("xai", "HTTP 401 unauthorized"), /重新連接/);
  assert.match(formatOAuthError("xai", "spending-limit 402"), /CLI/);
  assert.match(
    formatOAuthError(
      "github-copilot",
      'OpenAI API error (400): {"message":"The requested model is not supported.","code":"model_not_supported"}',
    ),
    /Copilot 帳號不支援/,
  );
});

test("GitHub Copilot picker only lists models the account enabled", () => {
  const dataDir = tempHome();
  writeFileSync(
    join(dataDir, "oauth.json"),
    `${JSON.stringify(
      {
        "github-copilot": {
          type: "oauth",
          access: "copilot-access",
          refresh: "copilot-refresh",
          expires: Date.now() + 3600_000,
          availableModelIds: ["gpt-4.1", "claude-sonnet-4"],
        },
      },
      null,
      2,
    )}\n`,
  );
  const copilot = listSubscriptions(dataDir).find(
    (item) => item.id === "github-copilot",
  );
  assert.ok(copilot);
  const ids = copilot.models.map((row) => row.id);
  assert.ok(ids.includes("gpt-4.1"));
  assert.ok(ids.includes("claude-sonnet-4"));
  assert.ok(!ids.includes("gpt-5.6-luna"));
});

test("Copilot SKU drops models restricted to other plans", () => {
  const raw = {
    data: [
      {
        id: "gpt-4.1",
        model_picker_enabled: false,
        policy: { state: "enabled" },
        capabilities: { supports: { tool_calls: true } },
        billing: {},
      },
      {
        id: "gpt-5.6-luna",
        model_picker_enabled: false,
        policy: { state: "enabled" },
        capabilities: { supports: { tool_calls: true } },
        billing: {
          restricted_to: ["free", "edu", "pro", "pro_plus"],
        },
      },
    ],
  };
  const ids = parseCopilotPickerIds(raw, true, "free_educational_quota");
  assert.deepEqual(ids, ["gpt-4.1"]);
});

test("Copilot IDE headers include API version and session token", () => {
  const base = copilotIdeHeaders();
  assert.equal(base["X-GitHub-Api-Version"], "2026-06-01");
  assert.equal(base["Editor-Version"], "vscode/1.107.0");
  assert.equal(base["Copilot-Integration-Id"], "vscode-chat");
  assert.equal(base["Copilot-Session-Token"], undefined);
  assert.equal(copilotIdeHeaders("sess")["Copilot-Session-Token"], "sess");
});

test("Copilot Free/Student SKUs are auto-only", () => {
  assert.equal(isCopilotAutoOnlySku("free_educational_quota"), true);
  assert.equal(isCopilotAutoOnlySku("free"), true);
  assert.equal(isCopilotAutoOnlySku("student"), true);
  assert.equal(isCopilotAutoOnlySku("copilot_pro"), false);
  assert.equal(isCopilotAutoOnlySku("individual_trial"), false);
  const dataDir = tempHome();
  writeFileSync(
    join(dataDir, "oauth.json"),
    `${JSON.stringify(
      {
        "github-copilot": {
          type: "oauth",
          access: "tid=x;sku=free_educational_quota;exp=1",
          refresh: "r",
          expires: Date.now() + 3600_000,
          availableModelIds: ["gpt-4.1", "gpt-5.6-luna"],
        },
      },
      null,
      2,
    )}\n`,
  );
  const copilot = listSubscriptions(dataDir).find((item) => item.id === "github-copilot");
  assert.deepEqual(copilot?.models, [{ id: "auto", name: "Auto" }]);
});

test("Pi leftover OAuth slots are Kimi Code and Radius", () => {
  const dataDir = tempHome();
  const list = listSubscriptions(dataDir);
  const ids = list.map((item) => item.id);
  assert.ok(ids.includes("kimi-coding"));
  assert.ok(ids.includes("radius"));
  const kimi = list.find((item) => item.id === "kimi-coding");
  assert.equal(kimi?.pickerId, "kimi-coding-oauth");
  assert.equal(kimi?.flow, "device");
  const kimiIds = (kimi?.models ?? []).map((row) => row.id);
  assert.ok(kimiIds.includes("kimi-for-coding"));
  assert.ok(kimiIds.includes("k3"));
  const radius = list.find((item) => item.id === "radius");
  assert.equal(radius?.pickerId, "radius-oauth");
  assert.equal(radius?.flow, "device");
  assert.deepEqual(radius?.models, []);
});

test("Radius reuses stored catalog ids before the gateway refresh", () => {
  const dataDir = tempHome();
  writeFileSync(
    join(dataDir, "oauth.json"),
    `${JSON.stringify(
      {
        radius: {
          type: "oauth",
          access: "radius-access",
          refresh: "radius-refresh",
          expires: Date.now() + 3600_000,
          availableModelIds: ["pi-gpt", "pi-claude"],
        },
      },
      null,
      2,
    )}\n`,
  );
  const radius = listSubscriptions(dataDir).find((item) => item.id === "radius");
  assert.deepEqual(radius?.models, [
    { id: "pi-gpt", name: "pi-gpt" },
    { id: "pi-claude", name: "pi-claude" },
  ]);
});

test("xai stays ready when access is expired but refresh exists", () => {
  const dataDir = tempHome();
  writeFileSync(
    join(dataDir, "oauth.json"),
    `${JSON.stringify(
      {
        xai: {
          type: "oauth",
          access: "expired-access",
          refresh: "still-valid-refresh",
          expires: Date.now() - 60_000,
        },
      },
      null,
      2,
    )}\n`,
  );
  const xai = listSubscriptions(dataDir).find((item) => item.id === "xai");
  assert.ok(xai);
  assert.equal(xai.connected, true);
  assert.equal(xai.ready, true);
});

test("transient LLM errors retry; idle and Stop do not", async () => {
  assert.equal(isTransientLlmError(new Error("fetch failed")), true);
  assert.equal(isTransientLlmError(new Error("HTTP 503")), true);
  assert.equal(isTransientLlmError(new Error("openai-codex returned an empty reply")), true);
  assert.equal(isTransientLlmError(new StreamIdleError(300_000)), false);
  const stop = new Error("aborted");
  stop.name = "AbortError";
  assert.equal(isTransientLlmError(stop), false);
  let hits = 0;
  const value = await withTransientRetries(async () => {
    hits += 1;
    if (hits < 3) throw new Error("ECONNRESET");
    return "ok";
  });
  assert.equal(value, "ok");
  assert.equal(hits, 3);
});

test("stream idle is Codex 300s, not a turn wall clock", () => {
  assert.equal(STREAM_IDLE_TIMEOUT_MS, 300_000);
  const err = new StreamIdleError(STREAM_IDLE_TIMEOUT_MS);
  assert.equal(err.name, "StreamIdleError");
  assert.match(err.message, /300s/);
  assert.match(err.message, /not a turn wall clock/);
});

test("stream idle watchdog fires when no events arrive", async () => {
  const idle = startStreamIdle(40);
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(idle.timedOut(), true);
    assert.equal(idle.signal.aborted, true);
  } finally {
    idle.dispose();
  }
});

test("stream idle bump resets the watchdog; user Stop is not idle", async () => {
  const idle = startStreamIdle(80);
  try {
    await new Promise((resolve) => setTimeout(resolve, 40));
    idle.bump();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(idle.timedOut(), false);
    assert.equal(idle.signal.aborted, false);
  } finally {
    idle.dispose();
  }
  const parent = new AbortController();
  const child = startStreamIdle(5_000, parent.signal);
  try {
    parent.abort();
    assert.equal(child.signal.aborted, true);
    assert.equal(child.timedOut(), false);
  } finally {
    child.dispose();
  }
});
