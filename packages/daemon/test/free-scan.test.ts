import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyFreeModels,
  diffFreeIds,
  freeScanDue,
  freeScanPath,
  isZeroPrice,
  parameterBillions,
  readFreeScan,
  resetFreeScanBackoff,
  scanFreeModels,
  scanFreeModelsIfDue,
} from "../src/free-scan.ts";
import { publicModels } from "../src/llm.ts";
import { guildUserAgent } from "../src/version.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-free-scan-"));
}

function local(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function row(extra: Record<string, unknown>): Record<string, unknown> {
  return extra;
}

function catalog(rows: Record<string, unknown>[]): Response {
  return new Response(JSON.stringify({ data: rows }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("daily free-model scan", { concurrency: 1 }, () => {
  test("zero price needs every listed rate at zero", () => {
    assert.equal(
      isZeroPrice(row({ pricing: { prompt: "0", completion: 0, request: 0 } })),
      true,
    );
    assert.equal(
      isZeroPrice(row({ pricing: { prompt: 0, completion: 0, input_cache_read: "0.1" } })),
      false,
    );
    assert.equal(isZeroPrice(row({ pricing: { prompt: 0 } })), false);
    assert.equal(isZeroPrice(row({})), false);
  });

  test("eligibility uses the API size, not a number in the id", () => {
    assert.equal(parameterBillions(row({ total_parameters: 100e9 })), 100);
    assert.equal(parameterBillions(row({ parameter_count: "405000000000" })), null);
    assert.equal(parameterBillions(row({ id: "vendor/huge-405b:free" })), null);
    const classified = classifyFreeModels([
      row({
        id: "vendor/huge-405b:free",
        pricing: { prompt: 0, completion: 0 },
        supported_parameters: ["tools"],
        context_length: 128000,
      }),
      row({
        id: "vendor/verified:free",
        pricing: { prompt: 0, completion: 0 },
        supported_parameters: ["tools"],
        total_parameters: 100e9,
        context_length: 32000,
      }),
      row({
        id: "vendor/small:free",
        pricing: { prompt: 0, completion: 0 },
        supported_parameters: ["tools"],
        total_parameters: 70e9,
      }),
      row({
        id: "vendor/no-tools:free",
        pricing: { prompt: 0, completion: 0 },
        total_parameters: 200e9,
      }),
      row({
        id: "vendor/paid",
        pricing: { prompt: 0.1, completion: 0 },
        supported_parameters: ["tools"],
        total_parameters: 400e9,
      }),
    ]);
    assert.equal(classified.freeCount, 4);
    assert.deepEqual(
      classified.eligible.map((model) => model.id),
      ["vendor/verified:free"],
    );
    assert.equal(classified.eligible[0]?.parametersB, 100);
    assert.deepEqual(
      classified.needsParameterVerification.map((model) => model.id),
      ["vendor/huge-405b:free"],
    );
    assert.deepEqual(classified.freeIds, [
      "vendor/huge-405b:free",
      "vendor/no-tools:free",
      "vendor/small:free",
      "vendor/verified:free",
    ]);
  });

  test("a later scan records which free ids appeared or left", () => {
    assert.deepEqual(diffFreeIds(["a", "b"], ["b", "c"]), {
      added: ["c"],
      removed: ["a"],
    });
    assert.deepEqual(diffFreeIds(undefined, ["a"]), { added: ["a"], removed: [] });
  });

  test("the scan is due once the local 08:00 gate has passed", () => {
    const morning = local(2026, 10, 9, 8, 0);
    const early = local(2026, 10, 9, 7, 30);
    assert.equal(freeScanDue(undefined, early), true);
    assert.equal(freeScanDue("not-a-date", morning), true);
    assert.equal(freeScanDue(local(2026, 10, 8, 7, 59).toISOString(), early), true);
    assert.equal(freeScanDue(local(2026, 10, 8, 8, 0).toISOString(), early), false);
    assert.equal(freeScanDue(local(2026, 10, 8, 9, 0).toISOString(), morning), true);
    assert.equal(freeScanDue(morning.toISOString(), morning), false);
    assert.equal(freeScanDue(local(2026, 10, 9, 7, 59).toISOString(), morning), true);
  });

  test("scans write a private report and keep it when the catalog request fails", async () => {
    resetFreeScanBackoff();
    const home = tempHome();
    const seen: { authorization?: string; ua?: string }[] = [];
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({
        authorization: headers.get("authorization") ?? undefined,
        ua: headers.get("user-agent") ?? undefined,
      });
      return catalog([
        row({
          id: "a:free",
          pricing: { prompt: 0, completion: 0 },
          supported_parameters: ["tools"],
          total_parameters: 120e9,
        }),
        row({ id: "b:free", pricing: { prompt: 0, completion: 0 } }),
      ]);
    }) as typeof fetch;
    const first = await scanFreeModels(home, fetcher, local(2026, 10, 8, 8, 5));
    assert.equal(seen[0]?.authorization, undefined);
    assert.equal(seen[0]?.ua, guildUserAgent());
    assert.equal(first.changes, undefined);
    assert.equal((statSync(freeScanPath(home)).mode & 0o777), 0o600);
    const failing = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    await assert.rejects(scanFreeModels(home, failing), /openrouter models HTTP 503/);
    assert.equal(readFreeScan(home)?.checkedAt, first.checkedAt);
    const second = await scanFreeModels(
      home,
      (async () =>
        catalog([
          row({ id: "b:free", pricing: { prompt: 0, completion: 0 } }),
          row({ id: "c:free", pricing: { prompt: 0, completion: 0 } }),
        ])) as typeof fetch,
      local(2026, 10, 9, 8, 5),
    );
    assert.deepEqual(second.changes, { added: ["c:free"], removed: ["a:free"] });
    const raw = readFileSync(freeScanPath(home), "utf8");
    assert.match(raw, /"source": "openrouter"/);
  });

  test("the daily job skips a disabled env and a scan that is still fresh", async () => {
    resetFreeScanBackoff();
    const home = tempHome();
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return catalog([row({ id: "a:free", pricing: { prompt: 0, completion: 0 } })]);
    }) as typeof fetch;
    const now = local(2026, 10, 9, 9, 0);
    await scanFreeModelsIfDue(home, { GUILD_FREE_SCAN: "0" }, fetcher, now);
    assert.equal(calls, 0);
    assert.equal(readFreeScan(home), null);
    await scanFreeModelsIfDue(home, {}, fetcher, now);
    assert.equal(calls, 1);
    await scanFreeModelsIfDue(home, {}, fetcher, now);
    assert.equal(calls, 1);
    const listed = publicModels(home, {});
    assert.deepEqual(listed.freeScan, {
      checkedAt: now.toISOString(),
      freeCount: 1,
      eligibleCount: 0,
      pendingCount: 0,
      added: null,
      removed: null,
    });
    const free = listed.providers.find((item) => item.id === "free");
    assert.deepEqual(free?.models.map((model) => model.id), ["free"]);
    assert.equal(listed.picker.filter((item) => item.id === "free").length, 1);
  });

  test("settings shows the counts and still describes one Free row", () => {
    const settings = readFileSync(
      fileURLToPath(new URL("../src/public/settings.html", import.meta.url)),
      "utf8",
    );
    const i18n = readFileSync(
      fileURLToPath(new URL("../src/public/i18n.js", import.meta.url)),
      "utf8",
    );
    assert.match(settings, /function freeScanLine/);
    assert.match(settings, /freeHintText\(\)/);
    assert.match(settings, /i18n\.js\?v=decide/);
    assert.doesNotMatch(settings, /freeIds/);
    assert.match(i18n, /settings\.freeScan/);
    assert.match(i18n, /不改這一列/);
  });
});
