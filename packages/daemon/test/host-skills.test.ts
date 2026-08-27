import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listHostSkills, type HostSkill } from "../src/host-skills.ts";
import {
  createBot,
  resolveStaffSkillIds,
  updateBot,
} from "../src/handlers.ts";
import { closeServer, listen as listenApp } from "./app.ts";
import { GuildStore, StoreError } from "../src/store.ts";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeSkill(root: string, rel: string, name: string, body = "Do the thing.") {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n\n${body}\n`,
  );
}

test("listHostSkills reads Claude Codex Pi Grok Cursor dirs and skips caches", () => {
  const home = tempDir("guild-host-skills-home-");
  const cwd = tempDir("guild-host-skills-cwd-");
  writeSkill(home, ".claude/skills/ship", "ship");
  writeSkill(home, ".codex/skills/review", "review");
  writeSkill(home, ".pi/agent/skills/notes", "notes");
  writeSkill(home, ".grok/bundled/skills/imagine", "imagine");
  writeSkill(home, ".cursor/skills/refactor", "refactor");
  writeSkill(home, ".claude/plugins/cache/omc/skills/noise", "noise");
  writeSkill(cwd, ".claude/skills/repo-only", "repo-only");
  writeSkill(home, ".dsh/skills/pack", "pack", "DSH bundle.");
  mkdirSync(join(home, ".dsh/skills"), { recursive: true });
  writeFileSync(
    join(home, ".dsh/skills/flat-note.md"),
    "---\nname: flat-note\ndescription: A flat DSH skill\n---\n\n# Flat\n\nFrom a markdown file.\n",
  );

  const listed = listHostSkills({ home, cwd });
  const slugs = listed.map((item) => item.slug).sort();
  assert.deepEqual(slugs, [
    "flat-note",
    "imagine",
    "notes",
    "pack",
    "refactor",
    "repo-only",
    "review",
    "ship",
  ]);
  const flat = listed.find((item) => item.slug === "flat-note");
  assert.equal(flat?.host, "dsh");
  assert.match(flat?.body || "", /markdown file/);
  assert.ok(!listed.some((item) => item.slug === "noise"));
  const ship = listed.find((item) => item.slug === "ship");
  assert.equal(ship?.host, "claude");
  assert.equal(ship?.hostName, "Claude");
  assert.equal(ship?.source, "host");
  assert.match(ship?.path || "", /\.claude\/skills\/ship\/SKILL\.md$/);
});

test("GET /library/skills/host?body=0 omits SKILL.md bodies", async () => {
  const home = tempDir("guild-host-skills-body-");
  writeSkill(home, ".codex/skills/review", "review", "Keep this body off the wire.");
  const listed = listHostSkills({ home, cwd: home, includeBody: false });
  const review = listed.find((item) => item.slug === "review");
  assert.equal(review?.body, "");
  const full = listHostSkills({ home, cwd: home });
  assert.match(full.find((item) => item.slug === "review")?.body || "", /Keep this body/);
});

test("GET /library/skills/host returns an array", async () => {
  const dataDir = tempDir("guild-host-skills-data-");
  const { server, origin } = await listenApp(dataDir);
  try {
    const res = await fetch(`${origin}/library/skills/host`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as unknown;
    assert.ok(Array.isArray(body));
    const slimRes = await fetch(`${origin}/library/skills/host?body=0`);
    assert.equal(slimRes.status, 200);
    const slim = (await slimRes.json()) as { body?: string }[];
    assert.ok(Array.isArray(slim));
    assert.ok(slim.every((item) => !item.body));
    const missing = await fetch(
      `${origin}/library/skills/host?id=host:codex:no-such-skill`,
    );
    assert.equal(missing.status, 404);
  } finally {
    await closeServer(server);
  }
});

function hostSkill(partial: Partial<HostSkill> & Pick<HostSkill, "id" | "slug" | "name">): HostSkill {
  return {
    description: `${partial.name} skill`,
    body: `# ${partial.name}\n\nDo the thing.\n`,
    source: "host",
    host: "codex",
    hostName: "Codex",
    path: `~/.codex/skills/${partial.slug}/SKILL.md`,
    tags: ["codex"],
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

const DRAFTS = {
  soul: { name: "Calm", body: "# Soul\nBe calm.\n" },
  agent: { name: "SOP", body: "# Agent\nTest first.\n" },
  position: { name: "Engineer", body: "# Position\nShip it.\n" },
};

test("resolveStaffSkillIds imports a host CLI skill into the Guild library", () => {
  const store = new GuildStore(tempDir("guild-host-staff-"));
  const hosts = [
    hostSkill({
      id: "host:codex:cli-review",
      slug: "cli-review",
      name: "CLI Review",
      body: "# CLI Review\nReview the diff.\n",
    }),
  ];
  const ids = resolveStaffSkillIds(store, ["host:codex:cli-review"], hosts);
  assert.equal(ids.length, 1);
  const item = store.getLibrary("skills", ids[0]);
  assert.equal(item?.slug, "cli-review");
  assert.equal(item?.name, "CLI Review");
  assert.match(item?.body || "", /Review the diff/);
  assert.deepEqual(
    resolveStaffSkillIds(store, ["host:codex:cli-review"], hosts),
    ids,
  );
});

test("resolveStaffSkillIds reuses an installed Guild skill with the same slug", () => {
  const store = new GuildStore(tempDir("guild-host-reuse-"));
  const existing = store.listLibrary("skills").find((item) => item.slug === "code-review");
  assert.ok(existing);
  const hosts = [
    hostSkill({
      id: "host:codex:code-review",
      slug: "code-review",
      name: "Code Review",
      body: "# Host copy\nShould not replace the catalog skill.\n",
    }),
  ];
  const ids = resolveStaffSkillIds(store, ["host:codex:code-review"], hosts);
  assert.deepEqual(ids, [existing.id]);
  assert.doesNotMatch(
    store.getLibrary("skills", existing.id)?.body || "",
    /Should not replace/,
  );
});

test("resolveStaffSkillIds rejects an unknown host id", () => {
  const store = new GuildStore(tempDir("guild-host-miss-"));
  assert.throws(
    () => resolveStaffSkillIds(store, ["host:grok:no-such-skill"], []),
    (err: unknown) =>
      err instanceof StoreError &&
      err.status === 400 &&
      /host:grok:no-such-skill/.test(err.message),
  );
});

test("createBot and updateBot staff host CLI skills by importing them", () => {
  const store = new GuildStore(tempDir("guild-host-bot-"));
  const hosts = [
    hostSkill({
      id: "host:grok:imagine-host",
      slug: "imagine-host",
      name: "Imagine Host",
      host: "grok",
      hostName: "Grok",
      tags: ["grok"],
    }),
  ];
  const bot = createBot(
    store,
    {
      name: "Pixel",
      handle: "pixel-host",
      ...DRAFTS,
      skillIds: ["host:grok:imagine-host"],
    },
    hosts,
  );
  assert.equal(bot.skillIds.length, 1);
  assert.doesNotMatch(bot.skillIds[0], /^host:/);
  const imported = store.getLibrary("skills", bot.skillIds[0]);
  assert.equal(imported?.slug, "imagine-host");

  const extra = hostSkill({
    id: "host:codex:cli-patch",
    slug: "cli-patch",
    name: "CLI Patch",
  });
  const updated = updateBot(
    store,
    bot.id,
    { skillIds: [bot.skillIds[0], extra.id] },
    [...hosts, extra],
  );
  assert.equal(updated.skillIds.length, 2);
  assert.ok(updated.skillIds.includes(bot.skillIds[0]));
  assert.ok(
    updated.skillIds.some((id) => store.getLibrary("skills", id)?.slug === "cli-patch"),
  );
});
