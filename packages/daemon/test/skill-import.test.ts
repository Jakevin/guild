import assert from "node:assert/strict";
import { test } from "node:test";
import {
  githubRawUrl,
  importFromGithub,
  parseGithubRef,
  parseSkillMarkdown,
} from "../src/skill-import.ts";

test("parseSkillMarkdown reads frontmatter", () => {
  const skill = parseSkillMarkdown(`---
name: frontend-design
description: Build distinctive UI
---

# Frontend Design

Avoid generic AI aesthetics.
`);
  assert.equal(skill.name, "frontend-design");
  assert.equal(skill.description, "Build distinctive UI");
  assert.match(skill.body, /Avoid generic AI aesthetics/);
});

test("parseSkillMarkdown unfolds YAML > descriptions", () => {
  const skill = parseSkillMarkdown(`---
name: ponytail
description: >
  Forces the laziest solution that actually works, simplest, shortest, most
  minimal. Use on ANY coding task.
---

# Ponytail

Be lazy.
`);
  assert.equal(skill.name, "ponytail");
  assert.match(skill.description, /Forces the laziest solution/);
  assert.match(skill.description, /coding task/);
  assert.doesNotMatch(skill.description, /^>$/);
});

test("parseGithubRef understands owner/repo and URLs", () => {
  assert.deepEqual(parseGithubRef("anthropics/skills"), {
    owner: "anthropics",
    repo: "skills",
    path: undefined,
  });
  const blob = parseGithubRef(
    "https://github.com/acme/skills/blob/main/web/SKILL.md",
  );
  assert.equal(blob.owner, "acme");
  assert.equal(blob.file, "web/SKILL.md");
  assert.equal(blob.ref, "main");
});

test("importFromGithub walks SKILL.md files through the real importer", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/git/trees/")) {
      return new Response(
        JSON.stringify({
          tree: [
            { path: "skills/web/SKILL.md", type: "blob" },
            { path: "README.md", type: "blob" },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("SKILL.md")) {
      return new Response(
        `---
name: web-skill
description: From GitHub
---

# Web skill
`,
        { status: 200 },
      );
    }
    return new Response("missing", { status: 404 });
  };
  const imported = await importFromGithub("acme/skills", fetchImpl);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].name, "web-skill");
  assert.equal(
    imported[0].sourceUrl,
    githubRawUrl("acme", "skills", "HEAD", "skills/web/SKILL.md"),
  );
});
