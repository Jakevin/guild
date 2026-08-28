import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DEFAULT_GUILD_HOST,
  DEFAULT_GUILD_PORT,
} from "@guild/protocol";
import http from "node:http";
import { listenGuildServer } from "../src/server.ts";
import { healthPayload } from "../src/handlers.ts";
import { handleRequest } from "../src/router.ts";
import { clipNavPreview, GuildStore } from "../src/store.ts";
import { closeServer, listen as listenApp, tempHome as makeHome } from "./app.ts";

const DAEMON_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);
const LIBRARY_HTML = fileURLToPath(
  new URL("../src/public/library.html", import.meta.url),
);
const STUDIO_HTML = fileURLToPath(
  new URL("../src/public/studio.html", import.meta.url),
);

function tempHome(): string {
  return makeHome();
}

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const address = probe.address();
  if (address === null || typeof address === "string") {
    throw new Error("could not allocate a port");
  }
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function listen(dataDir: string) {
  const app = await listenApp(dataDir);
  return { server: app.server, origin: app.origin, ctx: app.ctx };
}

async function getJson(
  origin: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}${path}`);
  const body: unknown = await response.json();
  return { status: response.status, body };
}

async function postJson(
  origin: string,
  path: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

async function deleteJson(
  origin: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}${path}`, { method: "DELETE" });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

async function putJson(
  origin: string,
  path: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

async function patchJson(
  origin: string,
  path: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

test("shipped router health is ready/ok", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const { status, body } = await getJson(origin, "/health");
    assert.equal(status, 200);
    assert.deepEqual(body, healthPayload());
  } finally {
    await closeServer(server);
  }
});

test("shipped router serves bench, library, and studio HTML", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    for (const path of ["/", "/library", "/subagents", "/subagents/add", "/mcp", "/mcp/add", "/studio", "/chat", "/settings"]) {
      const response = await fetch(`${origin}${path}`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      assert.doesNotMatch(html, /"error":"not_found"/);
    }
    const libraryPage = await fetch(`${origin}/library`).then((r) => r.text());
    const subagentsPage = await fetch(`${origin}/subagents`).then((r) => r.text());
    const mcpPage = await fetch(`${origin}/mcp`).then((r) => r.text());
    assert.equal(libraryPage, subagentsPage);
    assert.equal(libraryPage, mcpPage);
    assert.match(libraryPage, /data-lib-panel="skills"/);
    assert.match(libraryPage, /data-lib-panel="subagents"/);
    assert.match(libraryPage, /data-lib-panel="mcp"/);
    const street = await fetch(`${origin}/rpg/inn-street.jpg`);
    assert.equal(street.status, 200);
    assert.match(street.headers.get("content-type") ?? "", /image\//);
    const home = await fetch(`${origin}/`).then((r) => r.text());
    assert.match(home, /href="\/favicon\.ico"/);
    assert.match(home, /href="\/favicon\.svg"/);
    const ico = await fetch(`${origin}/favicon.ico`);
    assert.equal(ico.status, 200);
    assert.match(ico.headers.get("content-type") ?? "", /image\/(x-icon|vnd\.microsoft\.icon|png)/);
    const icon = await fetch(`${origin}/favicon.svg`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get("content-type") ?? "", /image\/svg\+xml/);
    const svg = await icon.text();
    assert.match(svg, /aria-label="Guild"/);
    const png32 = await fetch(`${origin}/favicon-32.png`);
    assert.equal(png32.status, 200);
    assert.match(png32.headers.get("content-type") ?? "", /image\/png/);
    const png16 = await fetch(`${origin}/favicon-16.png`);
    assert.equal(png16.status, 200);
    assert.match(png16.headers.get("content-type") ?? "", /image\/png/);
  } finally {
    await closeServer(server);
  }
});

test("default roster is seeded onto the bench", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const { status, body } = await getJson(origin, "/bots");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    const handles = (body as { handle: string; name: string }[])
      .map((bot) => bot.handle)
      .sort();
    assert.deepEqual(handles, ["design", "infra", "marketing", "pm", "rd"]);
    const names = (body as { name: string }[]).map((bot) => bot.name);
    assert.ok(names.includes("Infra 工程師"));
    assert.ok(names.includes("Project Manager"));
    assert.ok(names.includes("RD"));
    assert.ok(names.includes("美術設計"));
    assert.ok(names.includes("行銷運營"));
  } finally {
    await closeServer(server);
  }
});

test("create library kinds then list returns them", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const soul = await postJson(origin, "/library/souls", {
      name: "Calm",
      body: "Be calm.",
    });
    const agent = await postJson(origin, "/library/agents", {
      name: "Engineer SOP",
    });
    const skill = await postJson(origin, "/library/skills", {
      name: "patch",
    });
    const position = await postJson(origin, "/library/positions", {
      name: "Engineer",
    });
    assert.equal(soul.status, 201);
    assert.equal(agent.status, 201);
    assert.equal(skill.status, 201);
    assert.equal(position.status, 201);

    const souls = await getJson(origin, "/library/souls");
    const agents = await getJson(origin, "/library/agents");
    const skills = await getJson(origin, "/library/skills");
    const positions = await getJson(origin, "/library/positions");
    assert.ok(
      (souls.body as { name: string }[]).some((item) => item.name === "Calm"),
    );
    assert.ok(
      (agents.body as { name: string }[]).some(
        (item) => item.name === "Engineer SOP",
      ),
    );
    assert.ok(
      (skills.body as { name: string }[]).some((item) => item.name === "patch"),
    );
    assert.ok(
      (positions.body as { name: string }[]).some(
        (item) => item.name === "Engineer",
      ),
    );
  } finally {
    await closeServer(server);
  }
});

test("create bot selecting library items appears on the bench", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const soul = (await postJson(origin, "/library/souls", { name: "Calm" }))
      .body as { id: string };
    const agent = (await postJson(origin, "/library/agents", { name: "SOP" }))
      .body as { id: string };
    const skill = (await postJson(origin, "/library/skills", { name: "patch" }))
      .body as { id: string };
    const position = (
      await postJson(origin, "/library/positions", { name: "Engineer" })
    ).body as { id: string };

    const created = await postJson(origin, "/bots", {
      name: "Ada",
      handle: "ada",
      soulId: soul.id,
      agentTemplateId: agent.id,
      skillId: skill.id,
      defaultPositionId: position.id,
    });
    assert.equal(created.status, 201);
    const bot = created.body as {
      name: string;
      handle: string;
      status: string;
    };
    assert.equal(bot.name, "Ada");
    assert.equal(bot.handle, "ada");
    assert.equal(bot.status, "bench");

    const bench = await getJson(origin, "/bots");
    assert.equal(bench.status, 200);
    assert.ok(Array.isArray(bench.body));
    const listed = (bench.body as { handle: string; name: string; status: string; id: string }[])
      .find((item) => item.handle === "ada");
    assert.ok(listed);
    assert.equal(listed.name, "Ada");
    assert.equal(listed.status, "bench");
    const space = (await getJson(origin, "/workspace")).body as {
      channels: { name: string; memberIds: string[] }[];
    };
    const general = space.channels.find((ch) => ch.name === "general");
    assert.ok(general?.memberIds.includes(listed.id));
  } finally {
    await closeServer(server);
  }
});

test("bots persist across a new server on the same data dir", async () => {
  const dataDir = tempHome();
  const first = await listen(dataDir);
  try {
    const soul = (await postJson(first.origin, "/library/souls", { name: "Calm" }))
      .body as { id: string };
    const agent = (
      await postJson(first.origin, "/library/agents", { name: "SOP" })
    ).body as { id: string };
    const skill = (
      await postJson(first.origin, "/library/skills", { name: "patch" })
    ).body as { id: string };
    const position = (
      await postJson(first.origin, "/library/positions", { name: "Engineer" })
    ).body as { id: string };
    await postJson(first.origin, "/bots", {
      name: "Ada",
      handle: "ada",
      soulId: soul.id,
      agentTemplateId: agent.id,
      skillIds: [skill.id],
      defaultPositionId: position.id,
    });
  } finally {
    await closeServer(first.server);
  }

  const second = await listen(dataDir);
  try {
    const bench = await getJson(second.origin, "/bots");
    assert.ok(Array.isArray(bench.body));
    const listed = (bench.body as { handle: string }[]).find(
      (item) => item.handle === "ada",
    );
    assert.ok(listed, "bot must survive restart");
  } finally {
    await closeServer(second.server);
  }
});

async function spawnCli(
  port: number,
  home: string,
): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", CLI], {
    cwd: DAEMON_ROOT,
    env: {
      ...process.env,
      GUILD_HOST: "127.0.0.1",
      GUILD_PORT: String(port),
      GUILD_HOME: home,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`cli start timeout\nstdout=${stdout}\nstderr=${stderr}`));
    }, 10_000);
    const onData = (): void => {
      if (stdout.includes('"listening":true')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`cli exited ${code}\nstdout=${stdout}\nstderr=${stderr}`));
    });
    child.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  return child;
}

async function stopCli(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit");
}

test("daemon CLI persists a bot across two launches", async () => {
  const home = tempHome();
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const first = await spawnCli(port, home);
  try {
    const soul = (await postJson(origin, "/library/souls", { name: "Calm" }))
      .body as { id: string };
    const agent = (await postJson(origin, "/library/agents", { name: "SOP" }))
      .body as { id: string };
    const skill = (await postJson(origin, "/library/skills", { name: "patch" }))
      .body as { id: string };
    const position = (
      await postJson(origin, "/library/positions", { name: "Engineer" })
    ).body as { id: string };
    await postJson(origin, "/bots", {
      name: "Ada",
      handle: "ada",
      soulId: soul.id,
      agentTemplateId: agent.id,
      skillId: skill.id,
      defaultPositionId: position.id,
    });
    const libraryPage = await fetch(`${origin}/library`);
    assert.match(await libraryPage.clone().text(), /\/library\/skills\/host/);
    const studioPage = await fetch(`${origin}/studio`);
    assert.match(libraryPage.headers.get("content-type") ?? "", /text\/html/);
    assert.match(studioPage.headers.get("content-type") ?? "", /text\/html/);
    assert.doesNotMatch(await libraryPage.text(), /"error":"not_found"/);
    assert.doesNotMatch(await studioPage.text(), /"error":"not_found"/);
  } finally {
    await stopCli(first);
  }

  const second = await spawnCli(port, home);
  try {
    const bench = await getJson(origin, "/bots");
    const listed = (bench.body as { handle: string }[]).find(
      (item) => item.handle === "ada",
    );
    assert.ok(listed);
  } finally {
    await stopCli(second);
  }
});

test("skill catalog is available without creating items", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const skills = await getJson(origin, "/library/skills");
    assert.ok(Array.isArray(skills.body));
    assert.ok((skills.body as unknown[]).length >= 8);
    const frontend = (
      skills.body as { slug: string; source?: string; tags?: string[] }[]
    ).find((item) => item.slug === "frontend-design");
    assert.ok(frontend);
    assert.equal(frontend.source, "catalog");
    assert.ok(frontend.tags?.includes("design"));
    assert.ok(frontend.tags?.includes("development"));
  } finally {
    await closeServer(server);
  }
});

test("generate turns a prompt into markdown", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const soul = await postJson(origin, "/generate", {
      kind: "soul",
      prompt: "謹慎少廢話的資深工程師",
    });
    assert.equal(soul.status, 200);
    const body = soul.body as { name: string; body: string };
    assert.match(body.body, /謹慎少廢話的資深工程師/);
    assert.match(body.body, /^# /);
  } finally {
    await closeServer(server);
  }
});

test("create bot from markdown drafts and catalog skills", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const skills = (await getJson(origin, "/library/skills")).body as {
      id: string;
      slug: string;
    }[];
    const skillId = skills.find((item) => item.slug === "code-review")?.id;
    assert.ok(skillId);
    const created = await postJson(origin, "/bots", {
      name: "Ada",
      handle: "ada-md",
      soul: { name: "Calm", body: "# Soul\nBe calm.\n" },
      agent: { name: "SOP", body: "# Agent\nTest first.\n" },
      position: { name: "Engineer", body: "# Position\nShip it.\n" },
      skillIds: [skillId],
    });
    assert.equal(created.status, 201);
    const bench = await getJson(origin, "/bots");
    const listed = (bench.body as { handle: string }[]).find(
      (item) => item.handle === "ada-md",
    );
    assert.ok(listed);
  } finally {
    await closeServer(server);
  }
});

test("home is chat and studio is the bar", () => {
  assert.equal(DEFAULT_GUILD_HOST, "127.0.0.1");
  assert.equal(DEFAULT_GUILD_PORT, 7420);
  const home = readFileSync(CHAT_HTML, "utf8");
  assert.match(home, /密談/);
  assert.match(home, /href="\/studio"/);
  assert.match(home, /酒吧/);
  assert.match(home, /href="\/settings"/);
  assert.match(home, /模型/);
  assert.match(home, /composer-card/);
  assert.match(home, /Ask anything/);
  assert.match(home, /\/i18n\.js/);
  assert.match(home, /sidebar-resizer/);
  const chatCss = readFileSync(
    fileURLToPath(new URL("../src/public/chat.css", import.meta.url)),
    "utf8",
  );
  assert.match(chatCss, /body\.grok \.sidebar/);
  assert.match(chatCss, /#EDE6D6/);
  assert.match(chatCss, /#16100B/);
  assert.doesNotMatch(home, /locale-switch/);
  assert.match(home, /t\("deepDiving"\)/);
  assert.match(home, /t\("think"\)/);
  assert.match(home, /t\("skill"\)/);
  assert.match(home, /t\("bash"\)/);
  assert.match(home, /skillInstructions/);
  assert.match(home, /visibleAssistantText/);
  assert.match(home, /dsh-trace/);
  assert.match(home, /toolCard/);
  assert.match(home, /term-cmd/);
  assert.match(home, /renderReadBody/);
  assert.doesNotMatch(home, /id="edit-link"/);
  assert.match(home, /\/edit\//);
  assert.match(home, /msg-head/);
  assert.match(home, /msg-main/);
  assert.match(home, /bot-card/);
  assert.match(home, /bot-card-actions/);
  assert.match(home, /showBotCard/);
  assert.match(home, /members-btn/);
  assert.doesNotMatch(home, /加入 bot/);
  assert.match(home, /busy-flash/);
  assert.match(home, /unread-dot/);
  assert.match(home, /id="traj"/);
  assert.match(home, /trajActor/);
  assert.match(home, /traj-who/);
  assert.match(home, /Trajectory/);
  assert.match(home, /image_gen/);
  assert.match(home, /imageGen/);
  assert.match(home, /href="\/library"/);
  assert.doesNotMatch(home, /href="\/subagents"/);
  assert.doesNotMatch(home, /href="\/mcp"/);
  assert.match(home, /name === "spawn"/);
  assert.match(home, /data-stats/);
  assert.match(home, /stats-panel/);
  assert.match(home, /iconStats/);
  assert.match(home, /id="assign"/);
  assert.match(home, /function mentionAt/);
  assert.match(home, /function mentionChoices/);
  assert.match(home, /id="mention-pop"/);
  assert.match(home, /assignCandidates/);
  assert.match(home, /assigneeId/);
  assert.match(home, /canStopHere/);
  assert.match(home, /syncSendButton/);
  assert.match(home, /id="channel-md-del"/);
  assert.doesNotMatch(home, /nav-del/);
  assert.doesNotMatch(home, /id="del-room"/);
  assert.match(home, /deleteChannel/);
  assert.doesNotMatch(home, /id="bot-card-del"/);
  assert.doesNotMatch(home, /function deleteBot/);
  assert.match(home, /live-steps/);
  assert.match(home, /function liveBot/);
  assert.match(home, /msg bot live/);
  assert.match(home, /function pollLive/);
  assert.match(home, /resumeCurrentLive/);
  assert.match(home, /function stopTurn/);
  assert.match(home, /\/abort/);
  assert.match(home, /\/live/);
  assert.match(home, /steer\.queue/);
  assert.match(home, /steer\.tag/);
  assert.match(home, /flashSteerAck/);
  assert.match(home, /function sendSteer/);
  assert.match(home, /function enqueuePending/);
  assert.doesNotMatch(home, /\.disabled = stop/);
  const library = readFileSync(LIBRARY_HTML, "utf8");
  const studio = readFileSync(STUDIO_HTML, "utf8");
  assert.match(studio, /id="delete-bot"/);
  assert.match(library, /技能庫/);
  assert.match(library, /class="app library-page"/);
  assert.match(library, /side-nav/);
  assert.match(library, /\/i18n\.js/);
  assert.match(library, /\/library\/skills\/host/);
  assert.match(library, /Claude、Codex、Pi、Grok、Cursor/);
  assert.match(library, /\/skills\/add/);
  assert.match(library, /data-lib-panel="skills"/);
  assert.match(library, /data-lib-panel="subagents"/);
  assert.match(library, /data-lib-panel="mcp"/);
  assert.match(library, /href="\/subagents"/);
  assert.match(library, /href="\/mcp"/);
  assert.doesNotMatch(library, /mcpServers/);
  assert.match(library, /tag-row/);
  assert.match(library, /t\("library.all"\)/);
  assert.match(library, /mini-tag/);
  assert.match(library, /lib-desc/);
  assert.match(library, /toggleTag\(/);
  assert.match(library, /activeTags\.clear\(\)/);
  assert.doesNotMatch(library, /activeTags\.add\(tag\);[\s\S]*activeTags\.add\(/);
  const style = readFileSync(
    fileURLToPath(new URL("../src/public/style.css", import.meta.url)),
    "utf8",
  );
  assert.match(style, /--bg:\s*#0B0E12/);
  assert.match(style, /--paper:\s*#F3EFE6/);
  assert.match(style, /grid-template-columns:\s*40px minmax\(0,\s*1fr\)/);
  assert.match(style, /-webkit-line-clamp:\s*2/);
  assert.doesNotMatch(library, /Add Soul/);
  assert.doesNotMatch(library, /Who are you/);
  assert.match(studio, /酒吧/);
  assert.match(studio, /招募/);
  assert.match(studio, /請他入座/);
  assert.match(studio, /save-md/);
  assert.match(studio, /data-save="soul"/);
  assert.match(studio, /data-save="agent"/);
  assert.match(studio, /data-save="position"/);
  assert.match(studio, /saveMarkdown/);
  assert.match(studio, /saveSkills/);
  assert.match(studio, /syncCardChecks/);
  assert.match(studio, /data-slug/);
  assert.match(studio, /isChecked/);
  assert.match(studio, /studio\.pickedChip/);
  assert.match(studio, /skill-more/);
  assert.match(studio, /activeTags = new Set\(tag \? \[tag\] : \[\]\)/);
  assert.match(studio, /hostTag/);
  assert.doesNotMatch(studio, /id="save-hint"/);
  assert.match(studio, /rpg-dialog/);
  assert.match(studio, /inn-street\.jpg/);
  assert.match(studio, /進酒館/);
  assert.match(studio, /skillIds/);
  assert.match(studio, /data-check/);
  assert.match(studio, /lib-body/);
  assert.match(studio, /用 AI 生成 Markdown/);
  assert.match(studio, /\/generate/);
  assert.match(studio, /\/skills\/add/);
  assert.match(studio, /\/library\/skills\/host\?body=0/);
  assert.match(studio, /mergeSkills/);
  assert.match(studio, /host\?id=/);
  assert.doesNotMatch(studio, /skill-host-label/);
  assert.match(studio, /PATCH/);
  assert.match(studio, /EDIT_ID/);
  assert.match(studio, /這名隊員的技能（含本機 CLI）/);
  assert.match(studio, /不影響其他人/);
  assert.match(studio, /Codex、Grok/);
  assert.match(studio, /tag-row/);
  assert.match(studio, /t\("library.all"\)/);
  assert.doesNotMatch(studio, /已推薦/);
  assert.doesNotMatch(studio, /data-tab="catalog"/);
  assert.doesNotMatch(studio, />已安裝</);
});

test("skills add page is HTML", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const response = await fetch(`${origin}/skills/add`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /AI 生成/);
    assert.match(html, /GitHub/);
    assert.match(html, /網址下載/);
    assert.match(html, /技能庫/);
    assert.match(html, /這裡才是安裝入口/);
  } finally {
    await closeServer(server);
  }
});

test("generate skill markdown from a prompt", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const generated = await postJson(origin, "/generate", {
      kind: "skill",
      prompt: "審查 PR 安全風險",
    });
    assert.equal(generated.status, 200);
    const body = generated.body as { body: string };
    assert.match(body.body, /審查 PR 安全風險/);
  } finally {
    await closeServer(server);
  }
});

test("seed backfills a missing oneLiner on a default bot", async () => {
  const dataDir = tempHome();
  const first = await listen(dataDir);
  await closeServer(first.server);
  const botPath = join(dataDir, "bots", "bot-rd", "bot.json");
  const bot = JSON.parse(readFileSync(botPath, "utf8")) as {
    handle: string;
    oneLiner?: string;
  };
  delete bot.oneLiner;
  writeFileSync(botPath, `${JSON.stringify(bot, null, 2)}\n`);
  const second = await listen(dataDir);
  try {
    const listed = (await getJson(second.origin, "/bots")).body as {
      handle: string;
      oneLiner?: string;
    }[];
    const rd = listed.find((item) => item.handle === "rd");
    assert.ok(rd);
    assert.equal(rd.oneLiner, "寫能過測試的最小正確程式，不炫技。");
  } finally {
    await closeServer(second.server);
  }
});

test("workspace seeds #general, invites a bot, and DMs that bot", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const page = await fetch(`${origin}/chat`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /members-btn/);
    assert.match(html, /members-pop/);
    assert.match(html, /密談/);
    assert.match(html, /function formatUpdated/);
    assert.match(html, /function formatMsgClock/);
    assert.match(html, /function msgStamp/);
    assert.match(html, /finishedAt/);
    assert.match(html, /day-rule/);
    assert.match(html, /msg-time/);
    assert.match(html, /touchNavTime/);
    assert.match(html, /navRowHtml/);
    assert.match(html, /lastPreview/);
    assert.match(html, /nav-chip/);
    assert.match(html, /class="nav-row/);
    assert.match(html, /botModelLabel/);
    assert.match(html, /byUpdatedAtDesc/);
    assert.doesNotMatch(html, /botNavPreview/);
    assert.doesNotMatch(html, /位 bot 在裡面/);

    const space = await getJson(origin, "/workspace");
    assert.equal(space.status, 200);
    const workspace = space.body as {
      channels: { id: string; name: string; memberIds: string[] }[];
      bots: { id: string; handle: string }[];
    };
    assert.ok(workspace.channels.some((ch) => ch.name === "general"));
    const rd = workspace.bots.find((bot) => bot.handle === "rd");
    assert.ok(rd);
    const general = workspace.channels.find((ch) => ch.name === "general");
    assert.ok(general);
    assert.equal(general.memberIds.length, workspace.bots.length);
    for (const bot of workspace.bots) {
      assert.ok(general.memberIds.includes(bot.id));
    }

    const kicked = await fetch(
      `${origin}/channels/channel-general/members/${encodeURIComponent(rd.id)}`,
      { method: "DELETE" },
    );
    assert.equal(kicked.status, 400);
    const afterKick = (await kicked.json()) as { error: string };
    assert.match(afterKick.error, /cannot leave #general/);

    const still = (await getJson(origin, "/workspace")).body as {
      channels: { name: string; memberIds: string[] }[];
    };
    const generalAfter = still.channels.find((ch) => ch.name === "general");
    assert.ok(generalAfter?.memberIds.includes(rd.id));

    const created = await postJson(origin, "/channels", { name: "emergency" });
    assert.equal(created.status, 201);
    assert.equal((created.body as { name: string }).name, "emergency");

    const dm = await postJson(origin, `/dms/${rd.id}/messages`, {
      body: "先看這支測試紅了沒",
    });
    assert.equal(dm.status, 201);
    const payload = dm.body as {
      message: { author: string; body: string };
      replies: { author: string; body: string }[];
    };
    assert.equal(payload.message.author, "you");
    assert.equal(payload.replies.length, 1);
    assert.equal(payload.replies[0].author, rd.id);
    assert.match(payload.replies[0].body, /收到/);

    const listed = await getJson(origin, `/dms/${rd.id}/messages`);
    assert.equal((listed.body as unknown[]).length, 2);
    const userMsg = (listed.body as { id: string; author: string }[])[0];
    const botMsg = (listed.body as { id: string; author: string }[])[1];
    const redone = await postJson(
      origin,
      `/dms/${rd.id}/messages/${userMsg.id}/retry`,
      { body: "改口：再看一次" },
    );
    assert.equal(redone.status, 200);
    const afterEdit = (await getJson(origin, `/dms/${rd.id}/messages`)).body as {
      author: string;
      body: string;
    }[];
    assert.equal(afterEdit[0].body, "改口：再看一次");
    assert.equal(afterEdit.length, 2);
    const retried = await postJson(
      origin,
      `/dms/${rd.id}/messages/${afterEdit[1].id}/retry`,
      {},
    );
    assert.equal(retried.status, 200);
    const afterRetry = (await getJson(origin, `/dms/${rd.id}/messages`))
      .body as { id: string }[];
    assert.equal(afterRetry.length, 2);
    assert.equal(afterRetry[1].id, afterEdit[1].id);
  } finally {
    await closeServer(server);
  }
});

test("clipNavPreview flattens and caps sidebar last-message text", () => {
  assert.equal(clipNavPreview("  hello\nworld  "), "hello world");
  assert.equal(clipNavPreview("x".repeat(200)).length, 120);
});

test("generated images 404 unknown and reject path traversal", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const missing = await fetch(`${origin}/generated/nope.jpg`);
    assert.equal(missing.status, 404);
    const traversal = await fetch(`${origin}/generated/../oauth.json`);
    assert.equal(traversal.status, 404);
  } finally {
    await closeServer(server);
  }
});

test("workspace channel and bot updatedAt follow the last message", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const space = (await getJson(origin, "/workspace")).body as {
      channels: {
        id: string;
        name: string;
        updatedAt: string;
        createdAt: string;
      }[];
      bots: {
        id: string;
        handle: string;
        updatedAt: string;
        createdAt: string;
      }[];
    };
    const general = space.channels.find((ch) => ch.name === "general");
    const rd = space.bots.find((bot) => bot.handle === "rd");
    assert.ok(general && rd);
    assert.equal(general.updatedAt, undefined);
    assert.equal(rd.updatedAt, undefined);

    const created = await postJson(origin, "/channels", { name: "notes" });
    assert.equal(created.status, 201);
    const notes = created.body as { id: string };
    const posted = await postJson(origin, `/channels/${notes.id}/messages`, {
      body: "先記一筆",
    });
    assert.equal(posted.status, 201);
    const userMsg = (posted.body as { message: { createdAt: string } }).message;

    const dm = await postJson(origin, `/dms/${rd.id}/messages`, {
      body: "私訊一下",
    });
    assert.equal(dm.status, 201);
    const lastReply = (
      dm.body as { replies: { createdAt: string; finishedAt?: string }[] }
    ).replies.at(-1);
    assert.ok(lastReply);
    assert.ok(lastReply.finishedAt);

    const after = (await getJson(origin, "/workspace")).body as {
      channels: {
        id: string;
        updatedAt: string;
        lastMessage: { author: string; body: string; createdAt: string } | null;
      }[];
      bots: {
        id: string;
        handle: string;
        updatedAt: string;
        lastMessage: { author: string; body: string; createdAt: string } | null;
      }[];
    };
    const notesAfter = after.channels.find((ch) => ch.id === notes.id);
    const rdAfter = after.bots.find((bot) => bot.id === rd.id);
    assert.equal(notesAfter?.updatedAt, userMsg.createdAt);
    assert.equal(notesAfter?.lastMessage?.author, "you");
    assert.equal(notesAfter?.lastMessage?.body, "先記一筆");
    assert.equal(rdAfter?.updatedAt, lastReply.finishedAt || lastReply.createdAt);
    assert.ok(rdAfter?.lastMessage?.body);
    assert.equal(after.channels[0]?.id, notes.id);
    assert.equal(after.bots[0]?.id, rd.id);
  } finally {
    await closeServer(server);
  }
});

test("models.json can add a Pi-style provider", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const page = await fetch(`${origin}/settings`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /class="app settings-page"/);
    assert.match(html, /side-nav/);
    assert.match(html, /連接帳號/);
    assert.match(html, /輔助模型/);
    assert.doesNotMatch(html, /dsh-llm-oauth/);
    assert.ok(html.indexOf("主模型") < html.indexOf("連接帳號"));
    assert.match(html, /\/settings\/subs/);
    assert.match(html, /\/settings\/keys/);
    assert.match(html, /settings.sub.main/);
    const subs = await fetch(`${origin}/settings/subs`);
    assert.equal(subs.status, 200);
    const keys = await fetch(`${origin}/settings/keys`);
    assert.equal(keys.status, 200);
    assert.match(html, /modelLabel/);
    assert.match(html, /effectiveAux/);
    assert.match(html, /settings.using/);
    assert.match(html, /settings.inherited/);
    assert.match(html, /id="main-now"/);
    assert.match(html, /Vision/);
    assert.match(html, /API 金鑰供應商/);
    assert.match(html, /新增供應商/);
    assert.match(html, /provider-tabs/);
    assert.match(html, /key-tab/);
    assert.match(html, /data-add-provider/);
    assert.match(html, /add-provider-dialog/);
    assert.match(html, /preset-grid/);
    assert.match(html, /addFromPreset/);
    assert.doesNotMatch(html, /id="preset"/);
    assert.doesNotMatch(html, /toolbar-actions/);
    assert.match(html, /flushVisibleCard/);

    const listed = await getJson(origin, "/settings/models");
    assert.equal(listed.status, 200);
    const body = listed.body as {
      providers: { id: string; apiKey?: string; stored?: string }[];
    };
    const ids = body.providers.map((p) => p.id);
    assert.ok(ids.includes("openai"));
    assert.ok(ids.includes("xai"));
    assert.ok(ids.includes("ollama"));
    const openai = body.providers.find((p) => p.id === "openai");
    assert.equal(openai?.stored, "env");
    assert.equal(openai?.apiKey, "$OPENAI_API_KEY");

    const saved = await putJson(origin, "/settings/models", {
      default: { provider: "ollama", model: "llama3.1:8b" },
      providers: {
        ollama: {
          name: "Ollama",
          baseUrl: "http://localhost:11434/v1",
          api: "openai-completions",
          apiKey: "ollama",
          models: [{ id: "llama3.1:8b", name: "Llama 3.1 8B" }],
        },
        custom: {
          name: "Corp proxy",
          baseUrl: "https://llm.example.com/v1",
          api: "openai-completions",
          apiKey: "$CORP_KEY",
          models: [{ id: "corp-fast" }],
        },
      },
    });
    assert.equal(saved.status, 200);
    const after = saved.body as {
      default: { provider: string; model: string };
      providers: { id: string }[];
    };
    assert.equal(after.default.provider, "ollama");
    assert.ok(after.providers.some((p) => p.id === "custom"));

    const picked = await putJson(origin, "/settings/models", {
      default: { provider: "custom", model: "corp-fast" },
      reasoning: "high",
      aux: { generate: { provider: "custom", model: "corp-fast" } },
    });
    assert.equal(picked.status, 200);
    const picker = picked.body as {
      default: { provider: string };
      reasoning: string;
      aux: { generate: { model: string } };
      subscriptions: { id: string }[];
      auxRoles: { id: string }[];
    };
    assert.equal(picker.default.provider, "custom");
    assert.equal(picker.reasoning, "high");
    assert.equal(picker.aux.generate.model, "corp-fast");
    assert.ok(picker.subscriptions.some((s) => s.id === "xai"));
    assert.ok(picker.subscriptions.some((s) => s.id === "openai-codex"));
    assert.ok(picker.subscriptions.some((s) => s.id === "anthropic"));
    assert.ok(picker.subscriptions.some((s) => s.id === "github-copilot"));
    assert.ok(picker.subscriptions.some((s) => s.id === "openrouter"));
    assert.ok(picker.auxRoles.some((r) => r.id === "vision"));
    assert.ok(picker.auxRoles.some((r) => r.id === "web"));
    assert.ok(picker.auxRoles.some((r) => r.id === "compression"));
    assert.ok(picker.auxRoles.some((r) => r.id === "skills"));
    assert.equal(
      picker.subscriptions.find((s) => s.id === "openai-codex")?.id,
      "openai-codex",
    );
    const chatPage = await fetch(`${origin}/`);
    const chatHtml = await chatPage.text();
    assert.match(chatHtml, /推理強度/);
    assert.match(chatHtml, /速度/);
    assert.match(chatHtml, /進階/);
    assert.match(chatHtml, /model-nav/);
    assert.match(chatHtml, /model-pane/);
    assert.match(chatHtml, /搜尋全部模型/);
  } finally {
    await closeServer(server);
  }
});

test("subscription tokens show in the model picker", async () => {
  const home = tempHome();
  writeFileSync(
    join(home, "oauth.json"),
    JSON.stringify({ xai: { accessToken: "tok-from-test" } }),
  );
  const { server, origin } = await listen(home);
  try {
    const listed = await getJson(origin, "/settings/models");
    assert.equal(listed.status, 200);
    const body = listed.body as {
      picker: { id: string; ready: boolean; kind: string }[];
      subscriptions: { id: string; ready: boolean }[];
    };
    const xai = body.picker.find((p) => p.id === "xai-oauth");
    assert.equal(xai?.kind, "oauth");
    assert.equal(xai?.ready, true);
    assert.equal(body.subscriptions.find((s) => s.id === "xai")?.ready, true);

    const unknown = await postJson(origin, "/settings/oauth/nope/login", {});
    assert.equal(unknown.status, 400);

    const picked = await putJson(origin, "/settings/models", {
      default: { provider: "xai-oauth", model: "grok-4.6" },
      reasoning: "low",
      fast: true,
    });
    assert.equal(picked.status, 200);
    const after = picked.body as {
      default: { provider: string; model: string };
      reasoning: string;
      fast: boolean;
      recent: { provider: string }[];
    };
    assert.equal(after.default.provider, "xai-oauth");
    assert.equal(after.default.model, "grok-4.6");
    assert.equal(after.reasoning, "low");
    assert.equal(after.fast, true);
    assert.equal(after.recent[0]?.provider, "xai-oauth");
  } finally {
    await closeServer(server);
  }
});

test("GET bot detail includes soul agent position markdown", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const missing = await getJson(origin, "/bots/no-such-bot");
    assert.equal(missing.status, 404);
    assert.equal((missing.body as { error: string }).error, "bot not found");

    const { status, body } = await getJson(origin, "/bots/bot-rd");
    assert.equal(status, 200);
    const bot = body as {
      handle: string;
      name: string;
      skillIds: string[];
      soul: { body: string };
      agent: { body: string };
      position: { body: string };
    };
    assert.equal(bot.handle, "rd");
    assert.equal(bot.name, "RD");
    assert.ok(bot.skillIds.length >= 1);
    assert.match(bot.soul.body, /RD/);
    assert.match(bot.agent.body, /#/);
    assert.match(bot.position.body, /#/);
  } finally {
    await closeServer(server);
  }
});

test("edit page serves studio HTML for an existing bot", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const response = await fetch(`${origin}/edit/bot-rd`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /酒吧/);
    assert.match(html, /EDIT_ID/);
    assert.doesNotMatch(html, /"error":"not_found"/);
  } finally {
    await closeServer(server);
  }
});

test("PATCH bot updates name, oneLiner, skills, and soul markdown", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const before = (await getJson(origin, "/bots/bot-rd")).body as {
      skillIds: string[];
      soul: { body: string };
    };
    const extra = (
      (await getJson(origin, "/library/skills")).body as {
        id: string;
        slug: string;
      }[]
    ).find((item) => item.slug === "frontend-design");
    assert.ok(extra);
    const patched = await patchJson(origin, "/bots/bot-rd", {
      name: "資深 RD",
      oneLiner: "寫能過 review 的最小 diff",
      skillIds: [...before.skillIds, extra.id],
      soul: { name: "RD Soul", body: "# Soul\nedited for rd\n" },
    });
    assert.equal(patched.status, 200);
    const after = (await getJson(origin, "/bots/bot-rd")).body as {
      name: string;
      oneLiner: string;
      skillIds: string[];
      soul: { body: string };
    };
    const modeled = await patchJson(origin, "/bots/bot-rd", {
      model: { provider: "ollama", model: "llama3.1:8b" },
    });
    assert.equal(modeled.status, 200);
    const withModel = (await getJson(origin, "/bots/bot-rd")).body as {
      model: { provider: string; model: string };
    };
    assert.equal(withModel.model.provider, "ollama");
    assert.equal(withModel.model.model, "llama3.1:8b");
    assert.equal(after.name, "資深 RD");
    assert.equal(after.oneLiner, "寫能過 review 的最小 diff");
    assert.ok(after.skillIds.includes(extra.id));
    assert.match(after.soul.body, /edited for rd/);
  } finally {
    await closeServer(server);
  }
});

test("PATCH without skillIds leaves the roster skills in place", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const before = (await getJson(origin, "/bots/bot-pm")).body as {
      skillIds: string[];
    };
    const patched = await patchJson(origin, "/bots/bot-pm", {
      name: "PM+",
    });
    assert.equal(patched.status, 200);
    const after = (await getJson(origin, "/bots/bot-pm")).body as {
      name: string;
      skillIds: string[];
    };
    assert.equal(after.name, "PM+");
    assert.deepEqual(after.skillIds, before.skillIds);
  } finally {
    await closeServer(server);
  }
});

test("import skill from a SKILL.md URL via shipped handler", async () => {
  const fixture = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
    res.end(`---
name: url-imported
description: From a web download
---

# URL imported

Use this when importing from the web.
`);
  });
  const bound = await listenGuildServer(fixture, "127.0.0.1", 0);
  const fileUrl = `http://127.0.0.1:${bound.port}/SKILL.md`;
  const { server, origin } = await listen(tempHome());
  try {
    const imported = await postJson(origin, "/library/skills/import", {
      source: "url",
      url: fileUrl,
    });
    assert.equal(imported.status, 201);
    const names = (
      imported.body as { imported: { name: string }[] }
    ).imported.map((item) => item.name);
    assert.ok(names.includes("url-imported"));
    const listed = await getJson(origin, "/library/skills");
    assert.ok(
      (listed.body as { name: string }[]).some((item) => item.name === "url-imported"),
    );
  } finally {
    await closeServer(server);
    await closeServer(fixture);
  }
});

test("POST steer injects into a live turn and 409s when idle", async () => {
  const dataDir = tempHome();
  const store = new GuildStore(dataDir);
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, store);
  });
  const bound = await listenGuildServer(server, "127.0.0.1", 0);
  const origin = `http://127.0.0.1:${bound.port}`;
  try {
    const idle = await postJson(origin, "/channels/channel-general/steer", {
      body: "use the other file",
    });
    assert.equal(idle.status, 409);
    store.setLiveTurn("channel-general", {
      botId: "bot-x",
      thinking: "",
      steps: [],
    });
    const steered = await postJson(origin, "/channels/channel-general/steer", {
      body: "use the other file",
    });
    assert.equal(steered.status, 201);
    const message = (steered.body as {
      message: { author: string; body: string; steer?: boolean };
    }).message;
    assert.equal(message.author, "you");
    assert.equal(message.steer, true);
    assert.match(message.body, /other file/);
    const live = await getJson(origin, "/channels/channel-general/live");
    const liveBody = live.body as {
      steps: { name: string; detail: string; running?: boolean }[];
    };
    assert.equal(liveBody.steps[0].name, "steer");
    assert.equal(liveBody.steps[0].running, true);
    assert.match(liveBody.steps[0].detail, /other file/);
    const drained = store.drainSteers("channel-general");
    assert.equal(drained.length, 1);
    assert.match(drained[0], /other file/);
  } finally {
    await closeServer(server);
  }
});

test("GET live returns in-memory think/tool steps", async () => {
  const dataDir = tempHome();
  const store = new GuildStore(dataDir);
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, store);
  });
  const bound = await listenGuildServer(server, "127.0.0.1", 0);
  const origin = `http://127.0.0.1:${bound.port}`;
  try {
    const idle = await getJson(origin, "/channels/channel-general/live");
    assert.equal(idle.status, 200);
    assert.deepEqual(idle.body, { botId: "", thinking: "", steps: [] });
    const missing = await getJson(origin, "/channels/nope/live");
    assert.equal(missing.status, 404);
    store.setLiveTurn("channel-general", {
      botId: "bot-x",
      thinking: "hmm",
      startedAt: "2026-08-27T00:00:00.000Z",
      steps: [
        { name: "think", detail: "hmm" },
        { name: "read", detail: "a.ts", running: true },
      ],
    });
    const live = await getJson(origin, "/channels/channel-general/live");
    assert.equal(live.status, 200);
    const body = live.body as {
      botId: string;
      thinking: string;
      steps: { name: string; detail: string; running?: boolean }[];
    };
    assert.equal(body.botId, "bot-x");
    assert.equal(body.thinking, "hmm");
    assert.equal(body.steps.length, 2);
    assert.equal(body.steps[1].running, true);
    assert.equal((live.body as { startedAt?: string }).startedAt, "2026-08-27T00:00:00.000Z");
    const space = (await getJson(origin, "/workspace")).body as {
      live: { id: string; botId: string }[];
    };
    assert.ok(space.live.some((row) => row.id === "channel-general" && row.botId === "bot-x"));
    const stopped = await postJson(origin, "/channels/channel-general/abort", {});
    assert.equal(stopped.status, 200);
    const idleAbort = await postJson(origin, "/channels/channel-general/abort", {});
    assert.equal(idleAbort.status, 409);
    const bots = (await getJson(origin, "/bots")).body as { id: string }[];
    const dm = await getJson(origin, `/dms/${bots[0].id}/live`);
    assert.equal(dm.status, 200);
    assert.deepEqual(dm.body, { botId: "", thinking: "", steps: [] });
  } finally {
    await closeServer(server);
  }
});

test("can delete a channel but not #general", async () => {
  const { server, origin } = await listen(tempHome());
  try {
    const created = await postJson(origin, "/channels", { name: "tmp-del" });
    assert.equal(created.status, 201);
    const id = (created.body as { id: string }).id;
    const gone = await deleteJson(origin, `/channels/${id}`);
    assert.equal(gone.status, 200);
    const space = (await getJson(origin, "/workspace")).body as {
      channels: { id: string }[];
    };
    assert.ok(!space.channels.some((ch) => ch.id === id));
    const keep = await deleteJson(origin, "/channels/channel-general");
    assert.equal(keep.status, 400);
  } finally {
    await closeServer(server);
  }
});

test("deleting a bot removes it from the bench and does not reseed", async () => {
  const dataDir = tempHome();
  const first = await listen(dataDir);
  try {
    const before = (await getJson(first.origin, "/bots")).body as {
      id: string;
      handle: string;
    }[];
    const rd = before.find((bot) => bot.handle === "rd");
    assert.ok(rd);
    const gone = await deleteJson(first.origin, `/bots/${rd.id}`);
    assert.equal(gone.status, 200);
    const listed = (await getJson(first.origin, "/bots")).body as {
      handle: string;
    }[];
    assert.ok(!listed.some((bot) => bot.handle === "rd"));
    const dm = await fetch(`${first.origin}/dms/${rd.id}/messages`);
    assert.equal(dm.status, 404);
  } finally {
    await closeServer(first.server);
  }
  const second = await listen(dataDir);
  try {
    const listed = (await getJson(second.origin, "/bots")).body as {
      handle: string;
    }[];
    assert.ok(!listed.some((bot) => bot.handle === "rd"));
  } finally {
    await closeServer(second.server);
  }
});
