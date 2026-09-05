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
const MOBILE = fileURLToPath(new URL("../src/public/mobile.html", import.meta.url));

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
  assert.equal(t("setup.needModel"), "還沒接模型。Guild 不能想、也不能跑工具。");
  assert.equal(t("nav.chat"), "大廳");
  assert.equal(t("channels"), "委託");
  assert.equal(t("dms"), "密談");
  assert.equal(t("bot.settings"), "狀態欄");
  assert.equal(t("trace"), "軌跡");
  assert.equal(
    t("stats.inOut", { in: "1", cache: "2", out: "3" }),
    "輸入 1 · 快取命中 2 · 輸出 3",
  );
  assert.equal(t("spawn"), "子代理");
  assert.equal(t("trace.filter.all"), "全部");
  assert.equal(t("model.settings"), "狀態欄");
  assert.equal(t("channel.nameRequired"), "委託要有名稱");
  assert.equal(t("settings.saveKey"), "儲存");
  assert.equal(t("confirm.ok"), "確定");
  assert.equal(t("minutesAgo", { n: 3 }), "3 分鐘前");
  assert.equal(t("title.mobile"), "Guild — 外出");
  assert.equal(t("branch.close"), "結案");
  assert.equal(t("settings.keyless"), "無需金鑰");
  assert.equal(t("settings.sync"), "Sync");
  assert.equal(t("settings.commandCode"), "Command Code");
  assert.equal(t("settings.accountModels"), "大廳要出現的模型");
  assert.equal(t("settings.selectAll"), "全選");
  assert.equal(t("settings.freebuffChat"), "Freebuff Chat");
  assert.equal(t("live.freebuffWait"), "Freebuff：等待官方 session…");
  assert.equal(t("live.freebuffQueue"), "Freebuff：排隊中…");
  assert.equal(t("live.freebuffPaste"), "Freebuff：準備提示詞…");
  assert.equal(t("live.freebuffSend"), "Freebuff：呼叫 SDK…");
  assert.equal(t("error.freebuff_login_required"), "尚未登入官方 Freebuff session，或工作階段已過期。請到模型頁連接。");
  assert.equal(t("error.freebuff_busy"), "另一個回合正在使用 Freebuff。");
  assert.equal(t("error.freebuff_window_closed"), "瀏覽器視窗已關閉。");
  assert.equal(t("settings.probeOk"), "可用");
  assert.equal(t("settings.deletedProvider", { name: "Anthropic" }), "已刪除 Anthropic");
  assert.match(t("mobile.hint"), /Tailscale/);
  assert.equal(tagLabel("development"), "開發");
  setGuildLocale("en");
  assert.equal(guildLocale(), "en");
  assert.equal(t("nav.chat"), "Hall");
  assert.equal(t("live.freebuffWait"), "Freebuff: waiting for official session…");
  assert.equal(t("live.freebuffQueue"), "Freebuff: in queue…");
  assert.equal(t("live.freebuffPaste"), "Freebuff: preparing prompt…");
  assert.equal(t("live.freebuffSend"), "Freebuff: calling SDK…");
  assert.equal(t("error.freebuff_busy"), "Another turn is using Freebuff.");
  assert.equal(t("channels"), "Channels");
  assert.equal(t("dms"), "Whispers");
  assert.equal(t("bot.settings"), "Status");
  assert.equal(t("trace"), "Trajectory");
  assert.equal(t("spawn"), "Subagent");
  assert.equal(t("trace.filter.all"), "All");
  assert.equal(t("model.settings"), "Status");
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
    MOBILE,
  ]) {
    const html = readFileSync(path, "utf8");
    assert.match(html, /src="\/i18n\.js/);
    assert.match(html, /data-i18n-page=/);
    assert.match(html, /href="\/favicon\.svg"/);
  }
  const chat = readFileSync(CHAT, "utf8");
  assert.match(chat, /sidebar-resizer/);
  assert.match(chat, /id="traj-q"/);
  assert.match(chat, /id="traj-btn"/);
  assert.doesNotMatch(chat, /locale-switch/);
  const mobile = readFileSync(MOBILE, "utf8");
  assert.match(mobile, /data-i18n-page="mobile"/);
  assert.doesNotMatch(mobile, /locale-switch/);
  const settings = readFileSync(SETTINGS, "utf8");
  assert.match(settings, /data-locale="zh-Hant"/);
  assert.match(settings, /data-locale="en"/);
  assert.match(settings, /sidebar-resizer/);
  const studio = readFileSync(STUDIO, "utf8");
  assert.match(studio, /class="app bar-page"/);
  assert.match(studio, /sidebar-resizer/);
  assert.match(studio, /class="side-nav"/);
  assert.match(studio, /href="\/studio"/);
  assert.match(studio, /id="side-roster"/);
  assert.match(studio, /id="side-hire"/);
  assert.match(studio, /roster-bot/);
  assert.match(studio, /bot\.name \|\| bot\.handle/);
  const mcpAdd = readFileSync(MCP_ADD, "utf8");
  assert.match(mcpAdd, /class="host-list"/);
  assert.match(mcpAdd, /class="host-row"/);
  assert.doesNotMatch(mcpAdd, /class="lib-card"/);
  assert.doesNotMatch(mcpAdd, /data-import/);
  assert.doesNotMatch(mcpAdd, /匯入後對話才會用/);
  assert.match(mcpAdd, /本機已發現/);
  assert.match(mcpAdd, /本機 CLI，對話可直接用/);
  setGuildLocale("zh-Hant");
  assert.equal(t("mcp.host"), "本機 CLI，對話可直接用");
});
