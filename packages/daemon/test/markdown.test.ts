import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createGuildServer, listenGuildServer } from "../src/server.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { renderMarkdown } = require("../src/public/md.js") as {
  renderMarkdown: (raw: string) => string;
};
const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);

test("renderMarkdown turns headings lists code and bold into HTML", () => {
  const html = renderMarkdown(
    "# Title\n\n**32 GB** of RAM.\n\n- one\n- two\n\n`hw.memsize`\n\n```\necho hi\n```\n\n[docs](https://example.com)",
  );
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>32 GB<\/strong>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<code>hw.memsize<\/code>/);
  assert.match(html, /<div class="md-fence">/);
  assert.match(html, /data-fence-input/);
  assert.match(html, /data-fence-copy/);
  assert.match(html, /<\/svg>text<\/span>/);
  assert.match(html, /<pre class="md-pre"><code>echo hi<\/code><\/pre>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /<script/);
});

test("renderMarkdown shows generated images", () => {
  const html = renderMarkdown("![自畫像](/generated/abc.jpg)\n\n![remote](https://example.com/x.png)");
  assert.match(html, /class="md-img"/);
  assert.match(html, /src="\/generated\/abc.jpg"/);
  assert.match(html, /src="https:\/\/example.com\/x.png"/);
  assert.doesNotMatch(html, /src="javascript:/);
});

test("renderMarkdown code fences expose copy and insert chrome", () => {
  const html = renderMarkdown("```js\nconst n = 1;\n```");
  assert.match(html, /class="md-fence-lang"/);
  assert.match(html, /<\/svg>js<\/span>/);
  assert.match(html, /title="加入輸入框"/);
  assert.match(html, /title="複製"/);
  assert.match(html, /<pre class="md-pre"><code>const n = 1;<\/code><\/pre>/);
});

test("renderMarkdown fence body stays escaped", () => {
  const html = renderMarkdown("```html\n<img src=x onerror=alert(1)>\n```");
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /data-fence-copy/);
});

test("html fences expose a sandboxed preview", () => {
  const html = renderMarkdown("```html\n<h1>Hi</h1>\n```");
  assert.match(html, /md-html-preview/);
  assert.match(html, /data-html-view="preview"/);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.match(html, /data-html-expand/);
  assert.match(html, /放大預覽/);
  assert.match(html, /&lt;h1&gt;Hi&lt;\/h1&gt;/);
  assert.doesNotMatch(html, /sandbox="[^"]*allow-same-origin/);
});

test("renderMarkdown escapes HTML", () => {
  const html = renderMarkdown("<img src=x onerror=alert(1)>");
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("renderMarkdown turns GFM tables into HTML", () => {
  const html = renderMarkdown(
    [
      "| 包 | 實際角色 |",
      "|---|---|",
      "| `packages/protocol` | 共用型別：Bot |",
      "| apps/desktop | 早期 React 殼 |",
    ].join("\n"),
  );
  assert.match(html, /<div class="md-table-wrap">/);
  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<th>包<\/th>/);
  assert.match(html, /<th>實際角色<\/th>/);
  assert.match(html, /<td><code class="md-file">packages\/protocol<\/code><\/td>/);
  assert.match(html, /<td>共用型別：Bot<\/td>/);
  assert.match(html, /<td>早期 React 殼<\/td>/);
  assert.doesNotMatch(html, /\|---\|/);
  assert.doesNotMatch(html, /<p>.*包/);
});

test("renderMarkdown table alignment and escaped pipes", () => {
  const html = renderMarkdown(
    "| left | mid | right |\n|:---|:---:|---:|\n| a \\| b | c | d |",
  );
  assert.match(html, /class="md-al-left"/);
  assert.match(html, /class="md-al-center"/);
  assert.match(html, /class="md-al-right"/);
  assert.match(html, /<td class="md-al-left">a \| b<\/td>/);
});

test("renderMarkdown table cells stay escaped", () => {
  const html = renderMarkdown("| x |\n|---|\n| <img src=x onerror=alert(1)> |");
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("renderMarkdown marks path-like inline code as files", () => {
  const html = renderMarkdown(
    "`docs/plan.md` and `llm.ts` and `CODEX_HOME` and `hw.memsize`",
  );
  assert.match(html, /class="md-file">docs\/plan.md<\/code>/);
  assert.match(html, /class="md-file">llm.ts<\/code>/);
  assert.match(html, /<code>CODEX_HOME<\/code>/);
  assert.match(html, /<code>hw.memsize<\/code>/);
  assert.doesNotMatch(html, /md-file">CODEX_HOME/);
  assert.doesNotMatch(html, /md-file">hw.memsize/);
});

test("a pipe line is not a table without a separator", () => {
  const html = renderMarkdown("use A | B");
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /use A \| B/);
});

test("chat page loads the shipped markdown renderer", async () => {
  const { readFileSync } = await import("node:fs");
  const home = readFileSync(CHAT_HTML, "utf8");
  assert.match(home, /src="\/md\.js"/);
  assert.match(home, /assistant-text md/);
  assert.match(home, /data-fence-copy/);
  assert.match(home, /insertDraft/);
  const dataDir = mkdtempSync(join(tmpdir(), "guild-home-"));
  const server = createGuildServer({ dataDir, env: {} });
  const bound = await listenGuildServer(server, "127.0.0.1", 0);
  try {
    const res = await fetch(`http://127.0.0.1:${bound.port}/md.js`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /function renderMarkdown/);
    const i18n = await fetch(`http://127.0.0.1:${bound.port}/i18n.js`);
    assert.equal(i18n.status, 200);
    const dict = await i18n.text();
    assert.match(dict, /function t\(/);
    assert.match(dict, /zh-Hant/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
