import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  ANTIGRAVITY_PICKER_ID,
  agyModelId,
  effortFromAgyId,
  isAllowedAgyModel,
  isAntigravityProvider,
  parseAgyModels,
  refreshAntigravityCatalog,
  routeId,
  setAntigravityHooksForTest,
} from "../src/antigravity.ts";
import {
  AGY_PRINT_TIMEOUT,
  agyCliArgs,
  agyModeForSandbox,
  buildAgyChatPrompt,
  completeAntigravity,
  parseAgyLine,
  setAntigravityGenerateHooksForTest,
} from "../src/antigravity-generate.ts";
import { publicModels, resolveLlm } from "../src/llm.ts";
import { reasoningFor } from "../src/reasoning-catalog.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-agy-"));
}

test("Antigravity picker ids and Gemini 3.8 Flash allow-list", () => {
  assert.equal(ANTIGRAVITY_PICKER_ID, "antigravity");
  assert.equal(isAntigravityProvider("antigravity"), true);
  assert.equal(isAntigravityProvider("agy"), true);
  assert.equal(isAntigravityProvider("commandcode"), false);
  assert.equal(routeId("gemini-3.8-flash-low"), "antigravity/gemini-3.8-flash-low");
  assert.equal(agyModelId("antigravity/gemini-3.8-flash-low"), "gemini-3.8-flash-low");
  assert.equal(isAllowedAgyModel("gemini-3.8-flash-low"), true);
  assert.equal(isAllowedAgyModel("gemini-3.8-flash-high"), true);
  assert.equal(isAllowedAgyModel("gemini-2.5-flash"), false);
  assert.equal(isAllowedAgyModel("claude-sonnet-4-6"), false);
  assert.equal(effortFromAgyId("gemini-3.8-flash-low"), "low");
  assert.equal(effortFromAgyId("gemini-3.8-flash-high"), "high");
});

test("parses agy models table and stream-json events", () => {
  const models = parseAgyModels(
    "gemini-3.8-flash-low    Gemini 3.8 Flash (Low)\nclaude-sonnet-4-6  Claude Sonnet 4.6 (Thinking)",
  );
  assert.deepEqual(
    models.map((row) => row.id),
    ["gemini-3.8-flash-low", "claude-sonnet-4-6"],
  );
  assert.equal(parseAgyLine('{"event":"step_update","step_update":{"text_delta":"ok"}}').kind, "step");
  assert.equal(parseAgyLine('{"event":"result","result":{"status":"SUCCESS"}}').kind, "result");
  assert.equal(parseAgyLine("not json").kind, "unknown");
});

test("catalog refresh keeps the Gemini 3.8 Flash allow-list", async () => {
  const home = tempHome();
  setAntigravityHooksForTest({
    ready: true,
    runModels: async () =>
      "gemini-3.8-flash-low  Gemini 3.8 Flash (Low)\nclaude-sonnet-4-6  Claude\ngemini-2.5-flash  old\n",
  });
  try {
    const models = await refreshAntigravityCatalog(home);
    assert.deepEqual(
      models.map((row) => row.id),
      ["gemini-3.8-flash-low"],
    );
  } finally {
    setAntigravityHooksForTest();
  }
});

test("completeAntigravity maps stream-json and honors Stop", async () => {
  const traces: string[] = [];
  setAntigravityGenerateHooksForTest({
    spawnTurn: async ({ prompt, onEvent, signal }) => {
      assert.match(prompt, /System instructions/);
      assert.match(prompt, /hello from guild/);
      onEvent?.({ kind: "step", step: { kind: "think", text_delta: "hmm" } });
      if (signal?.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      onEvent?.({
        kind: "result",
        result: { status: "SUCCESS", response: "AGY_OK" },
      });
      return { text: "AGY_OK" };
    },
  });
  try {
    const done = await completeAntigravity({
      model: "antigravity/gemini-3.8-flash-low",
      system: "You are a bot.",
      messages: [{ role: "user", content: "hello from guild" }],
      ctx: {
        onProgress: (update) => {
          traces.push((update.traces || []).map((row) => row.name).join(","));
        },
      },
    });
    assert.equal(done.text, "AGY_OK");
    assert.ok(traces.some((row) => row.includes("think")));
    const ac = new AbortController();
    ac.abort();
    setAntigravityGenerateHooksForTest({
      spawnTurn: async ({ signal }) => {
        if (signal?.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        return { text: "nope" };
      },
    });
    await assert.rejects(
      completeAntigravity({
        model: "gemini-3.8-flash-low",
        system: "",
        messages: [{ role: "user", content: "x" }],
        ctx: { signal: ac.signal },
      }),
      (err: unknown) =>
        Boolean(err && typeof err === "object" && "name" in err && err.name === "AbortError"),
    );
  } finally {
    setAntigravityGenerateHooksForTest();
  }
});

test("agy print wait is not the 5m default", () => {
  const args = agyCliArgs({
    model: "gemini-3.8-flash-medium",
    mode: "accept-edits",
    skipPermissions: true,
    terminalSandbox: true,
    effort: "medium",
    cwd: "/tmp",
  });
  const i = args.indexOf("--print-timeout");
  assert.ok(i >= 0);
  assert.equal(args[i + 1], AGY_PRINT_TIMEOUT);
  assert.notEqual(args[i + 1], "5m0s");
  assert.notEqual(args[i + 1], "5m");
});

test("agy mode follows Guild sandbox: plan only for read_only", () => {
  assert.deepEqual(agyModeForSandbox("read_only"), {
    mode: "plan",
    skipPermissions: false,
    terminalSandbox: false,
  });
  assert.deepEqual(agyModeForSandbox("workspace_write"), {
    mode: "accept-edits",
    skipPermissions: true,
    terminalSandbox: true,
  });
  assert.deepEqual(agyModeForSandbox("full_access"), {
    mode: "accept-edits",
    skipPermissions: true,
    terminalSandbox: false,
  });
  assert.deepEqual(agyModeForSandbox(undefined), agyModeForSandbox("workspace_write"));
});

test("buildAgyChatPrompt keeps system then turns", () => {
  assert.match(
    buildAgyChatPrompt("sys", [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ]),
    /System instructions:\nsys\n\nUser:\nu1\n\nAssistant:\na1/,
  );
});

test("publicModels lists Antigravity when agy is ready; resolveLlm uses the CLI transport", () => {
  const home = tempHome();
  setAntigravityHooksForTest({ ready: false });
  try {
    const cold = publicModels(home, {});
    const row = cold.picker.find((item) => item.id === ANTIGRAVITY_PICKER_ID);
    assert.ok(row);
    assert.equal(row?.ready, false);
    assert.equal(cold.antigravity?.kind, "antigravity");
    assert.equal(resolveLlm(home, {}, "chat", { provider: "antigravity", model: "gemini-3.8-flash-low" }), null);
    setAntigravityHooksForTest({ ready: true });
    const hot = publicModels(home, {});
    assert.equal(hot.picker.find((item) => item.id === ANTIGRAVITY_PICKER_ID)?.ready, true);
    const target = resolveLlm(home, {}, "chat", {
      provider: "antigravity",
      model: "gemini-3.8-flash-low",
    });
    assert.equal(target?.transport, "antigravity");
    assert.equal(target?.providerId, ANTIGRAVITY_PICKER_ID);
    assert.equal(target?.model, "antigravity/gemini-3.8-flash-low");
  } finally {
    setAntigravityHooksForTest();
  }
});

test("Antigravity does not borrow models.dev effort lists", () => {
  assert.equal(reasoningFor("antigravity", "gemini-3.8-flash-low"), undefined);
});

test("settings card syncs Antigravity from agy models", () => {
  const settings = readFileSync(
    fileURLToPath(new URL("../src/public/settings.html", import.meta.url)),
    "utf8",
  );
  const i18n = readFileSync(
    fileURLToPath(new URL("../src/public/i18n.js", import.meta.url)),
    "utf8",
  );
  assert.match(settings, /data-agy-sync/);
  assert.match(settings, /\/settings\/antigravity\/sync/);
  assert.match(settings, /kind === "antigravity"/);
  assert.match(i18n, /settings\.antigravityHint/);
  assert.match(settings, /i18n\.js\?v=agy/);
});
