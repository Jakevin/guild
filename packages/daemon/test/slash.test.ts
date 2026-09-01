import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  chatTurnForBot,
  extraTurnSkills,
  extraTurnSubagents,
} from "../src/handlers.ts";
import { listSpawnRefs } from "../src/subagent.ts";
import { slashNames } from "../src/slash.ts";
import { GuildStore } from "../src/store.ts";
import { buildChatSystem } from "../src/generate.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-slash-"));
}

test("slashNames finds /slug after start or whitespace, not inside URLs", () => {
  assert.deepEqual(slashNames("/pdf extract"), ["pdf"]);
  assert.deepEqual(slashNames("/pdf /explorer go"), ["pdf", "explorer"]);
  assert.deepEqual(slashNames("please /review-pr now"), ["review-pr"]);
  assert.deepEqual(slashNames("https://example.com/foo"), []);
  assert.deepEqual(slashNames("http://x.ai/bot"), []);
  assert.deepEqual(slashNames("see/pdf"), []);
  assert.deepEqual(slashNames("`/pdf` in code"), []);
});

test("/slug injects an unstaffed guild skill into the turn catalog", () => {
  const store = new GuildStore(tempHome());
  const skill = store.createLibrary("skills", {
    name: "Slash Only",
    slug: "slash-only-skill",
    description: "Only from the slash picker",
    body: "# Slash Only\n\nSECRET_SLASH_BODY follow these steps.\n",
  });
  const bot = store.listBots()[0];
  assert.ok(bot);
  assert.ok(!bot.skillIds.includes(skill.id));
  const room = store.listRooms().find((item) => item.kind === "channel");
  assert.ok(room);

  const extras = extraTurnSkills(store, "/slash-only-skill do the thing");
  assert.equal(extras.length, 1);
  assert.equal(extras[0].slug, "slash-only-skill");
  assert.match(extras[0].body, /SECRET_SLASH_BODY/);

  const withSlash = chatTurnForBot(
    store,
    room.id,
    bot.id,
    [],
    "附件：\n[Skill #1] skill Slash Only\n請使用 skill `Slash Only`.\n\n/slash-only-skill do the thing",
    "/slash-only-skill do the thing",
  );
  assert.ok(
    withSlash.skills.some(
      (item) =>
        item.slug === "slash-only-skill" &&
        String(item.body).includes("SECRET_SLASH_BODY"),
    ),
  );
  const system = buildChatSystem(withSlash);
  assert.match(system, /slash-only-skill/);
  assert.match(system, /invoked with \/name/);
  assert.doesNotMatch(system, /SECRET_SLASH_BODY/);

  const without = chatTurnForBot(store, room.id, bot.id, [], "do the thing");
  assert.ok(!without.skills.some((item) => item.slug === "slash-only-skill"));
});

test("/explorer this turn tells the model to spawn that subagent", () => {
  const store = new GuildStore(tempHome());
  const bot = store.listBots()[0];
  const room = store.listRooms().find((item) => item.kind === "channel");
  assert.ok(bot && room);
  const agents = listSpawnRefs(store.listLibrary("subagents"));
  const want = extraTurnSubagents("/explorer 去找 README 缺口", agents);
  assert.ok(want.some((item) => item.slug === "explorer"));
  const turn = chatTurnForBot(
    store,
    room.id,
    bot.id,
    [],
    "/explorer 去找 README 缺口",
  );
  assert.ok(turn.wantSpawn.some((item) => item.slug === "explorer"));
  const system = buildChatSystem(turn);
  assert.match(system, /available_subagents/);
  assert.match(system, /\/explorer/);
  assert.match(system, /Call spawn with that exact name first/);
  assert.match(system, /Spawn first when/);
  assert.match(system, /tasks: \[\{name, prompt\}\]/);
});
