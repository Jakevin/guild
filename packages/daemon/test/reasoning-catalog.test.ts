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
  resolveReasoning,
  reasoningPayload,
  resetReasoningCatalog,
  sanitizeModelReasoning,
  setReasoningCatalogForTests,
} from "../src/reasoning-catalog.ts";
import { publicModels, writeModelsFile } from "../src/llm.ts";

const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);
const CHAT_CSS = fileURLToPath(
  new URL("../src/public/chat.css", import.meta.url),
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
  assert.equal(luna?.defaultEffort, "medium");
  assert.equal(clampEffort("minimal", luna), "medium");
  assert.equal(clampEffort("max", luna), "max");

  const grok45 = fromModelsDevModel({
    reasoning: true,
    reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
  });
  assert.deepEqual(grok45?.supportedEfforts, ["low", "medium", "high"]);
  assert.equal(grok45?.mandatory, true);
  assert.equal(grok45?.defaultEffort, "medium");
  assert.equal(clampEffort(undefined, grok45), "medium");

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

test("API key providers resolve efforts via models.dev id and baseUrl like Pi/Hermes", () => {
  resetReasoningCatalog();
  setReasoningCatalogForTests({
    dev: {
      "alibaba-token-plan": {
        models: {
          "qwen3.8-flash": {
            reasoning: true,
            reasoning_options: [
              { type: "effort", values: ["low", "medium", "high", "max"] },
            ],
          },
        },
      },
      xiaomi: {
        models: {
          "mimo-v2.5": {
            reasoning: true,
            reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
          },
        },
      },
      groq: {
        models: {
          "llama-3.3-70b-versatile": {
            reasoning: false,
          },
        },
      },
    },
  });
  const tokenPlan = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
  assert.deepEqual(
    reasoningFor("qwen", "qwen3.8-flash", tokenPlan)?.supportedEfforts,
    ["low", "medium", "high", "max"],
  );
  assert.deepEqual(
    reasoningFor("bai", "mimo-v2.5", "https://api.b.ai/v1")?.supportedEfforts,
    ["low", "medium", "high"],
  );
  assert.equal(
    reasoningFor("groq", "llama-3.3-70b-versatile")?.supportedEfforts,
    undefined,
  );
  resetReasoningCatalog();
});

test("Command Code does not borrow models.dev effort lists", () => {
  resetReasoningCatalog();
  setReasoningCatalogForTests({
    dev: {
      anthropic: {
        models: {
          "claude-sonnet-5": {
            reasoning: true,
            reasoning_options: [
              { type: "effort", values: ["low", "medium", "high", "max"] },
            ],
          },
        },
      },
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
  assert.equal(reasoningFor("commandcode", "claude-sonnet-5"), undefined);
  assert.equal(reasoningFor("commandcode", "grok-4.6"), undefined);
  assert.equal(reasoningFor("command-code", "claude-sonnet-5"), undefined);
  assert.deepEqual(reasoningFor("xai-oauth", "grok-4.6")?.supportedEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
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

test("publicModels stamps key-provider efforts from models.dev via picker id and baseUrl", () => {
  resetReasoningCatalog();
  setReasoningCatalogForTests({
    dev: {
      "alibaba-token-plan": {
        models: {
          "qwen3.8-flash": {
            reasoning: true,
            reasoning_options: [
              { type: "effort", values: ["low", "medium", "high", "max"] },
            ],
          },
        },
      },
      xiaomi: {
        models: {
          "mimo-v2.5": {
            reasoning: true,
            reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
          },
        },
      },
      anthropic: {
        models: {
          "claude-sonnet-5": {
            reasoning: true,
            reasoning_options: [
              { type: "effort", values: ["low", "medium", "high", "max"] },
            ],
          },
        },
      },
    },
  });
  const home = mkdtempSync(join(tmpdir(), "guild-reason-key-"));
  writeModelsFile(home, {
    default: { provider: "qwen", model: "qwen3.8-flash" },
    providers: {
      qwen: {
        name: "Qwen",
        baseUrl:
          "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
        api: "openai-completions",
        apiKey: "qwen-test",
        models: [{ id: "qwen3.8-flash", name: "qwen3.8-flash" }],
      },
      bai: {
        name: "BAI",
        baseUrl: "https://api.b.ai/v1",
        api: "openai-completions",
        apiKey: "bai-test",
        models: [
          { id: "mimo-v2.5", name: "mimo-v2.5" },
          { id: "glm-5.3-flash", name: "glm-5.3-flash" },
        ],
      },
    },
  });
  const listed = publicModels(home);
  const qwen = listed.picker
    .find((row) => row.id === "qwen")
    ?.models.find((row) => row.id === "qwen3.8-flash");
  const mimo = listed.picker
    .find((row) => row.id === "bai")
    ?.models.find((row) => row.id === "mimo-v2.5");
  const glm = listed.picker
    .find((row) => row.id === "bai")
    ?.models.find((row) => row.id === "glm-5.3-flash");
  assert.deepEqual(qwen?.reasoning?.supportedEfforts, [
    "low",
    "medium",
    "high",
    "max",
  ]);
  assert.deepEqual(mimo?.reasoning?.supportedEfforts, ["low", "medium", "high"]);
  // Mixed BAI gateway: only the lab mapped from host/id (xiaomi). Do not
  // slug-scan zai/tencent the way Command Code must not borrow Anthropic.
  assert.equal(glm?.reasoning, undefined);
  resetReasoningCatalog();
});

test("manual efforts fill a catalog miss; catalog list still wins", () => {
  resetReasoningCatalog();
  setReasoningCatalogForTests({
    dev: {
      xiaomi: {
        models: {
          "mimo-v2.5": {
            reasoning: true,
            reasoning_options: [{ type: "toggle" }],
          },
        },
      },
      "alibaba-token-plan": {
        models: {
          "qwen3.8-flash": {
            reasoning: true,
            reasoning_options: [
              { type: "effort", values: ["low", "medium", "xhigh"] },
            ],
          },
        },
      },
    },
  });
  const glm = { supportedEfforts: ["low", "high", "max"] };
  const hy3 = sanitizeModelReasoning({
    supportedEfforts: ["no_think", "think_low", "think_high"],
  });
  assert.deepEqual(
    resolveReasoning("bai", "glm-5.3-flash", "https://api.b.ai/v1", glm)
      ?.supportedEfforts,
    ["low", "high", "max"],
  );
  assert.deepEqual(hy3?.supportedEfforts, [
    "no_think",
    "think_low",
    "think_high",
  ]);
  assert.deepEqual(
    resolveReasoning("bai", "hy3", "https://api.b.ai/v1", hy3)?.supportedEfforts,
    ["no_think", "think_low", "think_high"],
  );
  assert.deepEqual(
    resolveReasoning("qwen", "qwen3.8-flash", "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", {
      supportedEfforts: ["low"],
    })?.supportedEfforts,
    ["low", "medium", "xhigh"],
  );
  assert.equal(
    resolveReasoning("commandcode", "glm-5.3-flash", undefined, glm),
    undefined,
  );
  const home = mkdtempSync(join(tmpdir(), "guild-reason-manual-"));
  writeModelsFile(home, {
    default: { provider: "bai", model: "glm-5.3-flash" },
    providers: {
      bai: {
        name: "BAI",
        baseUrl: "https://api.b.ai/v1",
        api: "openai-completions",
        apiKey: "bai-test",
        models: [
          {
            id: "glm-5.3-flash",
            name: "glm-5.3-flash",
            reasoning: { supportedEfforts: ["low", "high", "max"] },
          },
          { id: "hy3", name: "hy3" },
        ],
      },
    },
  });
  const listed = publicModels(home);
  const glmRow = listed.picker
    .find((row) => row.id === "bai")
    ?.models.find((row) => row.id === "glm-5.3-flash");
  const hy3Row = listed.picker
    .find((row) => row.id === "bai")
    ?.models.find((row) => row.id === "hy3");
  const keyGlm = listed.providers
    .find((row) => row.id === "bai")
    ?.models.find((row) => row.id === "glm-5.3-flash");
  assert.deepEqual(glmRow?.reasoning?.supportedEfforts, ["low", "high", "max"]);
  assert.equal(hy3Row?.reasoning, undefined);
  assert.deepEqual(keyGlm?.manualEfforts, ["low", "high", "max"]);
  assert.equal(keyGlm?.catalogEfforts, undefined);
  resetReasoningCatalog();
});

test("chat and settings pickers fill efforts from the model, not four hardcoded options", () => {
  const chat = readFileSync(CHAT_HTML, "utf8");
  const css = readFileSync(CHAT_CSS, "utf8");
  const settings = readFileSync(SETTINGS_HTML, "utf8");
  assert.match(chat, /function effortChoices/);
  assert.match(chat, /supportedEfforts/);
  assert.match(chat, /activeReasoningSpec/);
  assert.match(chat, /hit\.kind === "commandcode"/);
  assert.match(css, /\.model-row\[hidden\]\s*\{\s*display:\s*none\s*!important/);
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
  assert.match(settings, /data-f="efforts"/);
  assert.match(settings, /settings.effortsPlaceholder/);
  assert.match(settings, /settings.effortsHint/);
  assert.doesNotMatch(settings, /<option value="minimal">Minimal<\/option>/);
});
