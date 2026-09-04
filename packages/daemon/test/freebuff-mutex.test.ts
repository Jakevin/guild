import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  acquireFreebuffMutex,
  doctorFreebuff,
  freebuffMutexHeld,
  lastFreebuffTurnForTest,
  resetFreebuffBridgeForTest,
} from "../src/freebuff-bridge.ts";
import {
  FREEBUFF_CHAT_DEFAULT_MODEL,
  FREEBUFF_CHAT_PICKER_ID,
  completeFreebuffChat,
} from "../src/freebuff-chat.ts";
import { HALL_RULES } from "../src/generate.ts";
import { DEFAULT_MODELS, writeModelsFile } from "../src/llm.ts";
import { StoreError } from "../src/store.ts";
import { spawnSubagent } from "../src/subagent.ts";
import { TOOL_SYSTEM } from "../src/tools.ts";
import { fakeSdkPage, hookFakeSdk } from "./freebuff-sdk-harness.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-freebuff-mutex-"));
}

function webBridgeTarget(model = FREEBUFF_CHAT_DEFAULT_MODEL) {
  return {
    providerId: FREEBUFF_CHAT_PICKER_ID,
    model,
    baseUrl: "freebuff-chat",
    apiKey: "session",
    api: "openai-completions" as const,
    transport: "web-bridge" as const,
    sessionReady: true,
  };
}

const lease = {
  roomId: "room-1",
  botId: "bot-1",
  throughId: "none",
  soul: "soul",
  agent: "agent",
  position: "position",
  skillIds: [] as string[],
  channelMd: "",
  botMemory: "",
  channelMemory: "",
  userMessage: "hello there",
  hallRules: HALL_RULES,
};

afterEach(async () => {
  await resetFreebuffBridgeForTest();
});

test("spawnDepth>=1 is freebuff_busy immediately and does not acquire the Chat mutex", async () => {
  const home = tempHome();
  assert.equal(freebuffMutexHeld(), false);
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
    const nested = await completeFreebuffChat({
      dataDir: home,
      target: webBridgeTarget(),
      toolCtx: { spawnDepth: 1 },
    });
    assert.match(nested.text, /freebuff_busy/);
    assert.ok(Date.now() - started < 400);
    assert.equal(freebuffMutexHeld(), true);
  } finally {
    lock.release();
  }
});

test("parent Freebuff + spawn does not hang on the Chat mutex", async () => {
  const home = tempHome();
  const page = fakeSdkPage({
    replies: [
      '```guild_tools\n[{"name":"spawn","args":{"prompt":"survey the tree","title":"look"}}]\n```',
      "parent final",
    ],
  });
  hookFakeSdk(home, page);
  let nestedMs = 0;
  let nestedText = "";
  let heldDuringSpawn = false;
  const started = Date.now();
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: TOOL_SYSTEM,
    messages: [{ role: "user", content: "hello there" }],
    lease,
    toolCtx: {
      dataDir: home,
      spawnDepth: 0,
      allowWrite: true,
      dispatch: async (name, args, ctx) => {
        heldDuringSpawn = freebuffMutexHeld();
        if (name !== "spawn") {
          return { text: `unexpected ${name}`, isError: true };
        }
        const t0 = Date.now();
        const nested = await completeFreebuffChat({
          dataDir: home,
          target: webBridgeTarget(),
          messages: [{ role: "user", content: "child" }],
          toolCtx: { ...ctx, spawnDepth: 1 },
        });
        nestedMs = Date.now() - t0;
        nestedText = nested.text;
        return { text: nested.text, isError: true };
      },
    },
  });
  assert.ok(Date.now() - started < 8_000);
  assert.ok(nestedMs < 400);
  assert.equal(heldDuringSpawn, true);
  assert.match(nestedText, /freebuff_busy/);
  assert.equal(done.text, "parent final");
  assert.equal(freebuffMutexHeld(), false);
  const suffix = page.prompts[1] || lastFreebuffTurnForTest()?.paste || "";
  assert.match(suffix, /<guild_tool_result /);
  assert.match(suffix, /name="spawn"/);
  assert.doesNotMatch(suffix, /hello there/);
  assert.equal(lastFreebuffTurnForTest()?.mode, "C");
});

test("spawnSubagent does not wait on a held Freebuff Chat mutex", async () => {
  const home = tempHome();
  writeModelsFile(home, {
    ...structuredClone(DEFAULT_MODELS),
    default: {
      provider: FREEBUFF_CHAT_PICKER_ID,
      model: FREEBUFF_CHAT_DEFAULT_MODEL,
    },
  });
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "child survey done" }],
          },
        ],
        output_text: "child survey done",
        choices: [{ message: { role: "assistant", content: "child survey done" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  const lock = await acquireFreebuffMutex({ queue: true });
  const started = Date.now();
  try {
    const result = await spawnSubagent({
      prompt: "survey auth",
      ctx: { dataDir: home, env: {}, spawnDepth: 0 },
    });
    assert.ok(Date.now() - started < 4_000);
    assert.equal(freebuffMutexHeld(), true);
    assert.equal(result.isError, false);
    assert.match(result.text, /child survey done/);
    assert.doesNotMatch(result.text, /freebuff_busy/);
  } finally {
    lock.release();
    globalThis.fetch = orig;
  }
});

test("doctor is 409 freebuff_busy while executeToolTraced still holds the mutex", async () => {
  const home = tempHome();
  const page = fakeSdkPage({
    replies: [
      '```guild_tools\n[{"name":"run","args":{"command":"echo mutex-held"}}]\n```',
      "done",
    ],
  });
  hookFakeSdk(home, page);
  let doctorStatus: number | undefined;
  const done = await completeFreebuffChat({
    dataDir: home,
    target: webBridgeTarget(),
    system: TOOL_SYSTEM,
    messages: [{ role: "user", content: "hello there" }],
    lease,
    toolCtx: {
      dataDir: home,
      spawnDepth: 0,
      allowWrite: true,
      dispatch: async (name) => {
        assert.equal(freebuffMutexHeld(), true);
        await assert.rejects(
          () => doctorFreebuff(home),
          (err: unknown) => {
            doctorStatus = err instanceof StoreError ? err.status : undefined;
            return (
              err instanceof StoreError &&
              err.status === 409 &&
              err.message === "freebuff_busy"
            );
          },
        );
        if (name === "run") {
          return { text: "mutex-held\n[exit code: 0]", isError: false };
        }
        return { text: `unexpected ${name}`, isError: true };
      },
    },
  });
  assert.equal(done.text, "done");
  assert.equal(doctorStatus, 409);
  assert.equal(freebuffMutexHeld(), false);
});
