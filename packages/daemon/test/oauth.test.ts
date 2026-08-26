import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  formatOAuthError,
  listSubscriptions,
  oauthCredentialFromUnknown,
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

test("formatOAuthError does not call a timeout a dead subscription", () => {
  assert.match(formatOAuthError("xai", "Request timed out."), /不是訂閱失效/);
  assert.doesNotMatch(formatOAuthError("xai", "Request timed out."), /訂閱請求失敗/);
  assert.match(formatOAuthError("xai", "terminated"), /不是訂閱失效/);
  const once = formatOAuthError("xai", "terminated");
  assert.equal(formatOAuthError("xai", once), once);
  assert.doesNotMatch(once, /模型請求失敗：模型請求失敗/);
  assert.match(formatOAuthError("xai", "HTTP 401 unauthorized"), /重新連接/);
  assert.match(formatOAuthError("xai", "spending-limit 402"), /CLI/);
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
