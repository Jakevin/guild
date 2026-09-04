import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { closeServer, listen as listenApp } from "./app.ts";
import { writeModelsFile } from "../src/llm.ts";
import { BRANCH_CONTEXT_CAP, GuildStore } from "../src/store.ts";

const CHAT_HTML = fileURLToPath(
  new URL("../src/public/chat.html", import.meta.url),
);
const CHAT_CSS = fileURLToPath(
  new URL("../src/public/chat.css", import.meta.url),
);
const I18N = fileURLToPath(
  new URL("../src/public/i18n.js", import.meta.url),
);

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-branch-"));
}

async function json(
  origin: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}${path}`, init);
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

test("message actions put 分支 after 重問", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const i18n = readFileSync(I18N, "utf8");
  const css = readFileSync(CHAT_CSS, "utf8");
  assert.match(html, /data-retry/);
  assert.match(html, /data-branch/);
  assert.match(
    html,
    /data-retry[\s\S]*?t\("retry"\)[\s\S]*?data-branch[\s\S]*?t\("branch"\)/,
  );
  assert.match(html, /\/channels\/.+\/branches/);
  assert.match(html, /nav-quest/);
  assert.match(html, /nav-branches/);
  assert.match(i18n, /\["branch", "分支"/);
  assert.match(css, /li\.nav-quest/);
  assert.match(css, /\.nav-branch/);
  assert.match(html, /chat\.css\?v=cron-sheet/);
  assert.match(html, /↳ /);
});

test("createBranch nests a child quest with the parent's roster", () => {
  const store = new GuildStore(tempHome());
  try {
    const parent = store.createChannel("bot-team-project");
    const design = store.listBots().find((bot) => bot.handle === "design");
    const infra = store.listBots().find((bot) => bot.handle === "infra");
    assert.ok(design && infra);
    store.addMember(parent.id, design.id);
    store.addMember(parent.id, infra.id);
    store.writeChannelMd(parent.id, "# quest\nKeep the Pages stills.\n");
    const source = store.appendMessage(
      parent.id,
      "you",
      "github io 靜態頁的設計要另開",
    );
    const child = store.createBranch(parent.id, source.id, "pages-design");
    assert.equal(child.parentId, parent.id);
    assert.equal(child.branchFromId, source.id);
    assert.equal(child.name, "pages-design");
    assert.deepEqual(child.memberIds.slice().sort(), [design.id, infra.id].sort());
    assert.match(store.readChannelMd(child.id), /Pages stills/);
    const seeded = store.listMessages(child.id);
    assert.equal(seeded.length, 1);
    assert.equal(seeded[0]?.author, "you");
    assert.equal(seeded[0]?.body, source.body);
    assert.notEqual(seeded[0]?.id, source.id);
    store.deleteChannel(parent.id);
    assert.equal(store.getRoom(child.id), null);
  } finally {
    store.close();
  }
});

test("POST /channels/:id/branches opens a nested quest from a message", async () => {
  const home = tempHome();
  const { server, origin } = await listenApp(home, {});
  try {
    const created = await json(origin, "/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "main-quest" }),
    });
    assert.equal(created.status, 201);
    const channelId = String(created.body.id);
    const posted = await json(origin, `/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "先把靜態頁設計拆出去" }),
    });
    assert.equal(posted.status, 201);
    const message = posted.body.message as { id?: string } | undefined;
    assert.ok(message?.id);
    const branched = await json(origin, `/channels/${channelId}/branches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: message.id, name: "靜態頁" }),
    });
    assert.equal(branched.status, 201);
    assert.equal(branched.body.parentId, channelId);
    assert.equal(branched.body.branchFromId, message.id);
    assert.equal(branched.body.name, "靜態頁");
    const space = await json(origin, "/workspace");
    const channels = space.body.channels as {
      id: string;
      parentId?: string;
      name: string;
    }[];
    const child = channels.find((row) => row.id === branched.body.id);
    assert.ok(child);
    assert.equal(child?.parentId, channelId);
  } finally {
    await closeServer(server);
  }
});

test("createBranch copies Channel.md and the last 20 parent messages", () => {
  const store = new GuildStore(tempHome());
  try {
    const parent = store.createChannel("context-quest");
    const design = store.listBots().find((bot) => bot.handle === "design");
    assert.ok(design);
    store.addMember(parent.id, design.id);
    store.writeChannelMd(parent.id, "# parent\nKeep H1 Pixelify.\n");
    const rows = [];
    for (let i = 0; i < BRANCH_CONTEXT_CAP + 5; i++) {
      rows.push(
        store.appendMessage(
          parent.id,
          i % 2 === 0 ? "you" : design.id,
          `msg ${i}`,
        ),
      );
    }
    const pivot = rows[rows.length - 3];
    const child = store.createBranch(parent.id, pivot.id, "side");
    assert.equal(store.readChannelMd(child.id), "# parent\nKeep H1 Pixelify.\n");
    const copied = store.listMessages(child.id);
    assert.equal(copied.length, BRANCH_CONTEXT_CAP);
    assert.equal(copied[copied.length - 1]?.body, pivot.body);
    assert.equal(copied[0]?.body, "msg 3");
    assert.equal(
      copied.filter((item) => item.body === rows[rows.length - 1].body).length,
      0,
    );
    const earlier = store.createBranch(parent.id, rows[2].id, "early");
    const earlyCopied = store.listMessages(earlier.id);
    assert.equal(earlyCopied.length, 3);
    assert.deepEqual(
      earlyCopied.map((item) => item.body),
      ["msg 0", "msg 1", "msg 2"],
    );
  } finally {
    store.close();
  }
});

test("hall 結案 is for branches; 刪除 stays on root quests", () => {
  const html = readFileSync(CHAT_HTML, "utf8");
  const i18n = readFileSync(I18N, "utf8");
  assert.match(html, /id="channel-md-del"/);
  assert.match(html, /\/channels\/.+\/close/);
  assert.match(html, /branch\.close/);
  assert.match(html, /branch\.closeMerge/);
  assert.match(i18n, /\["branch.close", "結案"/);
  assert.match(i18n, /MEMORY\.md/);
  assert.match(html, /parentId/);
});

test("DELETE refuses a branch; POST /close folds MEMORY.md into the parent", async () => {
  const home = tempHome();
  writeModelsFile(home, { default: null, providers: {} });
  const { server, origin } = await listenApp(home, {});
  try {
    const created = await json(origin, "/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "main-quest" }),
    });
    const parentId = String(created.body.id);
    await json(origin, `/channels/${parentId}/memory.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "# Parent\n- keep H1 Pixelify\n" }),
    });
    const posted = await json(origin, `/channels/${parentId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "拆靜態頁" }),
    });
    const message = posted.body.message as { id?: string } | undefined;
    const branched = await json(origin, `/channels/${parentId}/branches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: message?.id, name: "pages" }),
    });
    const childId = String(branched.body.id);
    await json(origin, `/channels/${childId}/memory.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "# pages\n- four locales on site/index.html\n- skip daemon UI\n",
      }),
    });

    const blocked = await json(origin, `/channels/${childId}`, {
      method: "DELETE",
    });
    assert.equal(blocked.status, 400);
    assert.ok(await json(origin, `/channels/${childId}/memory.md`).then((r) => r.status === 200));

    const closed = await json(origin, `/channels/${childId}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ merge: true }),
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.ok, true);
    assert.equal(closed.body.parentId, parentId);
    assert.equal(closed.body.merged, true);
    const gone = await json(origin, `/channels/${childId}/memory.md`);
    assert.equal(gone.status, 404);
    const parentMem = await json(origin, `/channels/${parentId}/memory.md`);
    assert.match(String(parentMem.body.body), /Pixelify/);
    assert.match(String(parentMem.body.body), /site\/index\.html|four locales|pages/);
  } finally {
    await closeServer(server);
  }
});

test("POST /close without merge drops the branch and leaves parent MEMORY.md", async () => {
  const home = tempHome();
  writeModelsFile(home, { default: null, providers: {} });
  const { server, origin } = await listenApp(home, {});
  try {
    const created = await json(origin, "/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "keep-notes" }),
    });
    const parentId = String(created.body.id);
    await json(origin, `/channels/${parentId}/memory.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "# Parent\n- do not touch\n" }),
    });
    const posted = await json(origin, `/channels/${parentId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "side" }),
    });
    const message = posted.body.message as { id?: string } | undefined;
    const branched = await json(origin, `/channels/${parentId}/branches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: message?.id, name: "scratch" }),
    });
    const childId = String(branched.body.id);
    await json(origin, `/channels/${childId}/memory.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "# scratch\n- throwaway\n" }),
    });
    const closed = await json(origin, `/channels/${childId}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ merge: false }),
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.merged, false);
    const parentMem = await json(origin, `/channels/${parentId}/memory.md`);
    assert.equal(parentMem.body.body, "# Parent\n- do not touch\n");
    const gone = await json(origin, `/channels/${childId}`, { method: "DELETE" });
    assert.equal(gone.status, 404);
  } finally {
    await closeServer(server);
  }
});
