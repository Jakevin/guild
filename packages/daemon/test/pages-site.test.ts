import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  assert.match(html, /npx @kevin5251984\/guild web/);
  assert.match(html, /Node ≥ 22\.19/);
  assert.match(html, /http:\/\/127\.0\.0\.1:7420/);
  assert.match(html, /<link rel="canonical" href="https:\/\/jakevin\.github\.io\/guild\/"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:url"/);
  assert.match(html, /name="twitter:card" content="summary"/);
  assert.match(html, /name="theme-color" content="#0B0E12"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type": "SoftwareApplication"/);
  assert.doesNotMatch(html, /property="og:image"/);
  assert.doesNotMatch(html, /name="twitter:site"/);
  assert.doesNotMatch(html, /twitter:creator/);
  assert.match(html, /full_access/);
  assert.doesNotMatch(html, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /XMLHttpRequest/);
  assert.doesNotMatch(html, /WebSocket/);
  assert.doesNotMatch(html, /127\.0\.0\.1:7420\/(channels|bots|workspace)/);
  assert.match(html, /not a task board/i);
  assert.match(html, /not a tavern/i);
  assert.doesNotMatch(html, /Quest board/);
  assert.match(html, /family=Cinzel/);
  assert.match(html, /family=Pixelify\+Sans/);
  assert.doesNotMatch(html, /family=Syne/);
  assert.match(html, /h1 \{[\s\S]*?font-family:\s*"Pixelify Sans"/);
  assert.match(html, /h2 \{[\s\S]*?font-family:\s*"Pixelify Sans"/);
  assert.match(html, /\.sign \{[\s\S]*?font-family:\s*Cinzel/);
  assert.doesNotMatch(html, /h1 \{[^}]*font-family:\s*Syne/);
  assert.doesNotMatch(html, /h2 \{[^}]*font-family:\s*Syne/);
  assert.match(html, /src="demo-hall-en-2026-08-31\.gif"/);
  assert.doesNotMatch(html, /docs\/demo-hall-en-2026-08-31\.gif/);
  assert.doesNotMatch(html, /docs\/demo-hall-en-2026-08-29\.gif/);
  assert.doesNotMatch(html, /raw\.githubusercontent\.com\/Jakevin\/guild\/main\/docs\/demo-hall/);
  assert.match(workflow, /path: site/);
  assert.match(workflow, /actions\/deploy-pages/);
});

test("Pages GIF is a byte-identical copy inside site/", () => {
  const gif = join(ROOT, "site/demo-hall-en-2026-08-31.gif");
  const src = join(ROOT, "docs/demo-hall-en-2026-08-31.gif");
  assert.equal(existsSync(gif), true);
  const a = readFileSync(gif);
  const b = readFileSync(src);
  assert.equal(a.equals(b), true);
  assert.ok(a.byteLength > 1_000_000);
});

test("Pages JSON-LD and the nav version match the npm package", () => {
  const html = readFileSync(SITE, "utf8");
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as { version: string };
  const daemon = JSON.parse(
    readFileSync(join(ROOT, "packages/daemon/package.json"), "utf8"),
  ) as { version: string };
  assert.equal(pkg.version, daemon.version);
  assert.match(html, new RegExp(`"softwareVersion": "${pkg.version}"`));
  assert.match(html, new RegExp(`class="ver">v${pkg.version} ·`));
});

test("first-mention starts with wiring a model", () => {
  const first = readFileSync(join(ROOT, "docs/first-mention.md"), "utf8");
  const zh = readFileSync(join(ROOT, "docs/first-mention.zh.md"), "utf8");
  assert.match(first, /## 1\. Get a model \(do this first\)/);
  assert.match(first, /Guild is not usable/);
  assert.match(zh, /## 1\. 先接一個模型/);
  assert.match(zh, /Guild 不能用/);
  assert.doesNotMatch(first, /they can ack; they cannot think/);
  assert.doesNotMatch(zh, /冒險者還能回一聲/);
});

test("README points at the Pages demo without moving the first screen", () => {
  const en = readFileSync(join(ROOT, "README.md"), "utf8");
  const zh = readFileSync(join(ROOT, "README.zh.md"), "utf8");
  const ja = readFileSync(join(ROOT, "README.ja.md"), "utf8");
  const first = en.split("\n").slice(0, 20).join("\n");
  assert.match(first, /docs\/demo-hall-en-2026-08-31\.gif/);
  assert.match(first, /## Open the hall/);
  assert.doesNotMatch(first, /jakevin\.github\.io/);
  assert.match(first, /npx @kevin5251984\/guild web/);
  assert.doesNotMatch(first, /pnpm i/);
  assert.match(en, /npx @kevin5251984\/guild web/);
  assert.match(zh, /npx @kevin5251984\/guild web/);
  assert.match(ja, /npx @kevin5251984\/guild web/);
  for (const body of [en, zh, ja]) {
    assert.match(body, /https:\/\/jakevin\.github\.io\/guild\//);
    assert.match(body, /docs\/demo-hall-en-2026-08-31\.gif/);
    assert.match(body, /docs\/readme-hall-2026-08-29\.png/);
  }
});

test("Pages fixture switches zh-CN / zh-TW / en / ja in the DOM", () => {
  const html = readFileSync(SITE, "utf8");
  assert.match(html, /data-locale="zh-CN"/);
  assert.match(html, /data-locale="zh-TW"/);
  assert.match(html, /data-locale="en"/);
  assert.match(html, /data-locale="ja"/);
  assert.match(html, /aria-label="简体中文">简</);
  assert.match(html, /aria-label="繁體中文">繁</);
  assert.match(html, /aria-label="English">EN</);
  assert.match(html, /aria-label="日本語">日</);
  assert.match(html, /guild-pages-locale/);
  assert.match(html, /navigator\.language/);
  assert.match(html, /function detectLocale/);
  assert.match(html, /function setLocale/);
  assert.match(html, /document\.documentElement\.lang/);
  assert.match(html, /"seat\.infra": "基建"/);
  assert.match(html, /"seat\.pm": "專案經理"/);
  assert.match(html, /"seat\.rd": "研發"/);
  assert.match(html, /"seat\.design": "美術設計"/);
  assert.match(html, /"seat\.marketing": "行銷"/);
  assert.match(html, /html\[lang\^="zh"\] h1/);
  assert.match(html, /PingFang/);
  assert.match(html, /Hiragino/);
  assert.match(html, /class="skip" href="#try"/);
  assert.doesNotMatch(html, /<select/);
  assert.doesNotMatch(html, /🏳️|🇨🇳|🇹🇼|🇯🇵|🇺🇸/);
  const banners = [...html.matchAll(/"banner\.title": "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(banners.length, 4);
  assert.ok(banners.every((s) => s === "Interactive preview — no model calls."));
  assert.match(html, /"pm\.after": "Ship it:/);
  assert.match(html, /"zh-TW": \{/);
  assert.match(html, /"zh-CN": \{/);
  assert.match(html, /\bnpx @kevin5251984\/guild web\b/);
  assert.match(html, /id="tonight"/);
  assert.match(html, /class="plaques"/);
  assert.match(html, /OpenCode Free/);
  assert.match(html, /does not hire a seat/);
  assert.match(html, /not a four-language app/);
  assert.match(html, /"h2\.tonight": "今晚大廳能做的事"/);
  assert.match(html, /"pl\.mobile\.t": "\/m 外出"/);
  assert.match(html, /opencode\.ai/);
  assert.match(html, /Guild 0\.2\.20/);
  assert.doesNotMatch(html, /four-language UI/);

  const start = html.indexOf("const I18N = {");
  const end = html.indexOf("\n    };", start);
  assert.ok(start >= 0 && end > start, "I18N object");
  const I18N = new Function(`${html.slice(start, end + "\n    };".length)}\nreturn I18N;`)() as Record<
    string,
    Record<string, unknown>
  >;
  const locales = ["en", "zh-TW", "zh-CN", "ja"] as const;
  assert.deepEqual(Object.keys(I18N), [...locales]);
  const keys = Object.keys(I18N.en).sort();
  assert.ok(keys.length >= 70, `en keys ${keys.length}`);
  for (const loc of locales) {
    assert.deepEqual(Object.keys(I18N[loc]).sort(), keys, loc);
    assert.equal(I18N[loc]["banner.title"], "Interactive preview — no model calls.");
  }
});
