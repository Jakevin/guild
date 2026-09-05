import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SITE = join(ROOT, "site/index.html");
const WORKFLOW = join(ROOT, ".github/workflows/pages.yml");

const PLAQUE_KEYS = [
  "pl.branch.t",
  "pl.mobile.t",
  "pl.free.t",
  "pl.reason.t",
  "pl.dispatch.t",
  "pl.guard.t",
] as const;
const PLAQUE_TITLES = [
  "Branch a quest",
  "/m away",
  "OpenCode Free",
  "Reasoning · speed",
  "Waves, not a pile-on",
  "Local guards",
] as const;

type ClickEv = {
  target: FakeNode;
  preventDefault: () => void;
};

type FakeNode = {
  tagName: string;
  id: string;
  className: string;
  attrs: Record<string, string>;
  children: FakeNode[];
  parent: FakeNode | null;
  textContent: string;
  innerHTML: string;
  value: string;
  scrollTop: number;
  scrollHeight: number;
  focused: boolean;
  rect: { top: number; height: number };
  listeners: Record<string, Array<(ev: ClickEv) => void>>;
  classList: { toggle: (name: string, force?: boolean) => void };
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: string, fn: (ev: ClickEv) => void) => void;
  appendChild: (child: FakeNode) => FakeNode;
  click: () => void;
  focus: (opts?: { preventScroll?: boolean }) => void;
  closest: (sel: string) => FakeNode | null;
  getBoundingClientRect: () => { top: number; height: number };
  querySelector: (sel: string) => FakeNode | null;
  querySelectorAll: (sel: string) => FakeNode[];
};

function matches(node: FakeNode, sel: string): boolean {
  if (sel.startsWith("#")) return node.id === sel.slice(1);
  if (sel.startsWith(".")) {
    return node.className.split(/\s+/).includes(sel.slice(1));
  }
  const eq = /^\[([^=\]]+)="([^"]+)"\]$/.exec(sel);
  if (eq) return node.getAttribute(eq[1]) === eq[2];
  const attr = /^\[([^=\]]+)\]$/.exec(sel);
  if (attr) return node.getAttribute(attr[1]) != null;
  return node.tagName === sel.toUpperCase();
}

function el(tag: string, attrs: Record<string, string> = {}, text = ""): FakeNode {
  const node: FakeNode = {
    tagName: tag.toUpperCase(),
    id: attrs.id ?? "",
    className: attrs.class ?? "",
    attrs: { ...attrs },
    children: [],
    parent: null,
    textContent: text,
    innerHTML: text,
    value: text,
    scrollTop: 0,
    scrollHeight: 0,
    focused: false,
    rect: { top: 0, height: 0 },
    listeners: {},
    classList: {
      toggle(name: string, force?: boolean) {
        const parts = new Set(node.className.split(/\s+/).filter(Boolean));
        if (force === true) parts.add(name);
        else if (force === false) parts.delete(name);
        else if (parts.has(name)) parts.delete(name);
        else parts.add(name);
        node.className = [...parts].join(" ");
      },
    },
    getAttribute(name: string) {
      if (name === "id") return node.id || null;
      if (name === "class") return node.className || null;
      return node.attrs[name] ?? null;
    },
    setAttribute(name: string, value: string) {
      node.attrs[name] = value;
      if (name === "id") node.id = value;
      if (name === "class") node.className = value;
    },
    addEventListener(type: string, fn: (ev: ClickEv) => void) {
      (node.listeners[type] ??= []).push(fn);
    },
    appendChild(child: FakeNode) {
      child.parent = node;
      node.children.push(child);
      return child;
    },
    click() {
      const ev: ClickEv = {
        target: node,
        preventDefault() {},
      };
      let cur: FakeNode | null = node;
      while (cur) {
        for (const fn of cur.listeners.click ?? []) fn(ev);
        cur = cur.parent;
      }
    },
    focus() {
      node.focused = true;
    },
    closest(sel: string) {
      let cur: FakeNode | null = node;
      while (cur) {
        if (matches(cur, sel)) return cur;
        cur = cur.parent;
      }
      return null;
    },
    getBoundingClientRect() {
      return node.rect;
    },
    querySelector(sel: string) {
      return node.querySelectorAll(sel)[0] ?? null;
    },
    querySelectorAll(sel: string) {
      const out: FakeNode[] = [];
      const walk = (cur: FakeNode) => {
        if (matches(cur, sel)) out.push(cur);
        for (const child of cur.children) walk(child);
      };
      for (const child of node.children) walk(child);
      return out;
    },
  };
  return node;
}

function loadPagesFixture(html: string) {
  const start = html.lastIndexOf("<script>");
  const end = html.lastIndexOf("</script>");
  assert.ok(start >= 0 && end > start, "fixture <script>");
  const script = html.slice(start + "<script>".length, end);
  const soulMatch = html.match(/<textarea id="soul"[^>]*>([\s\S]*?)<\/textarea>/);
  assert.ok(soulMatch, "soul textarea");

  const nodes: FakeNode[] = [];
  const byId = new Map<string, FakeNode>();
  const register = (node: FakeNode) => {
    nodes.push(node);
    if (node.id) byId.set(node.id, node);
    return node;
  };

  const documentElement = register(el("html", { lang: "en" }));
  const skip = register(el("a", { class: "skip", href: "#try" }, "Skip to the hall"));
  const nav = register(el("header", { class: "nav" }));
  nav.rect = { top: 0, height: 69 };
  const localeSwitch = register(el("div", { class: "locale-switch" }));
  for (const loc of ["zh-CN", "zh-TW", "en", "ja"]) {
    const btn = register(el("button", { "data-locale": loc, type: "button" }, loc));
    btn.parent = localeSwitch;
    localeSwitch.children.push(btn);
  }
  const tryEl = register(el("section", { id: "try", class: "block" }));
  tryEl.rect = { top: 1690, height: 400 };
  tryEl.setAttribute("tabindex", "-1");
  const thread = register(el("div", { id: "thread", class: "thread" }));
  Object.defineProperty(thread, "innerHTML", {
    get() {
      return thread.children.map((c) => c.innerHTML).join("");
    },
    set(value: string) {
      if (value === "") thread.children = [];
    },
    configurable: true,
  });
  const soul = register(el("textarea", { id: "soul" }, soulMatch[1]));
  soul.value = soulMatch[1];
  const soulStatus = register(el("span", { id: "soul-status" }));
  register(el("button", { id: "ask-pm", class: "chip", type: "button" }));
  register(el("button", { id: "ask-rd", class: "chip", type: "button" }));
  register(el("button", { id: "reset", class: "chip", type: "button" }));
  register(el("button", { id: "apply-soul", class: "btn", type: "button" }));
  register(el("button", { id: "copy-cli", class: "btn", type: "button" }));
  for (const handle of ["infra", "pm", "rd", "design", "marketing"]) {
    register(el("button", { class: "seat", "data-handle": handle, type: "button" }));
  }

  const location = { hash: "" };
  const windowObj = {
    scrollY: 0,
    scrollTo(_x: number, y: number) {
      windowObj.scrollY = y;
    },
  };
  const history = {
    replaceState(_state: unknown, _title: string, url: string) {
      if (url.includes("#")) location.hash = url.slice(url.indexOf("#"));
    },
  };
  const store = new Map<string, string>();
  let title = "";

  const document = {
    documentElement,
    get title() {
      return title;
    },
    set title(value: string) {
      title = value;
    },
    getElementById(id: string) {
      return byId.get(id) ?? null;
    },
    querySelector(sel: string) {
      return nodes.find((node) => matches(node, sel)) ?? null;
    },
    querySelectorAll(sel: string) {
      return nodes.filter((node) => matches(node, sel));
    },
    createElement(tag: string) {
      return el(tag);
    },
  };

  const run = new Function(
    "document",
    "window",
    "location",
    "history",
    "navigator",
    "localStorage",
    script,
  );
  run(document, windowObj, location, history, { language: "en-US" }, {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  });

  tryEl.focus = () => {
    tryEl.focused = true;
  };

  return {
    skip,
    tryEl,
    thread,
    soul,
    soulStatus,
    askPm: byId.get("ask-pm")!,
    askRd: byId.get("ask-rd")!,
    applySoul: byId.get("apply-soul")!,
    location,
    windowObj,
    document,
    seat(handle: string) {
      const node = nodes.find(
        (item) =>
          item.className.split(/\s+/).includes("seat") &&
          item.getAttribute("data-handle") === handle,
      );
      assert.ok(node, handle);
      return node;
    },
    locale(loc: string) {
      const node = nodes.find((item) => item.getAttribute("data-locale") === loc);
      assert.ok(node, loc);
      return node;
    },
    messages() {
      return thread.children.map((row) => {
        const who = /class="who">([^<]*)/.exec(row.innerHTML)?.[1] ?? "";
        const text = row.innerHTML
          .replace(/<span class="av"[^>]*>[^<]*<\/span>/, "")
          .replace(/<div class="who">[^<]*<\/div>/, "")
          .replace(/<br>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .trim();
        return { className: row.className, who, text };
      });
    },
  };
}

test("GitHub Pages demo is a fixture, not a live daemon", () => {
  const html = readFileSync(SITE, "utf8");
  const workflow = readFileSync(WORKFLOW, "utf8");
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as { version: string };
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
  assert.match(html, /name="theme-color" content="#f5f4ed"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type": "SoftwareApplication"/);
  assert.match(html, /reasoning, local-origin/);
  assert.match(html, /name="description" content="[^"]*reasoning, local-origin/);
  assert.match(html, /property="og:description" content="[^"]*reasoning, local-origin/);
  assert.match(html, /name="twitter:description" content="[^"]*reasoning, local-origin/);
  assert.match(
    html,
    new RegExp(
      `"description": "Guild ${pkg.version}\\. Node 22\\.19\\+\\. npx @kevin5251984/guild web opens http://127\\.0\\.0\\.1:7420\\. Branch, /m, OpenCode Free, reasoning, local-origin, schedule`,
    ),
  );
  assert.match(html, /data-i18n-html="td\.origin"/);
  assert.match(html, /data-i18n-html="td\.host"/);
  assert.match(html, /data-i18n-html="td\.env"/);
  assert.match(html, /data-i18n-html="td\.cron"/);
  assert.match(html, /name="description" content="[^"]*, schedule/);
  assert.match(html, /"faq\.q5"/);
  assert.match(html, /<tr><td>Schedule<\/td><td data-i18n-html="td\.cron">/);
  assert.match(html, /pause, resume, test run/);
  assert.match(html, /pause, resume, and a test run that returns to that hall/);
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
  assert.match(html, /--parchment:\s*#f5f4ed/);
  assert.match(html, /--brand:\s*#1B365D/);
  assert.match(html, /Charter, Georgia, Palatino/);
  assert.match(html, /TsangerJinKai02/);
  assert.match(html, /YuMincho/);
  assert.doesNotMatch(html, /family=Syne/);
  assert.doesNotMatch(html, /family=Cinzel/);
  assert.doesNotMatch(html, /family=Pixelify\+Sans/);
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
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as { version: string };
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
  assert.match(html, /id="try" tabindex="-1"/);
  assert.match(html, /querySelector\("\.skip"\)\.addEventListener\("click"/);
  assert.match(html, /window\.scrollTo\(0, y\)/);
  assert.match(html, /tryEl\.focus\(\{ preventScroll: true \}\)/);
  assert.match(html, /@media \(max-width: 640px\)[\s\S]*?\.nav nav \{[\s\S]*?flex: 1 1 100%/);
  assert.match(html, /\.nav \.locale-switch \{ flex: 0 1 auto; \}/);
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
  assert.match(html, new RegExp(`Guild ${pkg.version}`));
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

  const faqNeed: Record<string, { a5: string[]; row: string[]; forbid: string[] }> = {
    en: {
      a5: ["every 2h", "in 30m", "0 9 * * *", "pause, resume, and a test run that returns to that hall", "A run cannot schedule another job"],
      row: ["60s", "pause, resume, test run"],
      forbid: ["每天", "每日", "毎日"],
    },
    "zh-TW": {
      a5: ["每10分鐘", "10分鐘後", "每天9點", "in 30m", "暫停、恢復，測試執行會回到那個大廳", "排程執行不能再排新的"],
      row: ["60 秒", "暫停、恢復、測試執行"],
      forbid: [],
    },
    "zh-CN": {
      a5: ["每10分钟", "10分钟后", "每天9点", "in 30m", "暂停、恢复，测试执行会回到那个大厅", "排程执行不能再排新的"],
      row: ["60 秒", "暂停、恢复、测试执行"],
      forbid: [],
    },
    ja: {
      a5: ["in 30m", "every 2h", "0 9 * * *", "一時停止・再開、テスト実行", "cron 実行から cron は作れない"],
      row: ["60秒", "一時停止・再開・テスト実行"],
      forbid: ["每天", "每日", "毎日"],
    },
  };
  for (const loc of ["en", "zh-TW", "zh-CN", "ja"] as const) {
    const dict = I18N[loc] as Record<string, string>;
    const need = faqNeed[loc];
    for (const needle of need.a5) assert.ok(dict["faq.a5"].includes(needle), `${loc} faq.a5 has ${needle}`);
    for (const bad of need.forbid) assert.ok(!dict["faq.a5"].includes(bad), `${loc} faq.a5 lacks ${bad}`);
    for (const needle of need.row) assert.ok(dict["td.cron"].includes(needle), `${loc} td.cron has ${needle}`);
    for (const bad of need.forbid) assert.ok(!dict["td.cron"].includes(bad), `${loc} td.cron lacks ${bad}`);
  }
});

test("Pages locks six enamel plaques and 390px no-overflow CSS", () => {
  const html = readFileSync(SITE, "utf8");
  const plaques = [...html.matchAll(
    /<article class="plaque">\s*<h3 data-i18n="([^"]+)">([^<]+)<\/h3>/g,
  )];
  assert.equal(plaques.length, 6);
  assert.equal((html.match(/<article class="plaque">/g) ?? []).length, 6);
  assert.deepEqual(plaques.map((m) => m[1]), [...PLAQUE_KEYS]);
  assert.deepEqual(plaques.map((m) => m[2]), [...PLAQUE_TITLES]);
  assert.match(html, /id="tonight"/);
  assert.match(
    html,
    /\.plaques \{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    html,
    /@media \(max-width: 640px\) \{\s*\.plaques \{ grid-template-columns: 1fr; \}/,
  );
  assert.match(html, /@media \(max-width: 820px\) \{\s*\.hall-frame \{ grid-template-columns: 1fr;/);
  assert.match(html, /\.limits \{\s*width: 100%;/);
  assert.match(html, /\.term pre \{[\s\S]*?white-space:\s*pre-wrap;[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /--gutter:\s*clamp\(18px, 4vw, 48px\)/);
  assert.match(html, /<tr><td>Origin<\/td><td data-i18n-html="td\.origin">/);
  assert.match(html, /<tr><td>Host files<\/td><td data-i18n-html="td\.host">/);
  assert.match(html, /<tr><td>MCP env<\/td><td data-i18n-html="td\.env">/);
  assert.match(html, /<tr><td>Schedule<\/td><td data-i18n-html="td\.cron">/);
  assert.doesNotMatch(html, /white-space:\s*nowrap/);
  assert.doesNotMatch(html, /overflow-x\s*:/);
  assert.doesNotMatch(html, /<table[^>]*style=/);
});

test("Pages locale, seats, and chips are native buttons; Skip focuses #try", () => {
  const html = readFileSync(SITE, "utf8");
  const locales = [...html.matchAll(/<button type="button" data-locale="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(locales, ["zh-CN", "zh-TW", "en", "ja"]);
  const seats = [...html.matchAll(
    /<button type="button" class="seat" data-handle="([^"]+)"/g,
  )].map((m) => m[1]);
  assert.deepEqual(seats, ["infra", "pm", "rd", "design", "marketing"]);
  const chips = [...html.matchAll(/<button type="button" class="chip" id="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(chips, ["ask-pm", "ask-rd", "reset"]);
  assert.match(html, /<button type="button" class="btn" id="apply-soul"/);
  assert.match(html, /<a class="skip" href="#try"/);
  assert.match(html, /id="try" tabindex="-1"/);
  assert.equal((html.match(/<button /g) ?? []).length, 14);
  assert.equal((html.match(/<button type="button"/g) ?? []).length, 14);
  assert.doesNotMatch(html, /<button(?![^>]*type="button")/);
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /aria-pressed/);
  assert.match(html, /role="group"/);

  const page = loadPagesFixture(html);
  assert.equal(page.locale("en").getAttribute("aria-pressed"), "true");
  assert.equal(page.locale("zh-TW").getAttribute("aria-pressed"), "false");
  page.locale("zh-TW").click();
  assert.equal(page.document.documentElement.lang, "zh-Hant");
  assert.equal(page.locale("zh-TW").getAttribute("aria-pressed"), "true");
  assert.equal(page.locale("en").getAttribute("aria-pressed"), "false");

  page.skip.click();
  assert.equal(page.tryEl.focused, true);
  assert.equal(page.location.hash, "#try");
  assert.equal(page.windowObj.scrollY, 1690 - 69 - 8);
});

test("Pages fixture order is @pm then @rd then Save Voice then @pm Ship it:", () => {
  const html = readFileSync(SITE, "utf8");
  const page = loadPagesFixture(html);
  const start = html.indexOf("const I18N = {");
  const end = html.indexOf("\n    };", start);
  const I18N = new Function(`${html.slice(start, end + "\n    };".length)}\nreturn I18N;`)() as Record<
    string,
    Record<string, string>
  >;
  const en = I18N.en;

  let msgs = page.messages();
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].className, /\byou\b/);
  assert.equal(msgs[0].text, en.channel);

  page.askPm.click();
  msgs = page.messages();
  assert.equal(msgs.length, 3);
  assert.equal(msgs[1].text, en["ask.pm"]);
  assert.equal(msgs[2].who, "@pm · Project Manager");
  assert.equal(msgs[2].text, en["pm.before"]);
  assert.doesNotMatch(msgs[2].text, /^Ship it:/);
  assert.equal(page.seat("pm").className.split(/\s+/).includes("on"), true);

  page.askRd.click();
  msgs = page.messages();
  assert.equal(msgs.length, 5);
  assert.equal(msgs[3].text, en["ask.rd"]);
  assert.equal(msgs[4].who, "@rd · RD");
  assert.equal(msgs[4].text, en["rd.reply"]);
  assert.equal(page.seat("rd").className.split(/\s+/).includes("on"), true);
  assert.equal(page.seat("pm").className.split(/\s+/).includes("on"), false);

  assert.equal(page.soul.value.includes("Ship it:"), false);
  page.applySoul.click();
  assert.equal(page.soul.value.includes("Ship it:"), true);
  assert.match(page.soul.value, /## Voice\nStart every reply with "Ship it:"/);
  assert.equal(page.soulStatus.textContent, en["status.saved"]);

  page.seat("pm").click();
  msgs = page.messages();
  assert.equal(msgs.length, 7);
  assert.equal(msgs[5].text, en["ask.pm"]);
  assert.equal(msgs[6].who, "@pm · Project Manager");
  assert.equal(msgs[6].text, en["pm.after"]);
  assert.match(msgs[6].text, /^Ship it:/);
  assert.equal(page.seat("pm").className.split(/\s+/).includes("on"), true);
});
