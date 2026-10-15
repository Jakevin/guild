import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ModelsFile } from "@guild/protocol";
import { llmComplete, mergeModelsFile, publicModels, readModelsFile } from "../src/llm.ts";
import {
  GROUP_PROVIDER_ID,
  noteRouteRest,
  noteRouteSuccess,
  planRouteSteps,
  readRouteState,
} from "../src/route-group.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-route-"));
}

function file(): ModelsFile {
  return {
    providers: {
      a: {
        name: "A",
        baseUrl: "https://a.example/v1",
        api: "openai-completions",
        apiKey: "sk-a-primary",
        keys: ["sk-a-spare"],
        models: [{ id: "a-model" }],
      },
      b: {
        name: "B",
        baseUrl: "https://b.example/v1",
        api: "openai-completions",
        apiKey: "sk-b",
        models: [{ id: "b-model" }],
      },
    },
    groups: {
      daily: {
        name: "日常",
        routing: "order",
        members: [
          { provider: "a", model: "a-model" },
          { provider: "b", model: "b-model" },
        ],
      },
    },
  };
}

describe("routing groups", { concurrency: 1 }, () => {
  test("a group tries the next member after one rests, and a room stays with who answered", () => {
    const home = tempHome();
    const now = new Date("2026-10-10T01:00:00Z");
    const ref = { provider: GROUP_PROVIDER_ID, model: "daily" };
    const first = planRouteSteps({ file: file(), ref, now, roomId: "room-1" });
    assert.deepEqual(
      first.map((step) => step.ref.model),
      ["a-model", "a-model", "b-model"],
    );
    assert.equal(first[1]?.apiKey, "sk-a-spare");
    noteRouteRest(home, first[0]!.slot, now);
    noteRouteRest(home, first[1]!.slot, now);
    const rested = planRouteSteps({
      file: file(),
      state: readRouteState(home),
      ref,
      now,
      roomId: "room-1",
    });
    assert.equal(rested[0]?.ref.model, "b-model");
    noteRouteSuccess(home, rested[0]!, "room-1", 2, now);
    const again = planRouteSteps({
      file: file(),
      state: readRouteState(home),
      ref,
      now: new Date(now.getTime() + 60_000),
      roomId: "room-1",
    });
    assert.equal(again[0]?.ref.provider, "b");
    const nextRoom = planRouteSteps({
      file: file(),
      state: readRouteState(home),
      ref: { ...ref, model: "daily" },
      now: new Date(now.getTime() + 60_000),
      roomId: "room-2",
    });
    assert.equal(readRouteState(home).cursor.daily, 1);
    assert.equal(nextRoom[0]?.ref.provider, "b");
  });

  test("usage prefers the member with fewer calls", () => {
    const listed = file();
    listed.groups!.daily!.routing = "usage";
    const state = readRouteState(tempHome());
    state.hits["a\na-model\n0"] = 4;
    const steps = planRouteSteps({
      file: listed,
      state,
      ref: { provider: GROUP_PROVIDER_ID, model: "daily" },
    });
    assert.equal(steps[0]?.ref.provider, "b");
  });

  test("a save keeps spare keys and groups, and does not publish the spare secret", () => {
    const home = tempHome();
    const spare = "sk-spare-secret-value";
    const providers = file().providers;
    providers.a!.keys = [spare];
    mergeModelsFile(home, {
      default: { provider: GROUP_PROVIDER_ID, model: "daily" },
      providers,
      groups: {
        daily: {
          name: "日常",
          routing: "smart",
          members: [
            { provider: "a", model: "a-model" },
            { provider: "group", model: "nested" },
            { provider: "b", model: "b-model" },
          ],
        },
        empty: { name: "空", members: [] },
      },
    });
    const saved = readModelsFile(home);
    assert.equal(saved.default?.provider, GROUP_PROVIDER_ID);
    assert.deepEqual(saved.groups?.daily?.members.map((member) => member.provider), ["a", "b"]);
    assert.equal(saved.groups?.empty, undefined);
    assert.deepEqual(saved.providers.a?.keys, [spare]);
    mergeModelsFile(home, {
      providers: {
        a: {
          ...saved.providers.a!,
          apiKey: saved.providers.a!.apiKey!,
          keys: [spare.slice(0, 5) + "…" + spare.slice(-5)],
        },
      },
    });
    assert.deepEqual(readModelsFile(home).providers.a?.keys, [spare]);
    const listed = publicModels(home, {});
    const provider = listed.providers.find((item) => item.id === "a");
    assert.equal(provider?.keys, undefined);
    assert.deepEqual(provider?.keysPreview, [spare.slice(0, 5) + "…" + spare.slice(-5)]);
    const group = listed.picker.find((item) => item.id === GROUP_PROVIDER_ID);
    assert.equal(group?.kind, "group");
    assert.deepEqual(group?.models.map((model) => model.id), ["daily", "free"]);
    assert.equal(listed.picker.filter((item) => item.id === "free").length, 1);
  });

  test("the next spare key answers when the first is rate-limited", async () => {
    const home = tempHome();
    const spare = "sk-spare-secret-value";
    mergeModelsFile(home, {
      default: { provider: "a", model: "a-model" },
      providers: {
        a: {
          name: "A",
          baseUrl: "http://example.test/v1",
          api: "openai-completions",
          apiKey: "sk-primary-secret",
          keys: [spare],
          models: [{ id: "a-model", name: "A" }],
        },
      },
    });
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push(headers.get("authorization") ?? "");
      if (seen.length === 1) return new Response("nope", { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const done = await llmComplete({
        dataDir: home,
        env: {},
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        tools: false,
        toolCtx: { dataDir: home, env: {}, spawnDepth: 0, allowWrite: false, roomId: "room-9" },
      });
      assert.equal(done?.text, "ok");
      assert.equal(done?.provider, "a");
      assert.equal(done?.model, "a-model");
      assert.deepEqual(seen, ["Bearer sk-primary-secret", `Bearer ${spare}`]);
      const raw = readFileSync(join(home, "route-state.json"), "utf8");
      assert.equal(raw.includes(spare), false);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("settings edits groups and spare keys", () => {
    const settings = readFileSync(
      fileURLToPath(new URL("../src/public/settings.html", import.meta.url)),
      "utf8",
    );
    assert.match(settings, /function renderGroups/);
    assert.match(settings, /function showToast/);
    assert.match(settings, /id="toast"/);
    assert.match(settings, /settings\.spareKeys/);
    assert.match(settings, /i18n\.js\?v=decide/);
  });
});
