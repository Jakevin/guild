import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseClinePassModels } from "../src/cline-pass.ts";
import {
  assembleOpenAiChatStream,
  readModelsFile,
  refreshClinePassCatalog,
  writeModelsFile,
} from "../src/llm.ts";
import { reasoningPayload } from "../src/reasoning-catalog.ts";

test("parseClinePassModels keeps subscription ids", () => {
  const ids = parseClinePassModels({
    clinePass: ["cline-pass/glm-5.3-flash", "gpt-5", { id: "cline-pass/kimi-k3", name: "Kimi K3" }],
  }).map((row) => row.id);
  assert.deepEqual(ids, ["cline-pass/glm-5.3-flash", "cline-pass/kimi-k3"]);
});

test("an existing models file gains Cline Pass without dropping other providers", () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-cline-"));
  writeModelsFile(dir, {
    providers: {
      openai: {
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        api: "openai-completions",
        apiKey: "sk-test",
        models: [{ id: "gpt-4.1-mini" }],
      },
    },
  });
  const file = readModelsFile(dir);
  assert.equal(file.providers.openai?.models[0]?.id, "gpt-4.1-mini");
  assert.equal(file.providers["cline-pass"]?.baseUrl, "https://api.cline.bot/api/v1");
  assert.equal(file.providers["cline-pass"]?.apiKey, "$CLINE_PASS_API_KEY");
  assert.ok(file.providers["cline-pass"]?.models.some((row) => row.id === "cline-pass/glm-5.3-flash"));
});

test("catalog refresh adds a newly published Cline Pass model", async () => {
  const dir = mkdtempSync(join(tmpdir(), "guild-cline-"));
  writeModelsFile(dir, {
    providers: {
      openai: {
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        api: "openai-completions",
        models: [{ id: "gpt-4.1-mini" }],
      },
    },
  });
  const added = await refreshClinePassCatalog(dir, async () =>
    new Response(JSON.stringify({ data: { clinePass: ["cline-pass/new-model"] } }), {
      status: 200,
    }),
  );
  assert.deepEqual(added.added, ["cline-pass/new-model"]);
  const ids = readModelsFile(dir).providers["cline-pass"]?.models.map((row) => row.id) ?? [];
  assert.ok(ids.includes("cline-pass/glm-5.3-flash"));
  assert.ok(ids.includes("cline-pass/new-model"));
});

test("Cline chat SSE keeps text and tool call fragments", () => {
  const message = assembleOpenAiChatStream(
    [
      'data: {"choices":[{"delta":{"content":"pong"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{\\"path\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.ts\\"}"}}]}}]}',
      "data: [DONE]",
    ].join("\n"),
  );
  assert.equal(message.content, "pong");
  assert.equal(message.toolCalls[0]?.name, "read");
  assert.equal(message.toolCalls[0]?.arguments, '{"path":"a.ts"}');
});

test("shared tool-call indexes keep argument deltas on the call that owns the id", () => {
  const message = assembleOpenAiChatStream(
    [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read","arguments":""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_b","function":{"name":"list","arguments":""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\".\\"}"}}]}}]}',
      "data: [DONE]",
    ].join("\n"),
  );
  assert.deepEqual(
    message.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
    [
      { id: "call_a", name: "read", arguments: '{"path":"a.ts"}' },
      { id: "call_b", name: "list", arguments: '{"path":"."}' },
    ],
  );
});

test("Cline Pass sends reasoning_effort only", () => {
  assert.deepEqual(
    reasoningPayload("cline-pass", "https://api.cline.bot/api/v1", "high"),
    { reasoning_effort: "high" },
  );
});
