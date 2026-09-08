import { StoreError } from "./store.ts";

export type ListingKind = "info" | "share";

export type ListingRef = {
  href: string;
  kind: ListingKind;
  slug?: string;
  shareId?: string;
};

export type ListingDraft = {
  name: string;
  handle: string;
  oneLiner: string;
  sourceUrl: string;
  kind: ListingKind;
  author?: string;
  listingId?: string;
  thin: boolean;
  soul: { name: string; body: string };
  agent: { name: string; body: string };
  position: { name: string; body: string };
  skillIds: string[];
};

const MAX_BYTES = 400_000;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "guildd-listing-draft";
const ALLOWED_HOSTS = new Set(["x.ai", "www.x.ai"]);
const INFO_PATH = /^\/bot\/marketplace\/bots\/([a-z0-9][a-z0-9-]{0,80})$/i;
const SHARE_PATH = /^\/bot\/([A-Za-z0-9_-]{12,80})$/;
const SHARE_RESERVED = new Set(["marketplace", "download"]);

const INFO_HINT =
  "paste a Grok Bot marketplace info page (https://x.ai/bot/marketplace/bots/…)";

export function parseListingInput(raw: string): ListingRef {
  const trimmed = raw.trim();
  if (!trimmed) throw new StoreError(400, "listing URL is required");

  if (/^grokbot:/i.test(trimmed)) {
    throw new StoreError(
      400,
      "that is the Grok Bot Add link; paste the marketplace info page instead",
    );
  }

  let href = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    if (href.startsWith("//")) href = `https:${href}`;
    else if (href.startsWith("/")) href = `https://x.ai${href}`;
    else if (/^(www\.)?x\.ai\//i.test(href)) href = `https://${href}`;
    else if (/^bot\/marketplace\/bots\//i.test(href)) {
      href = `https://x.ai/${href}`;
    } else if (/^marketplace\/bots\//i.test(href)) {
      href = `https://x.ai/bot/${href}`;
    } else {
      throw new StoreError(400, INFO_HINT);
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    throw new StoreError(400, "invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new StoreError(400, INFO_HINT);
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) throw new StoreError(400, INFO_HINT);

  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const info = path.match(INFO_PATH);
  if (info) {
    const slug = info[1].toLowerCase();
    return {
      href: `https://x.ai/bot/marketplace/bots/${slug}`,
      kind: "info",
      slug,
    };
  }
  const share = path.match(SHARE_PATH);
  if (share) {
    const shareId = share[1];
    if (SHARE_RESERVED.has(shareId.toLowerCase())) {
      throw new StoreError(400, INFO_HINT);
    }
    return {
      href: `https://x.ai/bot/${shareId}`,
      kind: "share",
      shareId,
    };
  }
  throw new StoreError(400, INFO_HINT);
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function slugifyHandle(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "bot";
}

function cleanTitle(raw: string): string {
  let text = decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();
  text = text.replace(/^Grok Bot\s*[·|]\s*/i, "");
  text = text.replace(/\s*[·|]\s*Grok Bot$/i, "");
  text = text.replace(/\s*[·|]\s*Bot Marketplace$/i, "");
  return text.trim();
}

function metaContent(html: string, key: string): string {
  const property = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i",
  );
  const match = html.match(re);
  if (match) return decodeHtmlEntities(match[1]).trim();
  const reFlip = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["'][^>]*>`,
    "i",
  );
  const flip = html.match(reFlip);
  return flip ? decodeHtmlEntities(flip[1]).trim() : "";
}

function tagText(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return "";
  return cleanTitle(match[1].replace(/<[^>]+>/g, " "));
}

function jsonLdApplication(html: string): {
  name?: string;
  description?: string;
  author?: string;
  url?: string;
} {
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1]) as unknown;
    } catch {
      continue;
    }
    const nodes = walkJson(parsed);
    for (const node of nodes) {
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      const rec = node as Record<string, unknown>;
      const type = rec["@type"];
      const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
      if (!types.includes("SoftwareApplication")) continue;
      const author = rec.author;
      let authorName = "";
      if (author && typeof author === "object" && !Array.isArray(author)) {
        authorName = String((author as { name?: unknown }).name ?? "").trim();
      } else if (typeof author === "string") {
        authorName = author.trim();
      }
      return {
        name: typeof rec.name === "string" ? rec.name.trim() : undefined,
        description:
          typeof rec.description === "string" ? rec.description.trim() : undefined,
        author: authorName || undefined,
        url: typeof rec.url === "string" ? rec.url.trim() : undefined,
      };
    }
  }
  return {};
}

function walkJson(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(walkJson);
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const nested = rec["@graph"] != null ? walkJson(rec["@graph"]) : [];
    return [value, ...nested];
  }
  return [];
}

function briefingParagraphs(html: string): string[] {
  const matches = [
    ...html.matchAll(
      /<p[^>]*whitespace-pre-wrap[^>]*>([\s\S]*?)<\/p>/gi,
    ),
  ];
  const paras: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const text = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 40) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    paras.push(text);
  }
  return paras;
}

function grokbotId(html: string): string | undefined {
  const match = html.match(
    /grokbot:\/\/app\/v1\/bot-template\?id=([A-Za-z0-9_-]+)/i,
  );
  return match?.[1];
}

type BriefKind = "job" | "prefs" | "files" | "schema" | "identity" | "sop";

function classifyBrief(text: string): BriefKind {
  if (/^(job|one job)\s*:/i.test(text)) return "job";
  if (/user prefs/i.test(text)) return "prefs";
  if (/working state lives/i.test(text) || /lives in files, not in memory/i.test(text)) {
    return "files";
  }
  if (/fixed value lists/i.test(text)) return "schema";
  if (/^(i |i['’]m |i['’]d )/i.test(text)) return "identity";
  return "sop";
}

function attribution(url: string, author?: string): string {
  const by = author ? ` Public listing by ${author}.` : "";
  return `Drafted from the public info page at ${url}.${by} This is a Guild seat draft, not a Grok Bot import. Playbooks, routines, and integrations were not copied.`;
}

function joinBlocks(blocks: string[]): string {
  return blocks.filter((block) => block.trim()).join("\n\n");
}

export function draftFromListingHtml(
  html: string,
  ref: ListingRef,
): ListingDraft {
  const ld = jsonLdApplication(html);
  const name =
    ld.name ||
    cleanTitle(metaContent(html, "og:title")) ||
    cleanTitle(tagText(html, "title")) ||
    cleanTitle(tagText(html, "h1"));
  const oneLiner = (
    ld.description ||
    metaContent(html, "og:description") ||
    metaContent(html, "description")
  ).slice(0, 320);
  if (!name) throw new StoreError(400, "that page had no public bot name");

  const paras = briefingParagraphs(html);
  const buckets: Record<BriefKind, string[]> = {
    job: [],
    prefs: [],
    files: [],
    schema: [],
    identity: [],
    sop: [],
  };
  for (const para of paras) buckets[classifyBrief(para)].push(para);
  if (buckets.identity.length === 0 && paras[0] && buckets.job.length === 0) {
    buckets.identity.push(paras[0]);
    buckets.sop = buckets.sop.filter((item) => item !== paras[0]);
  }

  const thin = paras.length === 0;
  const sourceUrl = ref.href;
  const author = ld.author;
  const note = attribution(sourceUrl, author);
  const job = joinBlocks(buckets.job) || oneLiner;
  const identity = joinBlocks(buckets.identity);
  const handle =
    ref.kind === "info" && ref.slug && ref.slug.length >= 3
      ? ref.slug
      : slugifyHandle(name);

  const soulBody = joinBlocks([
    `# ${name}`,
    oneLiner,
    identity,
    "## Guild",
    "- The latest human message is the live task. Channel.md is room procedure. MEMORY.md is dated standing notes, not the live task. Do not recap the whole thread.",
    `- ${note}`,
  ]);

  const agentBody = joinBlocks([
    `# ${name}`,
    job,
    "## Memory",
    "- The latest human message is the live task. Channel.md is room procedure. MEMORY.md is dated standing notes, not the live task. Do not recap the whole thread.",
    buckets.prefs.length
      ? `- First run: fill prefs that are still unset.\n\n${joinBlocks(buckets.prefs)}`
      : "",
    "## Plan",
    "- One local directive: goal + done when + a short checklist. Revise it when evidence changes.",
    "## Act",
    "- Inspect the workspace, make the smallest change, verify, stop.",
    "- Work that belongs to another seat: line-start @handle with Goal / Done when / out of scope / files.",
    joinBlocks(buckets.files),
    joinBlocks(buckets.schema),
    joinBlocks(buckets.sop),
    "## Skills",
    "- The catalog is availability, not a todo. Call `skill` only when this turn's directive matches.",
    "- Grok playbooks were not copied. Staff Guild skills after you review this draft.",
    "## Quality bar",
    "- No untested guesses.",
    "- Cite files you touched.",
    "- No status theater.",
    note,
  ]);

  const positionBody = joinBlocks([
    `# ${name}`,
    "## Duties",
    `- ${job.split(/\n/)[0]}`,
    "## Definition of done",
    "- The assigned task is complete or blocked with a reason.",
    "- Reviewer (if any) can reproduce the result.",
    "## Tools",
    "sandbox: workspace_write",
    note,
  ]);

  return {
    name,
    handle,
    oneLiner,
    sourceUrl,
    kind: ref.kind,
    author,
    listingId: grokbotId(html) ?? ref.shareId,
    thin,
    soul: { name, body: soulBody },
    agent: { name, body: agentBody },
    position: { name, body: positionBody },
    skillIds: [],
  };
}

export async function draftListingFromUrl(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ListingDraft> {
  const first = parseListingInput(raw);
  let current = first.href;
  for (let hop = 0; hop < 5; hop += 1) {
    const target = parseListingInput(current);
    const response = await fetchImpl(target.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new StoreError(400, "listing redirect had no location");
      }
      current = new URL(location, target.href).href;
      continue;
    }
    if (!response.ok) {
      throw new StoreError(400, `listing fetch failed: ${response.status}`);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      throw new StoreError(400, "listing page too large");
    }
    return draftFromListingHtml(buf.toString("utf8"), target);
  }
  throw new StoreError(400, "too many redirects");
}
