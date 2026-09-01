import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { guildUserAgent, guildVersion } from "../src/version.ts";

test("User-Agent tracks this package's version, not a hardcoded cut", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const root = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, root.version);
  assert.equal(guildVersion(), pkg.version);
  assert.equal(guildUserAgent(), `Guild/${pkg.version}`);
  assert.doesNotMatch(
    readFileSync(new URL("../src/opencode-free.ts", import.meta.url), "utf8"),
    /Guild\/0\.\d/,
  );
  assert.doesNotMatch(
    readFileSync(
      new URL("../src/reasoning-catalog.ts", import.meta.url),
      "utf8",
    ),
    /Guild\/0\.\d/,
  );
});
