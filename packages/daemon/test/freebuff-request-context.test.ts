import assert from "node:assert/strict";
import { test } from "node:test";
import { isFreebuffChatCompletionsUrl } from "../src/freebuff-request-context.ts";

function allows(raw: string): boolean {
  return isFreebuffChatCompletionsUrl(new URL(raw));
}

test("freebuff chat metadata host is the domain, not a lookalike suffix", () => {
  assert.equal(allows("https://codebuff.com/api/v1/chat/completions"), true);
  assert.equal(allows("https://api.codebuff.com/api/v1/chat/completions"), true);
  assert.equal(allows("https://freebuff.com/api/v1/chat/completions"), true);
  assert.equal(allows("https://www.freebuff.com/api/v1/chat/completions"), true);
  assert.equal(allows("http://localhost/api/v1/chat/completions"), true);
  assert.equal(allows("http://127.0.0.1:8787/api/v1/chat/completions"), true);
  assert.equal(allows("http://[::1]/api/v1/chat/completions"), true);
  assert.equal(
    isFreebuffChatCompletionsUrl({
      hostname: "::1",
      pathname: "/api/v1/chat/completions",
    } as URL),
    true,
  );
  assert.equal(allows("https://evilcodebuff.com/api/v1/chat/completions"), false);
  assert.equal(allows("https://notfreebuff.com/api/v1/chat/completions"), false);
  assert.equal(allows("https://codebuff.com.evil.example/api/v1/chat/completions"), false);
  assert.equal(allows("https://freebuff.com/other"), false);
});
