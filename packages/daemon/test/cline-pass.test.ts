import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseClinePassModels } from "../src/cline-pass.ts";
import { readModelsFile, refreshClinePassCatalog, writeModelsFile } from "../src/llm.ts";
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

test("Cline Pass sends reasoning_effort only", () => {
  assert.deepEqual(
    reasoningPayload("cline-pass", "https://api.cline.bot/api/v1", "high"),
    { reasoning_effort: "high" },
  );
});
