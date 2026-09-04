import {
  FREEBUFF_CHAT_FLOOR,
  formatFreebuffError,
  type FreebuffAccessTier,
  type FreebuffErrorCode,
} from "./freebuff-chat.ts";

export const FREEBUFF_SELECTOR_PACK_VERSION = 1;

export type ProbeName =
  | "composer"
  | "send"
  | "modelPicker"
  | "modelOption"
  | "assistantTurn"
  | "generationComplete"
  | "newChat"
  | "loginMarker"
  | "waitingRoom"
  | "adOverlay"
  | "limitedBanner"
  | "sessionCap"
  | "remoteAgentToggle"
  | "reasoningNode";

export type ProbePhase = "login" | "send" | "stream" | "newChat";
export type ProbeNeed = "required" | "optional" | "forbidden";

export const PROBE_NAMES = [
  "composer",
  "send",
  "modelPicker",
  "modelOption",
  "assistantTurn",
  "generationComplete",
  "newChat",
  "loginMarker",
  "waitingRoom",
  "adOverlay",
  "limitedBanner",
  "sessionCap",
  "remoteAgentToggle",
  "reasoningNode",
] as const satisfies readonly ProbeName[];

export const PHASE_NEED: Record<ProbePhase, Partial<Record<ProbeName, ProbeNeed>>> = {
  login: {
    loginMarker: "forbidden",
    composer: "required",
    send: "optional",
    modelPicker: "required",
    modelOption: "required",
    assistantTurn: "optional",
    newChat: "optional",
    waitingRoom: "optional",
    adOverlay: "optional",
    limitedBanner: "optional",
    sessionCap: "optional",
    remoteAgentToggle: "optional",
  },
  send: {
    loginMarker: "forbidden",
    composer: "required",
    send: "optional",
    modelPicker: "required",
    modelOption: "required",
    assistantTurn: "optional",
    waitingRoom: "optional",
    adOverlay: "optional",
    limitedBanner: "optional",
    sessionCap: "optional",
    remoteAgentToggle: "optional",
  },
  stream: {
    loginMarker: "forbidden",
    composer: "required",
    assistantTurn: "required",
    generationComplete: "required",
    waitingRoom: "optional",
    adOverlay: "optional",
    sessionCap: "optional",
    reasoningNode: "optional",
  },
  newChat: {
    loginMarker: "forbidden",
    composer: "required",
    send: "optional",
    assistantTurn: "optional",
    newChat: "required",
    waitingRoom: "optional",
    adOverlay: "optional",
    sessionCap: "optional",
  },
};

export type DomNode = {
  tag: string;
  role: string;
  type: string;
  name: string;
  placeholder: string;
  ariaLabel: string;
  ariaDisabled: string;
  ariaPressed: string;
  ariaChecked: string;
  ariaHaspopup: string;
  ariaSelected: string;
  disabled: boolean;
  readOnly: boolean;
  contentEditable: boolean;
  selected: boolean;
  testId: string;
  dataRole: string;
  dataModelId: string;
  href: string;
  hidden: boolean;
  text: string;
};

export type DomScan = {
  href: string;
  nodes: DomNode[];
};

export type ProbeHit = {
  found: boolean;
  editable?: boolean;
  enabled?: boolean;
  on?: boolean | null;
};

export type ProbeSnapshot = {
  href: string;
  probes: Record<ProbeName, ProbeHit>;
  models: { id: string; name: string; selected?: boolean }[];
  selectedModel?: string;
  accessTier: FreebuffAccessTier;
};

export type ProbeVerdict = {
  name: ProbeName;
  need: ProbeNeed;
  ok: boolean;
  found: boolean;
};

export type ScoreOpts = {
  newChatPath?: "click" | "navigate";
  stream?: "wait" | "end";
  selectedModel?: string;
};

export type PhaseReport = {
  pack: number;
  phase: ProbePhase;
  ok: boolean;
  probes: ProbeVerdict[];
  failed: ProbeName[];
  code?: FreebuffErrorCode;
  detail?: string;
  availableModels?: string[];
};

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const SKIP_EMIT = new Set(["script", "style", "svg", "path", "noscript", "head", "meta", "link"]);
const SKIP_MATCH = new Set(["html", "body", "head"]);

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    attrs[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function emptyHit(): ProbeHit {
  return { found: false };
}

function blankProbes(): Record<ProbeName, ProbeHit> {
  const probes = {} as Record<ProbeName, ProbeHit>;
  for (const name of PROBE_NAMES) probes[name] = emptyHit();
  return probes;
}

export function parseDomScan(html: string, href = ""): DomScan {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const nodes: DomNode[] = [];
  type Frame = { tag: string; attrs: Record<string, string>; text: string[] };
  const stack: Frame[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  const emit = (frame: Frame) => {
    if (SKIP_EMIT.has(frame.tag)) return;
    const a = frame.attrs;
    const hidden =
      Object.prototype.hasOwnProperty.call(a, "hidden") || a["aria-hidden"] === "true";
    const selected =
      Object.prototype.hasOwnProperty.call(a, "selected") || a["aria-selected"] === "true";
    nodes.push({
      tag: frame.tag,
      role: a.role || "",
      type: a.type || "",
      name: a.name || "",
      placeholder: a.placeholder || "",
      ariaLabel: a["aria-label"] || "",
      ariaDisabled: a["aria-disabled"] || "",
      ariaPressed: a["aria-pressed"] || "",
      ariaChecked: a["aria-checked"] || "",
      ariaHaspopup: a["aria-haspopup"] || "",
      ariaSelected: a["aria-selected"] || "",
      disabled: Object.prototype.hasOwnProperty.call(a, "disabled") && a.disabled !== "false",
      readOnly: Object.prototype.hasOwnProperty.call(a, "readonly") && a.readonly !== "false",
      contentEditable: a.contenteditable === "true",
      selected,
      testId: a["data-testid"] || a["data-test-id"] || "",
      dataRole: a["data-role"] || a["data-author"] || a["data-message-author-role"] || "",
      dataModelId: a["data-model-id"] || a["data-model"] || a.value || "",
      href: a.href || "",
      hidden,
      text: frame.text.join("").replace(/\s+/g, " ").trim().slice(0, 240),
    });
  };
  while ((match = re.exec(cleaned))) {
    if (match[3] != null) {
      const text = decodeEntities(match[3]).replace(/\s+/g, " ");
      if (text && stack.length) stack[stack.length - 1]!.text.push(text);
      continue;
    }
    const tag = match[1]!.toLowerCase();
    const closing = match[0]!.startsWith("</");
    const attrRaw = match[2] || "";
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag !== tag) continue;
        const frame = stack[i]!;
        const parent = i > 0 ? stack[i - 1] : null;
        stack.splice(i);
        const blob = frame.text.join("");
        if (parent) parent.text.push(blob);
        emit(frame);
        break;
      }
      continue;
    }
    const attrs = parseAttrs(attrRaw);
    const frame: Frame = { tag, attrs, text: [] };
    if (VOID.has(tag) || /\/\s*$/.test(attrRaw)) emit(frame);
    else stack.push(frame);
  }
  while (stack.length) {
    const frame = stack.pop()!;
    if (stack.length) stack[stack.length - 1]!.text.push(frame.text.join(""));
    emit(frame);
  }
  return { href, nodes };
}

const SCAN_TAGS = [
  "textarea",
  "button",
  "a",
  "input",
  "select",
  "option",
  "article",
  "dialog",
  "form",
  "p",
  "h1",
  "h2",
  "h3",
  "label",
  "details",
  "summary",
  "li",
  "div",
  "span",
  "section",
] as const;

const SCAN_ROLES = [
  "textbox",
  "button",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "switch",
  "dialog",
  "article",
  "alert",
  "status",
  "banner",
] as const;

export const FREEBUFF_DOM_SCAN_SELECTOR = [
  ...SCAN_TAGS,
  ...SCAN_ROLES.map((role) => `[role="${role}"]`),
  '[contenteditable="true"]',
  "[data-testid]",
  "[data-test-id]",
  "[data-role]",
  "[data-author]",
  "[data-message-author-role]",
  "[data-model-id]",
  "[data-model]",
  "[aria-label]",
  "[placeholder]",
].join(",");

export function nodeMatchesDomScanSelector(node: DomNode): boolean {
  if ((SCAN_TAGS as readonly string[]).includes(node.tag)) return true;
  if ((SCAN_ROLES as readonly string[]).includes(node.role)) return true;
  if (node.contentEditable) return true;
  return Boolean(
    node.testId ||
      node.dataRole ||
      node.dataModelId ||
      node.ariaLabel ||
      node.placeholder,
  );
}

export const FREEBUFF_DOM_SCAN_JS = `(() => {
  const href = String(location.href || "");
  function visible(el) {
    if (!el || el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    try {
      const style = el.ownerDocument && el.ownerDocument.defaultView
        ? el.ownerDocument.defaultView.getComputedStyle(el)
        : null;
      if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
        return false;
      }
    } catch (e) { /* keep */ }
    try {
      const r = el.getBoundingClientRect();
      if (r && r.width === 0 && r.height === 0) return false;
    } catch (e) { /* keep */ }
    return true;
  }
  const skip = { SCRIPT:1, STYLE:1, SVG:1, PATH:1, NOSCRIPT:1, META:1, LINK:1, HEAD:1 };
  const seen = new Set();
  const nodes = [];
  const els = document.querySelectorAll(${JSON.stringify(FREEBUFF_DOM_SCAN_SELECTOR)});
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (seen.has(el) || skip[el.tagName]) continue;
    seen.add(el);
    const tag = String(el.tagName || "").toLowerCase();
    const text = String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240);
    nodes.push({
      tag: tag,
      role: el.getAttribute("role") || "",
      type: el.getAttribute("type") || "",
      name: el.getAttribute("name") || "",
      placeholder: el.getAttribute("placeholder") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      ariaDisabled: el.getAttribute("aria-disabled") || "",
      ariaPressed: el.getAttribute("aria-pressed") || "",
      ariaChecked: el.getAttribute("aria-checked") || "",
      ariaHaspopup: el.getAttribute("aria-haspopup") || "",
      ariaSelected: el.getAttribute("aria-selected") || "",
      disabled: Boolean(el.disabled),
      readOnly: Boolean(el.readOnly),
      contentEditable: el.getAttribute("contenteditable") === "true" || Boolean(el.isContentEditable),
      selected: el.selected === true || el.getAttribute("aria-selected") === "true",
      testId: el.getAttribute("data-testid") || el.getAttribute("data-test-id") || "",
      dataRole: el.getAttribute("data-role") || el.getAttribute("data-author") || el.getAttribute("data-message-author-role") || "",
      dataModelId: el.getAttribute("data-model-id") || el.getAttribute("data-model") || el.getAttribute("value") || "",
      href: el.getAttribute("href") || "",
      hidden: !visible(el),
      text: text
    });
  }
  return { href: href, nodes: nodes };
})()`;

function visibleNodes(nodes: DomNode[]): DomNode[] {
  return nodes.filter((n) => !n.hidden && !SKIP_MATCH.has(n.tag));
}

function blob(node: DomNode): string {
  return [node.ariaLabel, node.placeholder, node.name, node.testId, node.dataRole, node.text, node.href].join(" ");
}

function isButton(node: DomNode): boolean {
  return node.tag === "button" || node.role === "button" || (node.tag === "a" && Boolean(node.href));
}

function loginPathname(pathname: string): boolean {
  return /\/(login|signin|sign-in|sign-up|signup|auth|oauth)(\/|$)/i.test(pathname);
}

function loginUrl(href: string): boolean {
  try {
    return loginPathname(new URL(href).pathname);
  } catch {
    const path = href.split(/[?#]/, 1)[0] || "";
    return loginPathname(path.startsWith("/") ? path : `/${path}`);
  }
}

function isLoginMarker(node: DomNode): boolean {
  if (node.type === "password") return true;
  if (/login|signin|sign-up|signup|auth|challenge/i.test(node.testId)) return true;
  if (
    /login|signin|sign-up|signup|oauth|\/auth\b/i.test(node.href) &&
    (node.tag === "a" || node.tag === "form" || node.tag === "button")
  ) {
    return true;
  }
  const text = blob(node);
  if (isButton(node) && /continue with\s*(github|google)|sign in with|log in with/i.test(text)) {
    return true;
  }
  if (isButton(node) && /^(sign in|log in|sign up|登入|登录)\b/i.test(node.text.trim())) {
    return true;
  }
  return false;
}

function isSearchField(node: DomNode): boolean {
  if (node.type === "search" || node.role === "searchbox") return true;
  return /search|搜尋|搜索/i.test(node.placeholder + node.ariaLabel + node.name);
}

function isLoginField(node: DomNode): boolean {
  if (node.type === "password" || node.type === "email") return true;
  return /email|password|phone|otp|驗證碼/i.test(node.placeholder + node.name + node.ariaLabel);
}

function isComposer(node: DomNode): boolean {
  if (isSearchField(node) || isLoginField(node)) return false;
  return node.tag === "textarea" || node.contentEditable || node.role === "textbox";
}

function pickComposer(nodes: DomNode[]): DomNode | undefined {
  const cands = nodes.filter(isComposer);
  return (
    cands.find((n) => /message|ask|prompt|chat|anything|輸入|说|寫/i.test(n.placeholder + n.ariaLabel)) ||
    cands.at(-1)
  );
}

function isSend(node: DomNode): boolean {
  if (!isButton(node) && node.tag !== "input") return false;
  if (isLoginMarker(node)) return false;
  const text = blob(node);
  if (/stop|interrupt|停止|中止|取消生成/i.test(text) && !/send|submit|送出|发送|傳送/i.test(text)) {
    return false;
  }
  if (/send|submit|送出|发送|傳送/i.test(text)) return true;
  return node.type === "submit" && node.tag === "button";
}

function isStop(node: DomNode): boolean {
  if (!isButton(node)) return false;
  return /stop|interrupt|停止|中止|cancel generat/i.test(blob(node));
}

/** True while Freebuff is generating (Stop visible). send-ready must wait. */
export function scanHasStop(scan: Partial<DomScan> | null | undefined): boolean {
  const nodes = visibleNodes(Array.isArray(scan?.nodes) ? scan!.nodes! : []);
  return nodes.some(isStop);
}

function isNewChat(node: DomNode): boolean {
  if (!isButton(node)) return false;
  return /new chat|new conversation|新對話|新聊天|新会话/i.test(blob(node));
}

function isWaitingRoom(node: DomNode): boolean {
  return /waiting room|in queue|queue position|people ahead|排隊|排队|your position/i.test(blob(node));
}

function isAdOverlay(node: DomNode): boolean {
  const text = blob(node);
  if (!/sponsored|\bad\b|advertisement|promoted|earn credits|skip ad|watch (this )?ad/i.test(text)) {
    return false;
  }
  return node.role === "dialog" || node.tag === "dialog" || /overlay|modal|ad/i.test(node.testId + node.role);
}

function isLimitedBanner(node: DomNode): boolean {
  return /limited mode|limited access|受限模式|地區限制|地区限制/i.test(blob(node));
}

function isSessionCap(node: DomNode): boolean {
  return /session (limit|cap|exhausted)|out of sessions|no sessions left|daily (limit|quota|cap)|今日(額度|次数|次數)|次數用完|次数用完/i.test(
    blob(node),
  );
}

function isToggleControl(node: DomNode): boolean {
  if (node.role === "switch") return true;
  if (node.tag === "input" && (node.type === "checkbox" || node.type === "radio")) return true;
  if (node.ariaChecked !== "" || node.ariaPressed !== "") return true;
  return false;
}

function isRemoteAgent(node: DomNode): boolean {
  if (!isToggleControl(node)) return false;
  return /remote agent|agent mode|enable agent|遠端代理|远程代理/i.test(blob(node));
}

function isReasoning(node: DomNode): boolean {
  return /thinking|reasoning|思考|推理/i.test(node.testId + node.ariaLabel + node.dataRole) ||
    ((node.tag === "details" || node.tag === "summary") && /thinking|reasoning|思考|推理/i.test(node.text));
}

function isAssistantTurn(node: DomNode): boolean {
  if (/assistant|model|ai/i.test(node.dataRole) && !/user|human/i.test(node.dataRole)) return true;
  if (/assistant|ai-message|bot-message|model-response/i.test(node.testId)) return true;
  return node.tag === "article" && /assistant/i.test(blob(node));
}

function matchFloor(text: string): { id: string; name: string } | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  for (const row of FREEBUFF_CHAT_FLOOR) {
    if (t === row.id || t.includes(row.name) || new RegExp(`\\b${row.id}\\b`, "i").test(t)) return row;
  }
  if (/deepseek\s*v4\s*flash/i.test(t)) return FREEBUFF_CHAT_FLOOR[0];
  if (/glm\s*5\.3/i.test(t)) return FREEBUFF_CHAT_FLOOR[1];
  if (/gpt-?5\.6\s*luna/i.test(t)) return FREEBUFF_CHAT_FLOOR[2];
  if (/mimo\s*2\.5/i.test(t)) return FREEBUFF_CHAT_FLOOR[3];
  if (/solar\s*pro\s*4/i.test(t)) return FREEBUFF_CHAT_FLOOR[4];
  return undefined;
}

function sanitizeModelId(id: string): string | null {
  const t = id.trim();
  if (!t || t.includes("/") || /\s/.test(t)) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(t)) return null;
  return t;
}

function isModelPicker(node: DomNode): boolean {
  if (node.tag === "select") return true;
  if (node.role === "combobox" || node.role === "listbox") return true;
  if (isButton(node) && /listbox|menu/.test(node.ariaHaspopup)) return true;
  if (isButton(node) && /\bmodel\b|模型/.test(blob(node))) return true;
  if (isButton(node) && matchFloor(node.text + " " + node.ariaLabel)) return true;
  return false;
}

function isModelOption(node: DomNode): boolean {
  if (node.tag === "option" || node.role === "option" || node.role === "menuitem") return true;
  if (sanitizeModelId(node.dataModelId)) return true;
  if ((node.role === "listitem" || node.tag === "li") && matchFloor(node.text)) return true;
  return false;
}

function toggleOn(node: DomNode): boolean | null {
  if (node.ariaChecked === "true" || node.ariaPressed === "true" || node.selected) return true;
  if (node.ariaChecked === "false" || node.ariaPressed === "false") return false;
  if (node.tag === "input" && (node.type === "checkbox" || node.type === "radio")) {
    return node.selected;
  }
  return null;
}

function collectModels(nodes: DomNode[]): { id: string; name: string; selected?: boolean }[] {
  const out: { id: string; name: string; selected?: boolean }[] = [];
  const seen = new Set<string>();
  const add = (id: string, name: string, selected?: boolean) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, selected });
  };
  for (const node of nodes) {
    if (!isModelOption(node) && !isModelPicker(node)) continue;
    const floor = matchFloor([node.text, node.ariaLabel, node.dataModelId].join(" "));
    const id = floor?.id || sanitizeModelId(node.dataModelId);
    if (!id) continue;
    add(id, floor?.name || node.text.slice(0, 80) || id, node.selected || node.ariaSelected === "true");
  }
  return out;
}

function accessTierFromNodes(nodes: DomNode[]): FreebuffAccessTier {
  const text = nodes.map((n) => n.text).join(" ");
  if (/limited mode|limited access|受限模式|地區限制|地区限制/i.test(text)) return "limited";
  if (/full access|完整(存取|访问)/i.test(text)) return "full";
  return "unknown";
}

export function snapshotFromScan(scan: Partial<DomScan> | null | undefined): ProbeSnapshot {
  const href = String(scan?.href || "");
  const nodes = visibleNodes(Array.isArray(scan?.nodes) ? scan!.nodes! : []);
  const probes = blankProbes();
  const loginFound = loginUrl(href) || nodes.some(isLoginMarker);
  probes.loginMarker = { found: loginFound };
  const composer = pickComposer(nodes);
  probes.composer = composer
    ? { found: true, editable: !composer.disabled && !composer.readOnly }
    : emptyHit();
  const send = nodes.find(isSend);
  probes.send = send
    ? { found: true, enabled: !send.disabled && send.ariaDisabled !== "true" }
    : emptyHit();
  probes.modelPicker = { found: nodes.some(isModelPicker) };
  probes.modelOption = { found: nodes.some(isModelOption) };
  probes.assistantTurn = { found: nodes.some(isAssistantTurn) };
  const stop = nodes.some(isStop);
  probes.generationComplete = {
    found: Boolean(probes.send.found && probes.send.enabled && !stop),
  };
  probes.newChat = { found: nodes.some(isNewChat) };
  probes.waitingRoom = { found: nodes.some(isWaitingRoom) };
  probes.adOverlay = { found: nodes.some(isAdOverlay) };
  probes.limitedBanner = { found: nodes.some(isLimitedBanner) };
  probes.sessionCap = { found: nodes.some(isSessionCap) };
  const remote = nodes.find(isRemoteAgent);
  probes.remoteAgentToggle = remote
    ? { found: true, on: toggleOn(remote) }
    : { found: false, on: null };
  probes.reasoningNode = { found: nodes.some(isReasoning) };
  const models = collectModels(nodes);
  const selectedModel =
    models.find((row) => row.selected)?.id ||
    matchFloor(nodes.find(isModelPicker)?.text + " " + (nodes.find(isModelPicker)?.ariaLabel || ""))?.id ||
    models[0]?.id;
  return {
    href,
    probes,
    models,
    selectedModel,
    accessTier: accessTierFromNodes(nodes),
  };
}

export function probeNeed(
  phase: ProbePhase,
  name: ProbeName,
  opts: ScoreOpts = {},
): ProbeNeed | undefined {
  if (name === "newChat" && phase === "newChat" && (opts.newChatPath ?? "navigate") !== "click") {
    return "optional";
  }
  if (phase === "stream" && opts.stream !== "end") {
    if (name === "generationComplete") return undefined;
    if (name === "assistantTurn" || name === "composer") return "optional";
  }
  return PHASE_NEED[phase][name];
}

export function scorePhase(
  phase: ProbePhase,
  snap: ProbeSnapshot,
  opts: ScoreOpts = {},
): PhaseReport {
  const pickerOk =
    snap.probes.modelPicker.found || snap.probes.modelOption.found || snap.models.length > 0;
  const probes: ProbeVerdict[] = [];
  for (const name of PROBE_NAMES) {
    const need = probeNeed(phase, name, opts);
    if (!need) continue;
    const hit = snap.probes[name];
    const found = Boolean(hit?.found);
    let ok = true;
    if (need === "forbidden") ok = !found;
    else if (need === "required") {
      if (name === "modelPicker" || name === "modelOption") ok = pickerOk;
      else if (name === "composer") ok = found && hit?.editable !== false;
      // Live Chat disables Send while the composer is empty. send-ready is
      // "the control exists", not "it is already clickable".
      else if (name === "send") ok = found;
      else ok = found;
    }
    probes.push({ name, need, ok, found });
  }

  let code: FreebuffErrorCode | undefined;
  let failed: ProbeName[] = [];
  let detail: string | undefined;
  let availableModels: string[] | undefined;

  if (snap.probes.sessionCap.found) {
    code = "freebuff_session_cap";
    failed = ["sessionCap"];
  } else if (probes.some((row) => row.need === "forbidden" && !row.ok)) {
    code = "freebuff_login_required";
    failed = probes.filter((row) => row.need === "forbidden" && !row.ok).map((row) => row.name);
  } else if (snap.probes.remoteAgentToggle.found && snap.probes.remoteAgentToggle.on !== false) {
    code = "freebuff_remote_agent";
    failed = ["remoteAgentToggle"];
  } else {
    const selected = opts.selectedModel || snap.selectedModel;
    if (
      snap.probes.limitedBanner.found &&
      selected &&
      !snap.models.some((row) => row.id === selected)
    ) {
      code = "freebuff_limited_mode";
      failed = ["limitedBanner"];
      availableModels = snap.models.map((row) => row.id);
    } else {
      const reqFail = probes.filter((row) => row.need === "required" && !row.ok);
      if (reqFail.length) {
        code = "freebuff_ui_drift";
        failed = reqFail.map((row) => row.name);
        detail = `pack=${FREEBUFF_SELECTOR_PACK_VERSION} phase=${phase} probe=${failed[0]}`;
      }
    }
  }

  return {
    pack: FREEBUFF_SELECTOR_PACK_VERSION,
    phase,
    ok: !code,
    probes,
    failed,
    code,
    detail,
    availableModels,
  };
}

export function formatPhaseError(report: PhaseReport): string {
  if (!report.code) return "";
  const base = formatFreebuffError(report.code);
  if (report.code === "freebuff_ui_drift" && report.detail) return `${base} ${report.detail}`;
  if (report.code === "freebuff_limited_mode" && report.availableModels?.length) {
    return `${base} models=${report.availableModels.join(",")}`;
  }
  return base;
}
