import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  decodeHtmlEntities,
  draftFromListingHtml,
  draftListingFromUrl,
  parseListingInput,
  slugifyHandle,
} from "../src/listing-draft.ts";
import { StoreError } from "../src/store.ts";

const PG_HTML = readFileSync(
  fileURLToPath(new URL("./fixtures/listing-pg.html", import.meta.url)),
  "utf8",
);
const SHARE_HTML = readFileSync(
  fileURLToPath(new URL("./fixtures/listing-share.html", import.meta.url)),
  "utf8",
);

test("parseListingInput accepts marketplace info pages", () => {
  const a = parseListingInput("https://x.ai/bot/marketplace/bots/pg");
  assert.equal(a.kind, "info");
  assert.equal(a.slug, "pg");
  assert.equal(a.href, "https://x.ai/bot/marketplace/bots/pg");
  assert.equal(
    parseListingInput("https://x.ai/bot/marketplace/bots/seo-aeo-desk/").slug,
    "seo-aeo-desk",
  );
  assert.equal(parseListingInput("x.ai/bot/marketplace/bots/pg").slug, "pg");
  assert.equal(parseListingInput("/bot/marketplace/bots/haggle-bot").slug, "haggle-bot");
  assert.equal(parseListingInput("marketplace/bots/pg").slug, "pg");
});

test("parseListingInput accepts share pages and rejects Add links", () => {
  const share = parseListingInput("https://x.ai/bot/i03IaF768-ielyzegoGye");
  assert.equal(share.kind, "share");
  assert.equal(share.shareId, "i03IaF768-ielyzegoGye");
  assert.throws(
    () => parseListingInput("grokbot://app/v1/bot-template?id=i03IaF768-ielyzegoGye"),
    StoreError,
  );
  assert.throws(() => parseListingInput("https://example.com/bot/pg"), StoreError);
  assert.throws(() => parseListingInput("https://x.ai/bot/marketplace"), StoreError);
  assert.throws(() => parseListingInput("https://x.ai/news"), StoreError);
});

test("slugifyHandle turns a listing title into a handle", () => {
  assert.equal(slugifyHandle("SEO & AEO Desk"), "seo-aeo-desk");
  assert.equal(slugifyHandle("Outbound Prospecting"), "outbound-prospecting");
});

test("pg info page drafts Guild markdown without staffing skills", () => {
  const draft = draftFromListingHtml(
    PG_HTML,
    parseListingInput("https://x.ai/bot/marketplace/bots/pg"),
  );
  assert.equal(draft.name, "Outbound Prospecting");
  assert.equal(draft.handle, "outbound-prospecting");
  assert.match(draft.oneLiner, /nothing sends without your yes/i);
  assert.equal(draft.kind, "info");
  assert.equal(draft.thin, false);
  assert.equal(draft.author, "Krista Letz");
  assert.equal(draft.listingId, "i03IaF768-ielyzegoGye");
  assert.deepEqual(draft.skillIds, []);
  assert.match(draft.soul.body, /I build outbound prospect lists/);
  assert.match(draft.soul.body, /never send, post, or message anyone/);
  assert.match(draft.agent.body, /Job: outbound prospecting/);
  assert.match(draft.agent.body, /Working state lives in files/);
  assert.match(draft.agent.body, /icp_fit is strong/);
  assert.match(draft.agent.body, /Grok playbooks were not copied/);
  assert.match(draft.position.body, /sandbox: workspace_write/);
  assert.match(draft.soul.body, /not a Grok Bot import/);
  assert.doesNotMatch(draft.agent.body, /cron:/);
});

test("share page is a thin name + one-liner draft", () => {
  const draft = draftFromListingHtml(
    SHARE_HTML,
    parseListingInput("https://x.ai/bot/i03IaF768-ielyzegoGye"),
  );
  assert.equal(draft.name, "Outbound Prospecting");
  assert.equal(draft.handle, "outbound-prospecting");
  assert.equal(draft.thin, true);
  assert.match(draft.oneLiner, /ideal customer/);
  assert.deepEqual(draft.skillIds, []);
});

test("unlabeled SOP bullets land in AGENTS.md", () => {
  const html = `<!doctype html><html><head>
<title>Haggle Bot · Bot Marketplace · Grok Bot</title>
<meta property="og:description" content="Finds SaaS savings and drafts vendor counters."/>
<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Haggle Bot","description":"Finds SaaS savings and drafts vendor counters.","author":{"@type":"Person","name":"Daniel"}}</script>
</head><body>
<ul class="flex flex-col gap-6">
<li><p class="text-secondary text-sm leading-6 whitespace-pre-wrap">One job: find and document SaaS savings from live spend data, then draft the vendor counters. Anti-jobs: never spend, never sign, never send without you.</p></li>
<li><p class="text-secondary text-sm leading-6 whitespace-pre-wrap">FIRST RUN: introduce yourself in one line, then run the setup interview.</p></li>
</ul>
</body></html>`;
  const draft = draftFromListingHtml(
    html,
    parseListingInput("https://x.ai/bot/marketplace/bots/haggle-bot"),
  );
  assert.equal(draft.name, "Haggle Bot");
  assert.equal(draft.handle, "haggle-bot");
  assert.match(draft.agent.body, /One job: find and document SaaS savings/);
  assert.match(draft.agent.body, /FIRST RUN:/);
  assert.doesNotMatch(draft.soul.body, /FIRST RUN:/);
});

test("HTML entities in titles decode", () => {
  assert.equal(decodeHtmlEntities("SEO &amp; AEO Desk"), "SEO & AEO Desk");
  const html = `<title>SEO &amp; AEO Desk · Bot Marketplace · Grok Bot</title>
<meta property="og:title" content="SEO &amp; AEO Desk"/>
<meta property="og:description" content="Turns keywords into briefs."/>`;
  const draft = draftFromListingHtml(
    html,
    parseListingInput("https://x.ai/bot/marketplace/bots/seo-aeo-desk"),
  );
  assert.equal(draft.name, "SEO & AEO Desk");
  assert.equal(draft.handle, "seo-aeo-desk");
});

test("draftListingFromUrl fetches only the canonical x.ai info page", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal((init as RequestInit | undefined)?.redirect, "manual");
    if (url === "https://x.ai/bot/marketplace/bots/pg") {
      return new Response(PG_HTML, { status: 200 });
    }
    return new Response("nope", { status: 404 });
  };
  const draft = await draftListingFromUrl(
    "https://www.x.ai/bot/marketplace/bots/pg?utm=1",
    fetchImpl,
  );
  assert.deepEqual(calls, ["https://x.ai/bot/marketplace/bots/pg"]);
  assert.equal(draft.name, "Outbound Prospecting");
  assert.equal(draft.thin, false);
});

test("share URL that redirects onto an info page follows once", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://x.ai/bot/i03IaF768-ielyzegoGye") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://x.ai/bot/marketplace/bots/pg" },
      });
    }
    if (url === "https://x.ai/bot/marketplace/bots/pg") {
      return new Response(PG_HTML, { status: 200 });
    }
    return new Response("nope", { status: 404 });
  };
  const draft = await draftListingFromUrl(
    "https://x.ai/bot/i03IaF768-ielyzegoGye",
    fetchImpl,
  );
  assert.equal(draft.kind, "info");
  assert.equal(draft.thin, false);
});

test("redirects off x.ai are rejected", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/steal" },
    });
  await assert.rejects(
    () =>
      draftListingFromUrl("https://x.ai/bot/marketplace/bots/pg", fetchImpl),
    StoreError,
  );
});
