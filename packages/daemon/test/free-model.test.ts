import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  FREE_BASE_URL,
  FREE_MODEL_ID,
  FREE_PROVIDER_ID,
  FREE_UPSTREAM_MODEL,
  freeProvider,
  freeWireModel,
  isFreeProvider,
} from "../src/free-model.ts";
import { isKeylessProvider, llmRequestHeaders } from "../src/opencode-free.ts";
import { guildUserAgent } from "../src/version.ts";
import {
  llmComplete,
  mergeModelsFile,
  publicModels,
  readModelsFile,
  resolveLlm,
} from "../src/llm.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-free-"));
}

test("free is one picker row and is not the OpenCode alias", () => {
  assert.equal(isFreeProvider("free"), true);
  assert.equal(isFreeProvider("kilo"), true);
  assert.equal(isFreeProvider("opencode-free"), false);
  assert.equal(isKeylessProvider("free"), false);
  assert.equal(isKeylessProvider("opencode-free"), true);
  const provider = freeProvider();
  assert.equal(provider.name, "Free");
  assert.equal(provider.baseUrl, FREE_BASE_URL);
  assert.equal(provider.apiKey, "");
  assert.deepEqual(provider.models, [{ id: FREE_MODEL_ID, name: "Free" }]);
  assert.equal(freeWireModel(FREE_PROVIDER_ID, "free"), FREE_UPSTREAM_MODEL);
  assert.equal(freeWireModel("opencode-free", "space-bunny-free"), "space-bunny-free");
});

test("free requests identify as Guild and send no bearer", () => {
  const headers = llmRequestHeaders({
    providerId: FREE_PROVIDER_ID,
    apiKey: "should-not-leak",
  });
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["user-agent"], guildUserAgent());
  assert.match(headers["user-agent"] ?? "", /^Guild\//);
});

test("a save keeps one Free model and leaves the OpenCode default", () => {
  const home = tempHome();
  mergeModelsFile(home, {
    default: { provider: "opencode-free", model: "laguna-s-2.1-free" },
    providers: {
      "kilo-free": {
        name: "Kilo Free",
        baseUrl: FREE_BASE_URL,
        api: "openai-completions",
        apiKey: "",
        models: [
          { id: "kilo-auto/free", name: "Kilo Auto" },
          { id: "minimax/minimax-m2.5:free", name: "MiniMax" },
        ],
      },
      free: {
        name: "Free",
        baseUrl: FREE_BASE_URL,
        api: "openai-completions",
        apiKey: "",
        models: [
          { id: "free", name: "Free" },
          { id: "extra", name: "Extra" },
        ],
      },
      ollama: {
        name: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        api: "openai-completions",
        apiKey: "ollama",
        models: [{ id: "llama3.1:8b" }],
      },
    },
  });
  const file = readModelsFile(home);
  assert.equal(file.providers["kilo-free"], undefined);
  assert.deepEqual(
    file.providers.free?.models.map((model) => model.id),
    ["free"],
  );
  assert.equal(file.default?.provider, "opencode-free");
  assert.equal(file.default?.model, "laguna-s-2.1-free");
  assert.equal(file.groups?.free?.name, "Free");
  assert.equal(file.groups?.free?.routing, "smart");
  assert.ok(
    file.groups?.free?.members.some(
      (member) => member.provider === FREE_PROVIDER_ID && member.model === FREE_MODEL_ID,
    ),
  );
  assert.ok(
    file.groups?.free?.members.some(
      (member) => member.provider === "opencode-free" && member.model === "laguna-s-2.1-free",
    ),
  );
  const listed = publicModels(home, {});
  const provider = listed.providers.find((item) => item.id === FREE_PROVIDER_ID);
  assert.equal(provider?.stored, "empty");
  assert.deepEqual(
    provider?.models.map((model) => model.id),
    ["free"],
  );
  const pick = listed.picker.find((item) => item.id === FREE_PROVIDER_ID);
  assert.equal(pick?.kind, "keyless");
  assert.equal(pick?.ready, true);
  assert.equal(pick?.name, "Free");
  assert.equal(pick?.models.length, 1);
  const target = resolveLlm(home, {}, undefined, {
    provider: "kilo",
    model: "kilo-auto/free",
  });
  assert.equal(target?.providerId, FREE_PROVIDER_ID);
  assert.equal(target?.model, "free");
  assert.equal(target?.baseUrl, FREE_BASE_URL.replace(/\/+$/, ""));
  assert.equal(target?.apiKey, "");
  const zen = resolveLlm(home, {}, undefined, {
    provider: "opencode-free",
    model: "space-bunny-free",
  });
  assert.equal(zen?.providerId, "opencode-free");
  assert.equal(zen?.model, "space-bunny-free");
  assert.equal(zen?.baseUrl, "https://opencode.ai/zen/v1");
});

test("a group already named Free keeps its own members and gains the free routes", () => {
  const home = tempHome();
  mergeModelsFile(home, {
    providers: {
      ollama: {
        name: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        api: "openai-completions",
        apiKey: "ollama",
        models: [{ id: "llama3.1:8b" }],
      },
    },
    groups: {
      handmade: {
        name: "Free",
        routing: "order",
        members: [
          { provider: "opencode-free", model: "laguna-s-2.1-free" },
          { provider: "commandcode", model: "meta/muse-spark-1.3-contributor" },
        ],
      },
    },
  });
  const file = readModelsFile(home);
  assert.equal(file.groups?.free, undefined);
  const group = file.groups?.handmade;
  assert.equal(group?.routing, "order");
  assert.ok(group?.members.some((member) => member.provider === "commandcode"));
  assert.ok(
    group?.members.some(
      (member) => member.provider === FREE_PROVIDER_ID && member.model === FREE_MODEL_ID,
    ),
  );
  assert.equal(file.default?.provider, "opencode-free");
});

test("a Free turn calls the auto route and reports the picker id", async () => {
  const home = tempHome();
  mergeModelsFile(home, {
    providers: {
      ollama: {
        name: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        api: "openai-completions",
        apiKey: "ollama",
        models: [{ id: "llama3.1:8b" }],
      },
    },
  });
  const seen: { url: string; model?: string; authorization?: string; ua?: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
    seen.push({
      url: String(input),
      model: body.model,
      authorization: headers.get("authorization") ?? undefined,
      ua: headers.get("user-agent") ?? undefined,
    });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const done = await llmComplete({
      dataDir: home,
      env: {},
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: false,
      prefer: { provider: "free", model: "free" },
    });
    assert.equal(done?.text, "ok");
    assert.equal(done?.provider, FREE_PROVIDER_ID);
    assert.equal(done?.model, FREE_MODEL_ID);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.model, FREE_UPSTREAM_MODEL);
    assert.ok(seen[0]?.url.startsWith(FREE_BASE_URL));
    assert.equal(seen[0]?.authorization, undefined);
    assert.equal(seen[0]?.ua, guildUserAgent());
  } finally {
    globalThis.fetch = original;
  }
});
