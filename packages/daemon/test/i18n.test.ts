import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { I18N, I18N_ROWS, t, setGuildLocale, guildLocale, tagLabel } = require(
  "../src/public/i18n.js",
) as {
  I18N: Record<string, Record<string, string>>;
  I18N_ROWS: [string, string, string][];
  t: (key: string, vars?: Record<string, string | number>) => string;
  setGuildLocale: (locale: string) => void;
  guildLocale: () => string;
  tagLabel: (tag: string) => string;
};

const CHAT = fileURLToPath(new URL("../src/public/chat.html", import.meta.url));
const LIBRARY = fileURLToPath(new URL("../src/public/library.html", import.meta.url));
const SETTINGS = fileURLToPath(new URL("../src/public/settings.html", import.meta.url));
const STUDIO = fileURLToPath(new URL("../src/public/studio.html", import.meta.url));
const SKILLS_ADD = fileURLToPath(
  new URL("../src/public/skills-add.html", import.meta.url),
);
const SUBAGENTS_ADD = fileURLToPath(
  new URL("../src/public/subagents-add.html", import.meta.url),
);
const MCP_ADD = fileURLToPath(
  new URL("../src/public/mcp-add.html", import.meta.url),
);

test("zh-Hant and en packs share the same keys", () => {
  const keys = I18N_ROWS.map((row) => row[0]);
  assert.equal(keys.length, new Set(keys).size);
  const zh = Object.keys(I18N["zh-Hant"]).sort();
  const en = Object.keys(I18N.en).sort();
  assert.deepEqual(zh, en);
  assert.equal(I18N_ROWS.length, zh.length);
});

test("t interpolates and switches locale in memory", () => {
  setGuildLocale("zh-Hant");
  assert.equal(guildLocale(), "zh-Hant");
  assert.equal(t("nav.chat"), "訊息");
  assert.equal(t("minutesAgo", { n: 3 }), "3 分鐘前");
  assert.equal(tagLabel("development"), "開發");
  setGuildLocale("en");
  assert.equal(guildLocale(), "en");
  assert.equal(t("nav.chat"), "Chat");
  assert.equal(t("minutesAgo", { n: 3 }), "3 min ago");
  assert.equal(tagLabel("development"), "Dev");
  assert.equal(t("missing.key"), "missing.key");
  setGuildLocale("zh-Hant");
});

test("every public page loads i18n.js", () => {
  for (const path of [
    CHAT,
    LIBRARY,
    SETTINGS,
    STUDIO,
    SKILLS_ADD,
    SUBAGENTS_ADD,
    MCP_ADD,
  ]) {
    const html = readFileSync(path, "utf8");
    assert.match(html, /src="\/i18n\.js/);
    assert.match(html, /data-i18n-page=/);
    assert.match(html, /href="\/favicon\.svg"/);
  }
  const chat = readFileSync(CHAT, "utf8");
  assert.match(chat, /sidebar-resizer/);
  assert.doesNotMatch(chat, /locale-switch/);
  const settings = readFileSync(SETTINGS, "utf8");
  assert.match(settings, /data-locale="zh-Hant"/);
  assert.match(settings, /data-locale="en"/);
  assert.match(settings, /sidebar-resizer/);
});
