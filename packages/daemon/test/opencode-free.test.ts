import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  OPENCODE_FREE_BASE_URL,
  OPENCODE_FREE_DEFAULT_MODEL,
  OPENCODE_FREE_FLOOR,
  OPENCODE_FREE_PROVIDER_ID,
  filterOpenCodeFreeIds,
  isKeylessProvider,
  llmRequestHeaders,
  openCodeFreeProvider,
  probeOpenCodeFreeModel,
  probeOpenCodeFreeModels,
  selectOpenCodeFreeIds,
  usesZenResponses,
} from "../src/opencode-free.ts";
import { mergeModelsFile, publicModels, resolveLlm, writeModelsFile } from "../src/llm.ts";
import { closeServer, listen as listenApp } from "./app.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-ocfree-"));
}

test("opencode-free is a keyless Zen provider with an offline floor", () => {
  assert.equal(isKeylessProvider("opencode-free"), true);
  assert.equal(isKeylessProvider("free"), true);
  assert.equal(isKeylessProvider("opencode_free"), true);
  assert.equal(isKeylessProvider("openai"), false);
  const provider = openCodeFreeProvider();
  assert.equal(provider.baseUrl, OPENCODE_FREE_BASE_URL);
  assert.equal(provider.api, "openai-completions");
  assert.equal(provider.apiKey, "");
  assert.ok(OPENCODE_FREE_FLOOR.includes("laguna-s-2.1-free"));
  assert.ok(OPENCODE_FREE_FLOOR.includes(OPENCODE_FREE_DEFAULT_MODEL));
  assert.equal(usesZenResponses("muse-spark-1.2-contributor-free"), true);
  assert.equal(usesZenResponses("laguna-s-2.1-free"), false);
  assert.deepEqual(
    filterOpenCodeFreeIds([
      "claude-sonnet-5",
      "laguna-s-2.1-free",
      "ox-alpha-free",
      "big-pickle",
      "deepseek-v4-flash",
    ]),
    ["laguna-s-2.1-free", "big-pickle"],
  );
});

test("keyless requests omit Authorization so a dummy bearer never hits Zen", () => {
  const headers = llmRequestHeaders({
    providerId: OPENCODE_FREE_PROVIDER_ID,
    model: "laguna-s-2.1-free",
    baseUrl: OPENCODE_FREE_BASE_URL,
    apiKey: "no-key-required",
    api: "openai-completions",
  });
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.Authorization, undefined);
  assert.match(headers["user-agent"] ?? "", /^Guild\//);
  assert.equal(headers["x-title"], "Guild");
  const keyed = llmRequestHeaders({
    providerId: "openai",
    model: "gpt-4.1-mini",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    api: "openai-completions",
  });
  assert.equal(keyed.authorization, "Bearer sk-test");
});

test("resolveLlm can pick opencode-free with no env keys", () => {
  const home = tempHome();
  writeModelsFile(home, {
    default: { provider: OPENCODE_FREE_PROVIDER_ID, model: "laguna-s-2.1-free" },
    providers: { [OPENCODE_FREE_PROVIDER_ID]: openCodeFreeProvider() },
  });
  const target = resolveLlm(home, {});
  assert.ok(target);
  assert.equal(target?.providerId, OPENCODE_FREE_PROVIDER_ID);
  assert.equal(target?.model, "laguna-s-2.1-free");
  assert.equal(target?.baseUrl, OPENCODE_FREE_BASE_URL);
});

test("publicModels marks opencode-free ready without a stored key", () => {
  const home = tempHome();
  const listed = publicModels(home, {});
  const provider = listed.providers.find((p) => p.id === OPENCODE_FREE_PROVIDER_ID);
  assert.ok(provider);
  assert.equal(listed.providers[0]?.id, OPENCODE_FREE_PROVIDER_ID);
  assert.equal(listed.default?.provider, OPENCODE_FREE_PROVIDER_ID);
  assert.equal(listed.default?.model, OPENCODE_FREE_DEFAULT_MODEL);
  assert.equal(provider?.stored, "empty");
  const pick = listed.picker.find((p) => p.id === OPENCODE_FREE_PROVIDER_ID);
  assert.equal(pick?.ready, true);
  assert.equal(pick?.kind, "keyless");
});

test("GET /settings/models exposes keyless OpenCode Free", { timeout: 60_000 }, async () => {
  const { server, origin } = await listenApp(tempHome());
  try {
    const res = await fetch(`${origin}/settings/models`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      providers: { id: string }[];
      picker: { id: string; ready: boolean; kind: string; models: { id: string }[] }[];
    };
    assert.equal(body.providers[0]?.id, OPENCODE_FREE_PROVIDER_ID);
    const pick = body.picker.find((p) => p.id === OPENCODE_FREE_PROVIDER_ID);
    assert.equal(pick?.kind, "keyless");
    assert.equal(pick?.ready, true);
    assert.ok((pick?.models || []).some((m) => m.id === "laguna-s-2.1-free"));
    const page = await fetch(`${origin}/settings`);
    const html = await page.text();
    assert.match(html, /opencode-free/);
    assert.match(html, /settings.opencodeFreeHint/);
    assert.match(html, /data-sync-free/);
    assert.match(html, /class="sync-free"/);
    assert.match(html, /sync-ico/);
    assert.match(html, /lock \? " readonly"/);
    assert.match(html, /lock \? " disabled"/);
    assert.match(html, /data-del-provider/);
    assert.match(html, /function deleteProvider/);
    assert.match(html, /snapshotProviders/);
    const synced = await fetch(`${origin}/settings/models/opencode-free/sync`, {
      method: "POST",
    });
    assert.equal(synced.status, 200);
    const after = (await synced.json()) as {
      picker: { id: string; models: { id: string }[] }[];
      probe: { id: string; ok: boolean }[];
    };
    const live = after.picker.find((p) => p.id === OPENCODE_FREE_PROVIDER_ID);
    assert.ok((live?.models || []).length >= 1);
    assert.ok(Array.isArray(after.probe));
    assert.ok(after.probe.length >= 1);
  } finally {
    await closeServer(server);
  }
});

test("saving providers without OpenCode Free puts it back", () => {
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
  const file = JSON.parse(readFileSync(join(home, "models.json"), "utf8")) as {
    providers: Record<string, unknown>;
  };
  assert.ok(file.providers[OPENCODE_FREE_PROVIDER_ID]);
  assert.equal(Object.keys(file.providers)[0], OPENCODE_FREE_PROVIDER_ID);
});

test("PUT can drop a keyed provider and keeps OpenCode Free", async () => {
  const { server, origin } = await listenApp(tempHome());
  try {
    const added = await fetch(`${origin}/settings/models`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: {
          ollama: {
            name: "Ollama",
            baseUrl: "http://localhost:11434/v1",
            api: "openai-completions",
            apiKey: "ollama",
            models: [{ id: "llama3.1:8b" }],
          },
          anthropic: {
            name: "Anthropic",
            baseUrl: "https://api.anthropic.com",
            api: "anthropic-messages",
            apiKey: "$ANTHROPIC_API_KEY",
            models: [{ id: "claude-sonnet-4-5" }],
          },
        },
      }),
    });
    assert.equal(added.status, 200);
    const dropped = await fetch(`${origin}/settings/models`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: {
          ollama: {
            name: "Ollama",
            baseUrl: "http://localhost:11434/v1",
            api: "openai-completions",
            apiKey: "ollama",
            models: [{ id: "llama3.1:8b" }],
          },
        },
      }),
    });
    assert.equal(dropped.status, 200);
    const body = (await dropped.json()) as { providers: { id: string }[] };
    const ids = body.providers.map((p) => p.id);
    assert.ok(ids.includes(OPENCODE_FREE_PROVIDER_ID));
    assert.ok(ids.includes("ollama"));
    assert.ok(!ids.includes("anthropic"));
  } finally {
    await closeServer(server);
  }
});

test("probe uses /responses for Muse and treats 500 as down", async () => {
  const urls: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/responses")) {
      return new Response(JSON.stringify({ output: [] }), { status: 200 });
    }
    if (url.includes("/chat/completions")) {
      return new Response("nope", { status: 500, statusText: "Error" });
    }
    return new Response("missing", { status: 404 });
  }) as typeof fetch;
  const muse = await probeOpenCodeFreeModel("muse-spark-1.2-contributor-free", fake);
  const dead = await probeOpenCodeFreeModel("deepseek-v4-flash-free", fake);
  assert.equal(muse.ok, true);
  assert.equal(muse.status, 200);
  assert.ok(urls[0].endsWith("/responses"));
  assert.equal(dead.ok, false);
  assert.equal(dead.status, 500);
  assert.ok(urls[1].endsWith("/chat/completions"));
});

test("probe keeps 429 models and drops hard failures", async () => {
  const fake = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
    if (body.model === "big-pickle") {
      return new Response("slow down", { status: 429 });
    }
    return new Response("nope", { status: 400 });
  }) as typeof fetch;
  const rows = await probeOpenCodeFreeModels(
    ["big-pickle", "deepseek-v4-flash-free"],
    fake,
  );
  assert.equal(rows[0]?.ok, true);
  assert.equal(rows[0]?.status, 429);
  assert.equal(rows[1]?.ok, false);
  assert.deepEqual(
    selectOpenCodeFreeIds(
      ["big-pickle", "deepseek-v4-flash-free"],
      rows,
      "deepseek-v4-flash-free",
    ),
    ["big-pickle", "deepseek-v4-flash-free"],
  );
  assert.deepEqual(
    selectOpenCodeFreeIds(["big-pickle", "deepseek-v4-flash-free"], rows),
    ["big-pickle"],
  );
  assert.deepEqual(
    selectOpenCodeFreeIds(
      ["deepseek-v4-flash-free"],
      [{ id: "deepseek-v4-flash-free", ok: false, status: 400 }],
    ),
    [],
  );
});
