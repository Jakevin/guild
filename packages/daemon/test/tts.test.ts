import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeTool, guildTools, TOOL_SYSTEM } from "../src/tools.ts";
import { gateTool } from "../src/harness.ts";
import {
  DEFAULT_VOICE,
  TTS_TEXT_CAP,
  TTS_TIMEOUT_MS,
  escapeSsml,
  generateSecMsGec,
  generateSpeech,
  pickVoice,
  resetTtsClockSkew,
  splitBinaryFrame,
} from "../src/tts.ts";

test("tts is a builtin tool and workspace_write hides it", () => {
  assert.match(TOOL_SYSTEM, /\btts\b/);
  assert.ok(guildTools([]).some((tool) => tool.name === "tts"));
  const names = guildTools([], {
    sandbox: "workspace_write",
    workspace: tmpdir(),
  }).map((tool) => tool.name);
  assert.ok(!names.includes("tts"));
  const refused = gateTool("tts", { text: "hi" }, {
    sandbox: "workspace_write",
    workspace: tmpdir(),
  });
  assert.ok(refused);
  assert.match(refused.text, /workspace_write refused tts/);
});

test("tts abort is AbortError and does not hit the network", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-tts-abort-"));
  const ctrl = new AbortController();
  ctrl.abort();
  const started = Date.now();
  await assert.rejects(
    () => generateSpeech({ text: "hi", dataDir: dir, signal: ctrl.signal }),
    (err: unknown) => err instanceof Error && err.name === "AbortError",
  );
  await assert.rejects(
    () =>
      executeTool("tts", { text: "hi" }, { dataDir: dir, signal: ctrl.signal }),
    (err: unknown) => err instanceof Error && err.name === "AbortError",
  );
  assert.ok(Date.now() - started < 1_000);
});

test("tts requires text", async () => {
  const result = await executeTool("tts", { text: "" });
  assert.equal(result.isError, true);
  assert.match(result.text, /empty argument/);
});

test("tts text cap is local and does not hit the network", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-tts-"));
  const started = Date.now();
  const result = await generateSpeech({
    text: "あ".repeat(TTS_TEXT_CAP + 1),
    dataDir: dir,
  });
  assert.equal(result.isError, true);
  assert.match(result.text, /too long/);
  assert.ok(Date.now() - started < 1_000);
});

test("Sec-MS-GEC is a 64-char hex and stable inside a 300s window", () => {
  resetTtsClockSkew();
  const base = 1_700_000_000 - (1_700_000_000 % 300);
  const a = generateSecMsGec(base);
  const b = generateSecMsGec(base + 299);
  const c = generateSecMsGec(base + 300);
  assert.match(a, /^[0-9A-F]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.doesNotMatch(a, /e\+/i);
});

test("pickVoice aliases, Neural ids, and script hints", () => {
  assert.equal(pickVoice("ja", "hello"), "ja-JP-NanamiNeural");
  assert.equal(pickVoice("nanami"), "ja-JP-NanamiNeural");
  assert.equal(pickVoice("keita"), "ja-JP-KeitaNeural");
  assert.equal(pickVoice("zh"), "zh-TW-HsiaoChenNeural");
  assert.equal(pickVoice("zh-cn"), "zh-CN-XiaoxiaoNeural");
  assert.equal(pickVoice("ja-JP-NanamiNeural"), "ja-JP-NanamiNeural");
  assert.equal(pickVoice("", "こんにちは"), "ja-JP-NanamiNeural");
  assert.equal(pickVoice("", "你好"), "zh-TW-HsiaoChenNeural");
  assert.equal(pickVoice("", "hello"), DEFAULT_VOICE);
});

test("escapeSsml strips controls and escapes markup", () => {
  assert.equal(escapeSsml("a&b<c>\"'"), "a&amp;b&lt;c&gt;&quot;&apos;");
  assert.equal(escapeSsml("ok\u0000x"), "ok x");
});

test("splitBinaryFrame uses the 2-byte header length prefix", () => {
  const header = Buffer.from("Path:audio\r\n");
  const body = Buffer.from("ABC");
  const frame = Buffer.concat([
    Buffer.from([(header.length >> 8) & 0xff, header.length & 0xff]),
    header,
    body,
  ]);
  const parsed = splitBinaryFrame(frame);
  assert.equal(parsed?.path, "audio");
  assert.equal(parsed?.body.toString(), "ABC");
});

test("tts timeout is a stream fuse, not a 5-minute LLM wall clock", () => {
  assert.equal(TTS_TIMEOUT_MS, 30_000);
  const oauth = readFileSync(new URL("../src/oauth.ts", import.meta.url), "utf8");
  assert.doesNotMatch(oauth, /LLM_ROUND_TIMEOUT_MS/);
});
