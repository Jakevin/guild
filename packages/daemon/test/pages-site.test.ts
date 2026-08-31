import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SITE = join(ROOT, "site/index.html");
const WORKFLOW = join(ROOT, ".github/workflows/pages.yml");

test("GitHub Pages demo is a fixture, not a live daemon", () => {
  const html = readFileSync(SITE, "utf8");
  const workflow = readFileSync(WORKFLOW, "utf8");
  assert.match(html, /Interactive preview — no model calls/);
  assert.match(html, /@infra/);
  assert.match(html, /@pm/);
  assert.match(html, /@rd/);
  assert.match(html, /@design/);
  assert.match(html, /@marketing/);
  assert.match(html, /@handle → chatReply → HarnessService\.turn → runAgentLoop/);
  assert.match(html, /Ship it:/);
  assert.match(html, /pnpm i/);
  assert.match(html, /pnpm test/);
  assert.match(html, /pnpm dev/);
  assert.match(html, /full_access/);
  assert.doesNotMatch(html, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /XMLHttpRequest/);
  assert.doesNotMatch(html, /WebSocket/);
  assert.doesNotMatch(html, /127\.0\.0\.1:7420\/(channels|bots|workspace)/);
  assert.match(html, /not a task board/i);
  assert.match(html, /not a tavern/i);
  assert.doesNotMatch(html, /Quest board/);
  assert.match(workflow, /path: site/);
  assert.match(workflow, /actions\/deploy-pages/);
});

test("README points at the Pages demo without moving the first screen", () => {
  const en = readFileSync(join(ROOT, "README.md"), "utf8");
  const zh = readFileSync(join(ROOT, "README.zh.md"), "utf8");
  const ja = readFileSync(join(ROOT, "README.ja.md"), "utf8");
  const first = en.split("\n").slice(0, 20).join("\n");
  assert.match(first, /docs\/demo-hall-en-2026-08-31\.gif/);
  assert.match(first, /## Open the hall/);
  assert.doesNotMatch(first, /jakevin\.github\.io/);
  for (const body of [en, zh, ja]) {
    assert.match(body, /https:\/\/jakevin\.github\.io\/guild\//);
    assert.match(body, /docs\/demo-hall-en-2026-08-31\.gif/);
    assert.match(body, /docs\/readme-hall-2026-08-29\.png/);
  }
});
