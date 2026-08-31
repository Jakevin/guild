import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const RELEASE = join(ROOT, ".github/workflows/release.yml");
const CONTRIBUTING = join(ROOT, "CONTRIBUTING.md");

test("release.yml is the npm trusted-publisher workflow", () => {
  const yml = readFileSync(RELEASE, "utf8");
  assert.match(yml, /^name: Release$/m);
  assert.match(yml, /tags:\n\s+- "v\*"/);
  assert.match(yml, /id-token: write/);
  assert.match(yml, /contents: write/);
  assert.match(yml, /working-directory: packages\/daemon/);
  assert.match(yml, /npm publish --access public/);
  assert.match(yml, /gh release create/);
  assert.doesNotMatch(yml, /NPM_TOKEN/);
  assert.doesNotMatch(yml, /NODE_AUTH_TOKEN/);
});

test("CONTRIBUTING documents the trusted publisher fields", () => {
  const md = readFileSync(CONTRIBUTING, "utf8");
  assert.match(md, /release\.yml/);
  assert.match(md, /Jakevin/);
  assert.match(md, /`guild`/);
  assert.match(md, /npm publish/);
  assert.match(md, /git tag/);
});
