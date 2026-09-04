import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { formatFreebuffError } from "../src/freebuff-chat.ts";
import {
  FREEBUFF_DOM_SCAN_JS,
  FREEBUFF_DOM_SCAN_SELECTOR,
  FREEBUFF_SELECTOR_PACK_VERSION,
  PHASE_NEED,
  formatPhaseError,
  nodeMatchesDomScanSelector,
  parseDomScan,
  probeNeed,
  scanHasStop,
  scorePhase,
  snapshotFromScan,
} from "../src/freebuff-selectors.ts";

const LOGIN_WALL = fileURLToPath(
  new URL("./fixtures/freebuff-login-wall.html", import.meta.url),
);
const CHAT_UNVERIFIED = fileURLToPath(
  new URL("./fixtures/freebuff-chat-session.unverified.html", import.meta.url),
);

function snapHtml(path: string, href: string) {
  return snapshotFromScan(parseDomScan(readFileSync(path, "utf8"), href));
}

test("selector pack version 1 stores required as a pack field", () => {
  assert.equal(FREEBUFF_SELECTOR_PACK_VERSION, 1);
  assert.equal(PHASE_NEED.login.loginMarker, "forbidden");
  assert.equal(PHASE_NEED.login.composer, "required");
  assert.equal(PHASE_NEED.login.send, "optional");
  assert.equal(PHASE_NEED.login.modelPicker, "required");
  assert.equal(PHASE_NEED.login.modelOption, "required");
  assert.equal(PHASE_NEED.send.send, "optional");
  assert.equal(PHASE_NEED.send.loginMarker, "forbidden");
  assert.equal(PHASE_NEED.stream.send, undefined);
  assert.equal(PHASE_NEED.stream.assistantTurn, "required");
  assert.equal(PHASE_NEED.stream.generationComplete, "required");
  assert.equal(PHASE_NEED.stream.reasoningNode, "optional");
  assert.equal(PHASE_NEED.newChat.newChat, "required");
  assert.equal(probeNeed("newChat", "newChat", { newChatPath: "navigate" }), "optional");
  assert.equal(probeNeed("newChat", "newChat", { newChatPath: "click" }), "required");
  assert.equal(probeNeed("stream", "assistantTurn", { stream: "wait" }), "optional");
  assert.equal(probeNeed("stream", "composer", { stream: "wait" }), "optional");
  assert.equal(probeNeed("stream", "composer", { stream: "end" }), "required");
  assert.equal(probeNeed("stream", "generationComplete", { stream: "wait" }), undefined);
  assert.equal(probeNeed("stream", "generationComplete", { stream: "end" }), "required");
});

test("login-wall fixture (live capture) is freebuff_login_required, not ui_drift", () => {
  const snap = snapHtml(LOGIN_WALL, "https://freebuff.com/login?callbackUrl=%2Fchat");
  assert.equal(snap.probes.loginMarker.found, true);
  assert.equal(snap.probes.composer.found, false);
  const report = scorePhase("login", snap);
  assert.equal(report.ok, false);
  assert.equal(report.code, "freebuff_login_required");
  assert.ok(report.failed.includes("loginMarker"));
  assert.doesNotMatch(JSON.stringify(report), /<html|innerHTML/);
  const sendPhase = scorePhase("send", snap);
  assert.equal(sendPhase.code, "freebuff_login_required");
  assert.ok(sendPhase.failed.includes("loginMarker"));
  assert.ok(!sendPhase.failed.includes("send"));
});

test("unverified chat session fixture passes login smoke", () => {
  const snap = snapHtml(CHAT_UNVERIFIED, "https://freebuff.com/chat");
  assert.equal(snap.probes.loginMarker.found, false);
  assert.equal(snap.probes.composer.found, true);
  assert.equal(snap.probes.composer.editable, true);
  assert.equal(snap.probes.send.found, true);
  assert.ok(snap.models.some((row) => row.id === "deepseek-v4-flash-0731"));
  assert.equal(snap.accessTier, "unknown");
  const report = scorePhase("login", snap);
  assert.equal(report.ok, true);
  assert.equal(report.code, undefined);
  assert.equal(report.pack, 1);
  assert.deepEqual(
    report.probes.filter((row) => row.need === "required").map((row) => row.name).sort(),
    ["composer", "modelOption", "modelPicker"].sort(),
  );
});

test("live Chat disables Send on an empty composer; send-ready still passes", () => {
  const html = `
    <main>
      <button type="button" aria-haspopup="menu" aria-label="Choose model. Current model: DeepSeek V4 Flash">DeepSeek V4 Flash</button>
      <textarea placeholder="Ask anything"></textarea>
      <button type="button" aria-label="Send message" disabled></button>
    </main>`;
  const snap = snapshotFromScan(parseDomScan(html, "https://freebuff.com/chat"));
  assert.equal(snap.probes.composer.found, true);
  assert.equal(snap.probes.send.found, true);
  assert.equal(snap.probes.send.enabled, false);
  assert.ok(snap.models.some((row) => row.id === "deepseek-v4-flash-0731"));
  const report = scorePhase("send", snap, { selectedModel: "deepseek-v4-flash-0731" });
  assert.equal(report.ok, true);
  assert.equal(report.code, undefined);
  assert.equal(scanHasStop(parseDomScan(html, "https://freebuff.com/chat")), false);
});

test("send-ready waits when Stop is visible", () => {
  const html = `
    <main>
      <button type="button" aria-label="Model">DeepSeek V4 Flash 07/31</button>
      <textarea placeholder="Ask anything">hello</textarea>
      <button type="button" aria-label="Stop generating">Stop</button>
    </main>`;
  const scan = parseDomScan(html, "https://freebuff.com/chat");
  assert.equal(scanHasStop(scan), true);
});

test("send-phase missing send is still send-ready when the composer is there", () => {
  const html = readFileSync(CHAT_UNVERIFIED, "utf8").replace(
    /<button type="submit" aria-label="Send">Send<\/button>/,
    "",
  );
  const snap = snapshotFromScan(parseDomScan(html, "https://freebuff.com/chat"));
  const report = scorePhase("send", snap);
  assert.equal(report.ok, true);
  assert.equal(report.code, undefined);
});

test("send-phase missing composer is freebuff_ui_drift", () => {
  const html = readFileSync(CHAT_UNVERIFIED, "utf8").replace(
    /<textarea role="textbox" placeholder="Ask anything"><\/textarea>/,
    "",
  );
  const snap = snapshotFromScan(parseDomScan(html, "https://freebuff.com/chat"));
  const report = scorePhase("send", snap);
  assert.equal(report.code, "freebuff_ui_drift");
  assert.ok(report.failed.includes("composer"));
  const text = formatPhaseError(report);
  assert.match(text, /^模型請求失敗：Freebuff Chat: freebuff_ui_drift — /);
  assert.match(text, /pack=1 phase=send probe=composer/);
  assert.equal(formatFreebuffError(text), text);
});

test("stream assistantTurn missing at start is wait, not drift", () => {
  const html = readFileSync(CHAT_UNVERIFIED, "utf8").replace(
    /<article data-role="assistant">Ready when you are\.<\/article>/,
    "",
  );
  const snap = snapshotFromScan(parseDomScan(html, "https://freebuff.com/chat"));
  const waiting = scorePhase("stream", snap, { stream: "wait" });
  assert.equal(waiting.code, undefined);
  assert.equal(waiting.ok, true);
  const ended = scorePhase("stream", snap, { stream: "end" });
  assert.equal(ended.code, "freebuff_ui_drift");
  assert.ok(ended.failed.includes("assistantTurn") || ended.failed.includes("generationComplete"));
  assert.match(String(ended.detail), /pack=1 phase=stream probe=/);
});

test("stream wait does not drift on a disabled composer", () => {
  const html = readFileSync(CHAT_UNVERIFIED, "utf8").replace(
    '<textarea role="textbox" placeholder="Ask anything"></textarea>',
    '<textarea role="textbox" placeholder="Ask anything" disabled></textarea>',
  );
  const snap = snapshotFromScan(parseDomScan(html, "https://freebuff.com/chat"));
  assert.equal(snap.probes.composer.editable, false);
  assert.equal(scorePhase("stream", snap, { stream: "wait" }).ok, true);
  const ended = scorePhase("stream", snap, { stream: "end" });
  assert.equal(ended.code, "freebuff_ui_drift");
  assert.ok(ended.failed.includes("composer"));
});

test("newChat click path requires the control; navigate fallback does not", () => {
  const html = readFileSync(CHAT_UNVERIFIED, "utf8").replace(
    /<button type="button" aria-label="New chat">New chat<\/button>/,
    "",
  );
  const snap = snapshotFromScan(parseDomScan(html, "https://freebuff.com/chat"));
  const viaNav = scorePhase("newChat", snap, { newChatPath: "navigate" });
  assert.equal(viaNav.ok, true);
  const viaClick = scorePhase("newChat", snap, { newChatPath: "click" });
  assert.equal(viaClick.code, "freebuff_ui_drift");
  assert.deepEqual(viaClick.failed, ["newChat"]);
});

test("sessionCap copy fails closed immediately", () => {
  const html =
    readFileSync(CHAT_UNVERIFIED, "utf8").replace(
      "</form>",
      '</form><p>You are out of sessions for today.</p>',
    );
  const snap = snapshotFromScan(parseDomScan(html, "https://freebuff.com/chat"));
  const report = scorePhase("login", snap);
  assert.equal(report.code, "freebuff_session_cap");
  assert.deepEqual(report.failed, ["sessionCap"]);
});

test("sessionCap copy in a bare banner div is fail-closed after CDP filter", () => {
  const html = `<main><div>You are out of sessions for today.</div><textarea placeholder="Ask anything"></textarea></main>`;
  const scan = parseDomScan(html, "https://freebuff.com/chat");
  const filtered = { ...scan, nodes: scan.nodes.filter(nodeMatchesDomScanSelector) };
  assert.ok(filtered.nodes.some((node) => node.tag === "div"));
  const report = scorePhase("login", snapshotFromScan(filtered));
  assert.equal(report.code, "freebuff_session_cap");
});

test("limited banner plus missing selected model is freebuff_limited_mode with ids", () => {
  const html = `
    <main>
      <p>Limited mode: some models are unavailable in this region.</p>
      <button aria-haspopup="listbox" aria-label="Model">MiMo 2.5</button>
      <div role="option" data-model-id="mimo-2.5">MiMo 2.5</div>
      <div role="option" data-model-id="deepseek-v4-flash-0731">DeepSeek V4 Flash 07/31</div>
      <textarea placeholder="Ask anything"></textarea>
    </main>`;
  const snap = snapshotFromScan(parseDomScan(html, "https://freebuff.com/chat"));
  assert.equal(snap.accessTier, "limited");
  const report = scorePhase("send", snap, { selectedModel: "gpt-5.6-luna" });
  assert.equal(report.code, "freebuff_limited_mode");
  assert.ok(report.availableModels?.includes("mimo-2.5"));
  assert.match(formatPhaseError(report), /models=.*mimo-2.5/);
});

test("remoteAgentToggle absent is fine; present and not off is freebuff_remote_agent", () => {
  const base = snapHtml(CHAT_UNVERIFIED, "https://freebuff.com/chat");
  assert.equal(base.probes.remoteAgentToggle.found, false);
  assert.equal(scorePhase("login", base).ok, true);
  assert.equal(scorePhase("send", base).code, undefined);
  const on = snapshotFromScan(
    parseDomScan(
      readFileSync(CHAT_UNVERIFIED, "utf8").replace(
        "</form>",
        '</form><button role="switch" aria-checked="true">Remote agent</button>',
      ),
      "https://freebuff.com/chat",
    ),
  );
  assert.equal(scorePhase("login", on).code, "freebuff_remote_agent");
  const off = snapshotFromScan(
    parseDomScan(
      readFileSync(CHAT_UNVERIFIED, "utf8").replace(
        "</form>",
        '</form><button role="switch" aria-checked="false">Remote agent</button>',
      ),
      "https://freebuff.com/chat",
    ),
  );
  assert.equal(scorePhase("login", off).ok, true);
});

test("modelPicker or modelOption either readable satisfies the pair", () => {
  const pickerOnly = snapshotFromScan(
    parseDomScan(
      `<main><button aria-label="Model">DeepSeek V4 Flash 07/31</button><textarea placeholder="Ask anything"></textarea></main>`,
      "https://freebuff.com/chat",
    ),
  );
  assert.equal(scorePhase("login", pickerOnly).ok, true);
  const optionOnly = snapshotFromScan(
    parseDomScan(
      `<main><div role="option" data-model-id="glm-5.3-flash">GLM 5.3 Flash</div><textarea placeholder="Ask anything"></textarea></main>`,
      "https://freebuff.com/chat",
    ),
  );
  assert.equal(scorePhase("login", optionOnly).ok, true);
});

test("author in a query string is not a loginMarker", () => {
  const snap = snapHtml(CHAT_UNVERIFIED, "https://freebuff.com/chat?ref=author");
  assert.equal(snap.probes.loginMarker.found, false);
  assert.equal(scorePhase("send", snap).ok, true);
  const login = snapHtml(LOGIN_WALL, "https://freebuff.com/login?callbackUrl=%2Fchat");
  assert.equal(login.probes.loginMarker.found, true);
});

test("CDP scan selector still finds composer after a long thread", () => {
  assert.match(FREEBUFF_DOM_SCAN_SELECTOR, /textarea/);
  assert.doesNotMatch(FREEBUFF_DOM_SCAN_JS, /Math\.min\([^)]*500/);
  const junk = Array.from({ length: 600 }, (_, i) => `<span>msg ${i}</span>`).join("");
  const html = `<main>${junk}<textarea placeholder="Ask anything"></textarea><button aria-label="Send">Send</button></main>`;
  const scan = parseDomScan(html, "https://freebuff.com/chat");
  const filtered = { ...scan, nodes: scan.nodes.filter(nodeMatchesDomScanSelector) };
  assert.ok(filtered.nodes.length < scan.nodes.length);
  const snap = snapshotFromScan(filtered);
  assert.equal(snap.probes.composer.found, true);
  assert.equal(snap.probes.send.found, true);
});

test("accessTier comes from banner text, not GeoIP", () => {
  const full = snapshotFromScan(
    parseDomScan(`<p>Full access</p><textarea placeholder="Ask anything"></textarea>`, "https://freebuff.com/chat"),
  );
  assert.equal(full.accessTier, "full");
  const unknown = snapshotFromScan(
    parseDomScan(`<textarea placeholder="Ask anything"></textarea>`, "https://freebuff.com/chat"),
  );
  assert.equal(unknown.accessTier, "unknown");
});
