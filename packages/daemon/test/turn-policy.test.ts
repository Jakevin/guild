import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calibrationFor,
  effortForLane,
  PARALLEL_HINT,
  scoreTurnLane,
  selectTurnSkills,
  stalledToolLoop,
} from "../src/turn-policy.ts";
import { buildChatSystem } from "../src/generate.ts";
import type { SkillRef } from "../src/tools.ts";

function skill(name: string, description: string, slug = name.toLowerCase()): SkillRef {
  return { name, slug, body: "BODY", description };
}

test("scoreTurnLane: greetings are quick, exhaustive search is deep", () => {
  assert.equal(scoreTurnLane("謝謝"), "quick");
  assert.equal(scoreTurnLane("ok"), "quick");
  assert.equal(scoreTurnLane("找出所有 graphify 的引用"), "deep");
  assert.equal(scoreTurnLane("@infra 看一下 packages/daemon/src/llm.ts 的 timeout"), "default");
});

test("effortForLane matches 低/中/高", () => {
  assert.equal(effortForLane("quick"), "low");
  assert.equal(effortForLane("default"), "medium");
  assert.equal(effortForLane("deep"), "high");
});

test("selectTurnSkills keeps /slug and caps at 3 matches", () => {
  const catalog = [
    skill("Graphify", "Turn a codebase into a graph."),
    skill("Debugger", "Look at logs and stack traces."),
    skill("Git PR", "Open a pull request."),
    skill("Accessibility", "Audit contrast and labels."),
    skill("Web research", "Search the public web."),
  ];
  const none = selectTurnSkills(catalog, "hello there");
  assert.equal(none.length, 0);
  const named = selectTurnSkills(catalog, "/debugger the crash");
  assert.equal(named[0]?.slug, "debugger");
  const ranked = selectTurnSkills(catalog, "graph the codebase and open a pull request");
  assert.ok(ranked.length <= 3);
  assert.ok(ranked.some((row) => row.slug === "graphify"));
  const all = selectTurnSkills(catalog, "");
  assert.equal(all.length, catalog.length);
});

test("calibrationFor is a short family paragraph", () => {
  assert.match(calibrationFor("xai-oauth", "grok-4.6"), /tool output/);
  assert.match(calibrationFor("anthropic-oauth", "claude-sonnet-4-6"), /checklist/);
  assert.match(calibrationFor("antigravity", "gemini-3.8-flash-medium"), /not evidence/);
  assert.match(calibrationFor("commandcode", "deepseek/deepseek-v4-flash"), /Guild still runs tools/);
});

test("stalledToolLoop wraps after three errors or three identical calls", () => {
  assert.equal(stalledToolLoop([]), false);
  const fail = (n: string) => ({
    name: n,
    args: { command: "true" },
    text: "no",
    isError: true,
  });
  assert.equal(stalledToolLoop([fail("run"), fail("run"), fail("run")]), true);
  const same = {
    name: "read",
    args: { path: "/tmp/a" },
    text: "ok",
    isError: false,
  };
  assert.equal(stalledToolLoop([same, same, same]), true);
  assert.equal(
    stalledToolLoop([
      { ...same, args: { path: "/tmp/a" } },
      { ...same, args: { path: "/tmp/b" } },
      { ...same, args: { path: "/tmp/c" } },
    ]),
    false,
  );
});

test("deep lane hint is available; catalog still omits skill bodies", () => {
  assert.match(PARALLEL_HINT, /disjoint/);
  const system = buildChatSystem({
    botName: "RD",
    handle: "rd",
    soul: "# Soul",
    agent: "# Agent",
    position: "# Position",
    skills: [skill("Graphify", "Turn a codebase into a graph.", "graphify")],
  });
  assert.match(system, /`graphify`: Turn a codebase into a graph\./);
  assert.doesNotMatch(system, /BODY/);
});
