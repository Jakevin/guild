import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  clampEffort,
  fromModelsDevModel,
  fromOpenRouterModel,
  reasoningFor,
  reasoningPayload,
  resetReasoningCatalog,
  setReasoningCatalogForTests,
} from "../src/reasoning-catalog.ts";
import { publicModels, writeModelsFile } from "../src/llm.ts";

const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);
const SETTINGS_HTML = fileURLToPath(
  new URL("../src/public/settings.html", import.meta.url),
);

test("OpenRouter reasoning object becomes the picker list", () => {
  const spec = fromOpenRouterModel({
    id: "x-ai/grok-4.6",
    reasoning: {
      mandatory: true,
      default_enabled: true,
      supported_efforts: ["xhigh", "high", "medium", "low"],
      default_effort: "high",
    },
  });
  assert.deepEqual(spec?.supportedEfforts, ["xhigh", "high", "medium", "low"]);
  assert.equal(spec?.defaultEffort, "high");
  assert.equal(spec?.mandatory, true);
  assert.equal(clampEffort("minimal", spec), "high");
  assert.equal(clampEffort("xhigh", spec), "xhigh");
  assert.equal(clampEffort("none", spec), "high");
  assert.equal(clampEffort("low", spec, true), "low");
});

test("models.dev effort values are not a hardcoded four-pack", () => {
  const luna = fromModelsDevModel({
    reasoning: true,
    reasoning_options: [
      {
        type: "effort",
        values: ["none", "low", "medium", "high", "xhigh", "max"],
      },
    ],
  });
  assert.deepEqual(luna?.supportedEfforts, [
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  assert.equal(luna?.mandatory, false);
  assert.equal(clampEffort("minimal", luna), "high");
  assert.equal(clampEffort("max", luna), "max");

  const grok45 = fromModelsDevModel({
    reasoning: true,
    reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
  });
  assert.deepEqual(grok45?.supportedEfforts, ["low", "medium", "high"]);
  assert.equal(grok45?.mandatory, true);
  assert.equal(clampEffort(undefined, grok45), "high");

  const off = fromModelsDevModel({ reasoning: false });
  assert.equal(off, undefined);

  const thinkOnly = fromModelsDevModel({
    reasoning: true,
    reasoning_options: [],
  });
  assert.equal(thinkOnly?.supportedEfforts, undefined);
  assert.equal(clampEffort("high", thinkOnly), undefined);
});

test("reasoningFor maps xai-oauth grok-4.6 and openrouter slugs", () => {
  resetReasoningCatalog();
  setReasoningCatalogForTests({
    dev: {
      xai: {
        models: {
          "grok-4.6": {
            reasoning: true,
            reasoning_options: [
              { type: "effort", values: ["low", "medium", "high", "xhigh"] },
            ],
          },
          "grok-4.5": {
            reasoning: true,
            reasoning_options: [
              { type: "effort", values: ["low", "medium", "high"] },
            ],
          },
        },
      },
      openai: {
        models: {
          "gpt-5.6-luna": {
            reasoning: true,
            reasoning_options: [
              {
                type: "effort",
                values: ["none", "low", "medium", "high", "xhigh", "max"],
              },
            ],
          },
        },
      },
    },
    openrouter: {
      data: [
        {
          id: "x-ai/grok-4.6",
          reasoning: {
            mandatory: true,
            supported_efforts: ["xhigh", "high", "medium", "low"],
            default_effort: "high",
          },
        },
      ],
    },
  });
  assert.deepEqual(reasoningFor("xai", "grok-4.6")?.supportedEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.deepEqual(reasoningFor("xai-oauth", "grok-4.6")?.supportedEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.ok(!reasoningFor("xai", "grok-4.5")?.supportedEfforts?.includes("xhigh"));
  assert.ok(reasoningFor("openai", "gpt-5.6-luna")?.supportedEfforts?.includes("max"));
  assert.deepEqual(
    reasoningFor("openrouter", "x-ai/grok-4.6")?.supportedEfforts,
    ["xhigh", "high", "medium", "low"],
  );
  assert.deepEqual(reasoningPayload("xai", "https://api.x.ai/v1", "xhigh"), {
    reasoning_effort: "xhigh",
    reasoning: { effort: "xhigh" },
  });
  assert.deepEqual(
    reasoningPayload("openrouter", "https://openrouter.ai/api/v1", "high"),
    { reasoning: { effort: "high" } },
  );
  resetReasoningCatalog();
});

test("publicModels stamps catalog efforts onto picker rows", () => {
  resetReasoningCatalog();
  setReasoningCatalogForTests({
    dev: {
      xai: {
        models: {
          "grok-4.6": {
            reasoning: true,
            reasoning_options: [
              { type: "effort", values: ["low", "medium", "high", "xhigh"] },
            ],
          },
        },
      },
    },
  });
  const home = mkdtempSync(join(tmpdir(), "guild-reason-"));
  writeModelsFile(home, {
    default: { provider: "xai", model: "grok-4.6" },
    reasoning: "xhigh",
    providers: {
      xai: {
        name: "xAI",
        baseUrl: "https://api.x.ai/v1",
        api: "openai-completions",
        apiKey: "xai-test",
        models: [{ id: "grok-4.6", name: "Grok 4.6" }],
      },
    },
  });
  const listed = publicModels(home, { XAI_API_KEY: "xai-test" });
  const xai = listed.picker.find((row) => row.id === "xai");
  const grok = xai?.models.find((row) => row.id === "grok-4.6");
  assert.deepEqual(grok?.reasoning?.supportedEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.equal(listed.reasoning, "xhigh");
  resetReasoningCatalog();
});

test("chat and settings pickers fill efforts from the model, not four hardcoded options", () => {
  const chat = readFileSync(CHAT_HTML, "utf8");
  const settings = readFileSync(SETTINGS_HTML, "utf8");
  assert.match(chat, /function effortChoices/);
  assert.match(chat, /supportedEfforts/);
  assert.match(chat, /activeReasoningSpec/);
  assert.match(chat, /next\.reasoning = reason/);
  assert.match(chat, /ref && ref.reasoning/);
  assert.doesNotMatch(
    chat.slice(chat.indexOf("async function applyChatModel"), chat.indexOf("const modelPop")),
    /reasoning:\s*document\.getElementById\("model-reasoning"\)/,
  );
  assert.doesNotMatch(
    chat.slice(chat.indexOf("model-reason-list"), chat.indexOf("model-speed-list")),
    /\["minimal", t\("reason.min"\)\]/,
  );
  assert.match(settings, /function fillReasoning/);
  assert.match(settings, /supportedEfforts/);
  assert.doesNotMatch(settings, /<option value="minimal">Minimal<\/option>/);
});
