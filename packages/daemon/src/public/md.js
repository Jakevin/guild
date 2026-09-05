/** Small Markdown renderer for assistant replies. Escapes HTML first. */
function escapeMd(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isFileCode(text) {
  const s = String(text).trim();
  if (!s || s.length > 180 || /\s/.test(s) || /^https?:/i.test(s)) return false;
  if (
    /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|html|css|scss|rs|py|go|kt|java|swift|toml|ya?ml|sh|bash|sql|proto|txt|xml|svg|lock)$/i.test(
      s,
    )
  ) {
    return true;
  }
  return /[A-Za-z0-9]\/[A-Za-z0-9._@+-]/.test(s);
}

function localImgSrc(href) {
  const raw = String(href || "")
    .trim()
    .replace(/"/g, "");
  if (!raw) return "";
  if (/^\/generated\/[A-Za-z0-9._-]+\.mp3$/i.test(raw)) return "";
  if (/^\/generated\/[A-Za-z0-9._-]+$/.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  let path = raw;
  if (/^file:\/\//i.test(path)) path = path.replace(/^file:\/\//i, "");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) {
    return "";
  }
  if (!/\.(?:png|jpe?g|gif|webp)$/i.test(path)) return "";
  return "/local?p=" + encodeURIComponent(path);
}

function localAudioSrc(href) {
  const raw = String(href || "")
    .trim()
    .replace(/"/g, "");
  if (/^\/generated\/[A-Za-z0-9._-]+\.mp3$/i.test(raw)) return raw;
  return "";
}

function audioTag(src, label) {
  const cap = label
    ? '<span class="md-audio-cap">' + label + "</span>"
    : "";
  return (
    '<span class="md-audio-wrap">' +
    '<audio class="md-audio" controls preload="none" src="' +
    src +
    '"></audio>' +
    cap +
    "</span>"
  );
}

function inlineMd(text) {
  let out = escapeMd(text);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, href) {
    const audio = localAudioSrc(href);
    if (audio) return audioTag(audio, alt);
    const src = localImgSrc(href);
    if (!src) return m;
    const label = alt || "image";
    return (
      '<a class="md-img-link" href="' +
      src +
      '" target="_blank" rel="noopener noreferrer">' +
      '<img class="md-img" src="' +
      src +
      '" alt="' +
      label +
      '" loading="lazy"></a>'
    );
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, href) {
    const audio = localAudioSrc(href);
    if (audio) return audioTag(audio, label);
    if (!/^https?:/i.test(href)) return m;
    return (
      '<a href="' +
      href.replace(/"/g, "") +
      '" target="_blank" rel="noopener noreferrer">' +
      label +
      "</a>"
    );
  });
  out = out.replace(/`([^`]+)`/g, function (_m, code) {
    const cls = isFileCode(code) ? ' class="md-file"' : "";
    return "<code" + cls + ">" + code + "</code>";
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1<em>$2</em>");
  return out;
}

function fenceIconFile() {
  return '<svg class="md-fence-ico" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 1.6h4.1L9.2 3.7v6.7H3V1.6Z" stroke="currentColor" stroke-width="1.1"/><path d="M7 1.6v2.1h2.2" stroke="currentColor" stroke-width="1.1"/></svg>';
}
function fenceIconAt() {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.4" stroke="currentColor" stroke-width="1.2"/><path d="M9.15 7v1.05a1.35 1.35 0 0 0 2.5.45" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M9.15 5.35v3.35" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
}
function fenceIconCopy() {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.3" stroke="currentColor" stroke-width="1.2"/><path d="M9.4 4.25V3.5A1.4 1.4 0 0 0 8 2.1H3.5A1.4 1.4 0 0 0 2.1 3.5V8A1.4 1.4 0 0 0 3.5 9.4H4.3" stroke="currentColor" stroke-width="1.2"/></svg>';
}
function fenceIconExpand() {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M8.2 2.2h3.6v3.6M5.8 11.8H2.2V8.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.5 2.5 8.2 5.8M2.5 11.5 5.8 8.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
}
function splitTableRow(line) {
  let s = String(line).trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !/(^|[^\\])\\\|$/.test(s)) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i += 1;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isTableSep(line) {
  const cells = splitTableRow(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
  );
}

function isTableRow(line) {
  return /\|/.test(line) && !/^%%FENCE\d+%%$/.test(String(line).trim());
}

function isTableStart(lines, i) {
  return (
    i + 1 < lines.length &&
    isTableRow(lines[i]) &&
    !isTableSep(lines[i]) &&
    isTableSep(lines[i + 1])
  );
}

function alignClass(spec) {
  const s = String(spec).replace(/\s/g, "");
  const left = s.startsWith(":");
  const right = s.endsWith(":");
  if (left && right) return "md-al-center";
  if (right) return "md-al-right";
  if (left) return "md-al-left";
  return "";
}

function renderTableCell(tag, text, align) {
  return (
    "<" +
    tag +
    (align ? ' class="' + align + '"' : "") +
    ">" +
    inlineMd(text) +
    "</" +
    tag +
    ">"
  );
}

function renderTable(header, aligns, rows) {
  const cols = Math.max(
    header.length,
    aligns.length,
    ...rows.map((row) => row.length),
    1,
  );
  const head = [];
  for (let c = 0; c < cols; c += 1) {
    head.push(renderTableCell("th", header[c] || "", aligns[c] || ""));
  }
  const body = rows
    .map((row) => {
      const cells = [];
      for (let c = 0; c < cols; c += 1) {
        cells.push(renderTableCell("td", row[c] || "", aligns[c] || ""));
      }
      return "<tr>" + cells.join("") + "</tr>";
    })
    .join("");
  return (
    '<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
    head.join("") +
    "</tr></thead>" +
    (body ? "<tbody>" + body + "</tbody>" : "") +
    "</table></div>"
  );
}

function isHtmlPreviewLang(lang) {
  return /^(html|htm|svg)$/i.test(String(lang || ""));
}

function tt(key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

function renderFence(lang, code) {
  const label = lang || "text";
  const body = escapeMd(String(code).replace(/\n$/, ""));
  const preview = isHtmlPreviewLang(lang);
  const tabs = preview
    ? '<span class="md-fence-tabs">' +
      '<button type="button" class="md-fence-tab on" data-html-view="preview">' +
      tt("html.preview", "預覽") +
      "</button>" +
      '<button type="button" class="md-fence-tab" data-html-view="code">' +
      tt("html.code", "原始碼") +
      "</button>" +
      "</span>"
    : "";
  const frame = preview
    ? '<iframe class="md-html-frame" sandbox="allow-scripts" title="HTML preview"></iframe>' +
      '<textarea class="md-html-src" hidden>' +
      body +
      "</textarea>"
    : "";
  return (
    '<div class="md-fence' +
    (preview ? " md-html-preview" : "") +
    '"' +
    (preview ? ' data-view="preview"' : "") +
    ">" +
    '<div class="md-fence-bar">' +
    '<span class="md-fence-lang">' +
    fenceIconFile() +
    escapeMd(label) +
    "</span>" +
    tabs +
    '<span class="md-fence-acts">' +
    (preview
      ? '<button type="button" class="md-fence-btn" data-html-expand title="' +
        tt("html.expand", "放大預覽") +
        '" aria-label="' +
        tt("html.expand", "放大預覽") +
        '">' +
        fenceIconExpand() +
        "</button>"
      : "") +
    '<button type="button" class="md-fence-btn" data-fence-input title="' +
    tt("fence.toInput", "加入輸入框") +
    '" aria-label="' +
    tt("fence.toInput", "加入輸入框") +
    '">' +
    fenceIconAt() +
    "</button>" +
    '<button type="button" class="md-fence-btn" data-fence-copy title="' +
    tt("copy", "複製") +
    '" aria-label="' +
    tt("copy", "複製") +
    '">' +
    fenceIconCopy() +
    "</button>" +
    "</span></div>" +
    frame +
    '<pre class="md-pre"' +
    (preview ? " hidden" : "") +
    "><code>" +
    body +
    "</code></pre></div>"
  );
}

function renderMarkdown(raw) {
  const source = String(raw ?? "").replace(/\r\n/g, "\n");
  const fences = [];
  const withFences = source.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, function (_m, lang, code) {
    const i = fences.length;
    fences.push(renderFence(lang, code));
    return "\n\n%%FENCE" + i + "%%\n\n";
  });
  const lines = withFences.split("\n");
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.trim().match(/^%%FENCE(\d+)%%$/);
    if (fence) {
      html.push(fences[Number(fence[1])] || "");
      i += 1;
      continue;
    }
    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      html.push("<h" + level + ">" + inlineMd(heading[2]) + "</h" + level + ">");
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      html.push("<blockquote>" + inlineMd(quoted.join(" ")) + "</blockquote>");
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push("<li>" + inlineMd(lines[i].replace(/^[-*]\s+/, "")) + "</li>");
        i += 1;
      }
      html.push("<ul>" + items.join("") + "</ul>");
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push("<li>" + inlineMd(lines[i].replace(/^\d+\.\s+/, "")) + "</li>");
        i += 1;
      }
      html.push("<ol>" + items.join("") + "</ol>");
      continue;
    }
    if (isTableStart(lines, i)) {
      const header = splitTableRow(lines[i]);
      const aligns = splitTableRow(lines[i + 1]).map(alignClass);
      i += 2;
      const rows = [];
      while (
        i < lines.length &&
        isTableRow(lines[i]) &&
        !isTableSep(lines[i]) &&
        !/^\s*$/.test(lines[i])
      ) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      html.push(renderTable(header, aligns, rows));
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^%%FENCE\d+%%$/.test(lines[i].trim()) &&
      !isTableStart(lines, i)
    ) {
      para.push(lines[i]);
      i += 1;
    }
    html.push("<p>" + inlineMd(para.join("\n")).replace(/\n/g, "<br>") + "</p>");
  }
  return html.join("");
}

function htmlPreviewSrcdoc(raw, lang) {
  const text = String(raw || "");
  if (/svg/i.test(String(lang || ""))) {
    return (
      '<!doctype html><html><body style="margin:0;background:#fff">' +
      text +
      "</body></html>"
    );
  }
  if (/<!doctype html|<html[\s>]/i.test(text)) return text;
  return (
    '<!doctype html><html><body style="margin:0;background:transparent">' +
    text +
    "</body></html>"
  );
}

function hydrateHtmlPreviews(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll(".md-html-preview").forEach((box) => {
    const src = box.querySelector(".md-html-src");
    const frame = box.querySelector(".md-html-frame");
    if (!src || !frame) return;
    const raw = src.value;
    const lang = (box.querySelector(".md-fence-lang") || {}).textContent || "";
    const doc = htmlPreviewSrcdoc(raw, lang);
    if (frame.dataset.ready && frame.srcdoc === doc) return;
    frame.dataset.ready = "1";
    frame.srcdoc = doc;
  });
}

function holdHtmlFrames(root) {
  const frames = [];
  if (!root || typeof root.querySelectorAll !== "function") return frames;
  root.querySelectorAll("article.msg .md-html-preview").forEach((box) => {
    const article = box.closest("article.msg[data-id]");
    const frame = box.querySelector(".md-html-frame");
    const src = box.querySelector(".md-html-src");
    if (!article || !frame || !src || !frame.dataset.ready) return;
    frames.push({
      id: article.getAttribute("data-id"),
      src: src.value,
      view: box.getAttribute("data-view") || "preview",
      frame: frame,
    });
  });
  return frames;
}

function putHtmlFrames(root, frames) {
  if (!root || typeof root.querySelector !== "function") return;
  (frames || []).forEach((item) => {
    const article = root.querySelector(
      'article.msg[data-id="' + CSS.escape(item.id) + '"]',
    );
    const box = article && article.querySelector(".md-html-preview");
    const src = box && box.querySelector(".md-html-src");
    const fresh = box && box.querySelector(".md-html-frame");
    if (!box || !src || !fresh || src.value !== item.src) return;
    item.frame.dataset.ready = "1";
    fresh.replaceWith(item.frame);
    box.setAttribute("data-view", item.view);
    box.querySelectorAll("[data-html-view]").forEach((tab) => {
      tab.classList.toggle("on", tab.getAttribute("data-html-view") === item.view);
    });
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    renderMarkdown,
    inlineMd,
    hydrateHtmlPreviews,
    htmlPreviewSrcdoc,
    holdHtmlFrames,
    putHtmlFrames,
    localImgSrc,
    localAudioSrc,
  };
}
