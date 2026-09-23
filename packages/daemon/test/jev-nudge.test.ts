import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runAgentLoop } from "../src/harness.ts";
import {
  decideNudge,
  isJevModel,
  jevNudgeContinue,
  NUDGE_REASON,
  parseNudgeAnswers,
  systemOneUrl,
} from "../src/jev-nudge.ts";

test("parseNudgeAnswers reads noul probabilities", () => {
  assert.deepEqual(
    parseNudgeAnswers({
      answers: {
        nudge: { type: "noul", noul: 0.78 },
        waiting: { type: "noul", noul: 0.1 },
      },
    }),
    { nudge: 0.78, waiting: 0.1 },
  );
  assert.equal(parseNudgeAnswers({ answers: { nudge: { noul: 2 } } }), null);
});

test("decideNudge lets waiting and a stalled follow-up veto", () => {
  assert.equal(decideNudge({ nudge: 0.8, waiting: 0.1 }).nudge, true);
  assert.equal(decideNudge({ nudge: 0.9, waiting: 0.5 }).nudge, false);
  assert.equal(decideNudge({ nudge: 0.4, waiting: 0.1 }).nudge, false);
  assert.equal(
    decideNudge({ nudge: 0.8, waiting: 0.1, progress: 0.2 }).nudge,
    false,
  );
});

test("isJevModel matches System One ids only", () => {
  assert.equal(isJevModel("jev-latest"), true);
  assert.equal(isJevModel("typesafe/jev"), true);
  assert.equal(isJevModel("gpt-5.6-sol"), false);
  assert.equal(
    systemOneUrl("https://api.typesafe.ai/v1"),
    "https://api.typesafe.ai/v1/systemone",
  );
  assert.equal(
    systemOneUrl("https://api.commandcode.ai/provider/v1"),
    "https://api.commandcode.ai/provider/v1/systemone",
  );
});

function seatHome(model: { provider: string; id: string; baseUrl: string; apiKey: string }): string {
  const home = mkdtempSync(join(tmpdir(), "guild-jev-"));
  writeFileSync(
    join(home, "models.json"),
    JSON.stringify({
      aux: { classifier: { provider: model.provider, model: model.id } },
      providers: {
        [model.provider]: {
          baseUrl: model.baseUrl,
          api: "openai-completions",
          apiKey: model.apiKey,
          models: [{ id: model.id }],
        },
      },
    }),
  );
  return home;
}

test("a selected Jev model calls that provider's system one", async () => {
  const home = seatHome({
    provider: "typesafe",
    id: "jev-latest",
    baseUrl: "https://api.typesafe.ai/v1",
    apiKey: "ts-key",
  });
  let url = "";
  let auth = "";
  let model = "";
  const result = await jevNudgeContinue({
    ctx: { dataDir: home, env: {}, userAsks: ["say hi five times"] },
    assistantText: "Hola! 1 of 5",
    toolNames: [],
    marks: [],
    fetch: async (input, init) => {
      url = String(input);
      const headers = init?.headers as Record<string, string>;
      auth = headers.Authorization ?? "";
      model = JSON.parse(String(init?.body)).model;
      return new Response(
        JSON.stringify({
          answers: { nudge: { noul: 0.8 }, waiting: { noul: 0.1 } },
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(auth, "Bearer ts-key");
  assert.equal(model, "jev-latest");
  assert.match(result?.note ?? "", /^jev nudge 80%/);
});

test("a selected LLM imitates Jev instead of calling system one", async () => {
  const home = seatHome({
    provider: "openai",
    id: "gpt-4.1-mini",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
  });
  let saw = "";
  const result = await jevNudgeContinue({
    ctx: { dataDir: home, env: {}, userAsks: ["say hi five times"] },
    assistantText: "Hola! 1 of 5",
    toolNames: [],
    marks: [],
    fetch: async () => {
      throw new Error("system one should not be called");
    },
    complete: async (_system, user) => {
      saw = user;
      return '{"nudge":0.7,"waiting":0.1}';
    },
  });
  assert.match(saw, /Hola/);
  assert.match(result?.note ?? "", /^llm nudge 70%/);
});

test("jevNudgeContinue stays quiet when no model can answer", async () => {
  const home = mkdtempSync(join(tmpdir(), "guild-jev-"));
  writeFileSync(
    join(home, "models.json"),
    JSON.stringify({ providers: {} }),
  );
  let called = 0;
  const result = await jevNudgeContinue({
    ctx: { dataDir: home, env: {} },
    assistantText: "next I'll do the rest",
    toolNames: [],
    marks: [],
    fetch: async () => {
      called += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(result, null);
  assert.equal(called, 0);
});

test("a nudge continues the turn once, then a no stops it", async () => {
  const injected: string[] = [];
  let checks = 0;
  const result = await runAgentLoop({
    toolCtx: {},
    onRetry: (late) => {
      injected.push(late);
    },
    nudge: async () => {
      checks += 1;
      return checks === 1 ? { note: "nudge 78%" } : null;
    },
    ask: async ({ round }) => {
      if (round === 0) return { calls: [], text: "Hola! 1 of 5" };
      return { calls: [], text: "all done" };
    },
  });
  assert.equal(checks, 2);
  assert.deepEqual(injected, [NUDGE_REASON]);
  assert.equal(result?.text, "Hola! 1 of 5\n\nall done");
  assert.equal(result?.traces[0]?.name, "jev");
  assert.equal(result?.traces[0]?.text, "nudge 78%");
});
