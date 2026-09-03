import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { closeServer, listen as listenApp, tempHome } from "./app.ts";

const MOBILE_HTML = fileURLToPath(
  new URL("../src/public/mobile.html", import.meta.url),
);
const MOBILE_CSS = fileURLToPath(
  new URL("../src/public/mobile.css", import.meta.url),
);
const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);

async function listen(dataDir: string) {
  const app = await listenApp(dataDir);
  return { server: app.server, origin: app.origin };
}

test("GET /m serves a dedicated away page, not the hall", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const response = await fetch(`${origin}/m`);
    const html = await response.text();
    const hall = await fetch(`${origin}/`).then((r) => r.text());
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.notEqual(html, hall);
    assert.match(html, /data-i18n-page="mobile"/);
    assert.match(html, /src="\/i18n\.js/);
    assert.match(html, /href="\/mobile\.css/);
    assert.match(html, /href="\/favicon\.svg"/);
    assert.match(html, /id="channels"/);
    assert.match(html, /id="dms"/);
    assert.match(html, /id="thread"/);
    assert.match(html, /id="draft"/);
    assert.match(html, /id="mention-pop"/);
    assert.match(html, /\/workspace/);
    assert.match(html, /mentions/);
    assert.match(html, /\/live/);
    assert.match(html, /\/abort/);
    assert.match(html, /\/pause/);
    assert.match(html, /\/continue/);
    assert.match(html, /data-live-pause/);
    assert.match(html, /data-live-continue/);
    assert.match(html, /tailscale/i);
    assert.doesNotMatch(html, /href="\/studio"/);
    assert.doesNotMatch(html, /href="\/library"/);
    assert.doesNotMatch(html, /href="\/settings"/);
    assert.doesNotMatch(html, /inn-street/);
    assert.doesNotMatch(html, /data-branch/);
    assert.doesNotMatch(html, /id="traj-btn"/);
    assert.doesNotMatch(html, /attach-upload/);
    const css = await fetch(`${origin}/mobile.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
  } finally {
    await closeServer(server);
  }
});

test("away page is a lite client: list, live, @ send, large taps", () => {
  const html = readFileSync(MOBILE_HTML, "utf8");
  const css = readFileSync(MOBILE_CSS, "utf8");
  assert.match(html, /#c\//);
  assert.match(html, /#d\//);
  assert.match(html, /payload\.mentions/);
  assert.match(html, /deepDiving/);
  assert.match(html, /live\.stop/);
  assert.match(html, /summonedBotIds|botsFromSend/);
  assert.match(html, /hydrateHtmlPreviews/);
  assert.match(html, /holdHtmlFrames/);
  assert.match(html, /putHtmlFrames/);
  assert.match(html, /data-id="/);
  assert.match(html, /sameMessages/);
  assert.match(html, /id="html-zoom"/);
  assert.match(html, /data-html-view/);
  assert.match(html, /openHtmlZoom/);
  assert.doesNotMatch(html, /cleaned\.length > 8000/);
  assert.match(css, /\.md-html-frame/);
  assert.match(css, /\.html-zoom/);
  assert.match(css, /--tap:\s*44px/);
  assert.match(css, /min-height:\s*var\(--tap\)/);
  assert.match(css, /safe-area-inset/);
  assert.doesNotMatch(html, /href="\/studio"/);
  assert.doesNotMatch(html, /href="\/library"/);
});

test("away page shares the hall's enamel tokens and press language", () => {
  const css = readFileSync(MOBILE_CSS, "utf8");
  assert.match(css, /--enamel:/);
  assert.match(css, /--paper:/);
  assert.match(css, /--bubble:/);
  assert.match(css, /--danger:/);
  assert.match(css, /--press:\s*0\.97/);
  assert.match(css, /--ease-out:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  assert.match(css, /--press-ms:\s*140ms/);
  assert.match(css, /--hover-ms:\s*160ms/);
  assert.match(css, /transform:\s*scale\(var\(--press\)\)/);
  assert.doesNotMatch(css, /transition:\s*all/);
  // Send is the one paper CTA; Stop stays a ghost on --fill/--lift.
  assert.match(css, /\.send \{\s*background: var\(--paper\);\s*color: var\(--ink\);/);
  assert.match(css, /\.turn-stop,\n\.stop-all \{\s*color: var\(--danger\);\s*background: var\(--fill\);/);
  assert.match(css, /\.msg\.bot \.bubble \{\s*background: var\(--bubble\);/);
  assert.match(
    css,
    /box-shadow: 0 0 0 1px color-mix\(in srgb, var\(--steel\) 38%, transparent\)/,
  );
  assert.match(css, /\.flash\.err \{[\s\S]*?background: var\(--lift\);[\s\S]*?color: var\(--danger\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transform: none/);
  assert.doesNotMatch(css, /#16100B/i);
  assert.doesNotMatch(css, /Quest board/i);
  assert.doesNotMatch(css, /#2a2a2a/i);
  assert.doesNotMatch(css, /#1c1c1c/i);
  assert.doesNotMatch(css, /#3a3a3a/i);
  assert.doesNotMatch(css, /#1a1a1a/i);
  assert.doesNotMatch(css, /#6f6f6f/i);
  assert.doesNotMatch(css, /#cfcfcf/i);
});

test("away page locks the five seats and can steer a live turn", () => {
  const html = readFileSync(MOBILE_HTML, "utf8");
  const chat = readFileSync(CHAT_HTML, "utf8");
  for (const page of [html, chat]) {
    assert.match(page, /SEAT_HUE/);
    assert.match(page, /infra: "#5b8def"/);
    assert.match(page, /pm: "#2ea887"/);
    assert.match(page, /rd: "#e07a3d"/);
    assert.match(page, /design: "#7c6af7"/);
    assert.match(page, /marketing: "#d4537e"/);
    assert.match(page, /const COLORS = \["#7c6af7", "#5b8def", "#2ea887", "#e07a3d", "#d4537e"\]/);
    assert.doesNotMatch(page, /gold:|seats: 6|第六席/);
  }
  assert.match(html, /\/steer/);
  assert.match(html, /data-live-steer/);
  assert.match(html, /id="steer"/);
  assert.match(html, /class="steer"/);
  assert.match(html, /t\("live\.steer"\)/);
  assert.match(html, /steer\.hint|live\.steer/);
  assert.match(html, /method: "POST"[\s\S]*?body: JSON\.stringify\(payload\)/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /classList\.toggle\("err"/);
  assert.match(html, /mobile\.css\?v=html-frame/);
  assert.doesNotMatch(html, /WebSocket/);
  assert.doesNotMatch(html, /fonts\.googleapis/);
  assert.doesNotMatch(html, /inn-street|#16100B/);
});
