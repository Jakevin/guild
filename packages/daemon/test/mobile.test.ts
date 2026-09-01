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
  assert.match(css, /--tap:\s*44px/);
  assert.match(css, /min-height:\s*var\(--tap\)/);
  assert.match(css, /safe-area-inset/);
  assert.doesNotMatch(html, /href="\/studio"/);
  assert.doesNotMatch(html, /href="\/library"/);
});
