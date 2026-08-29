import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
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
