import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { LibraryKind, ModelRef, ModelsFile } from "@guild/protocol";
import {
  addChannelMember,
  createBot,
  createChannel,
  deleteBot,
  deleteChannel,
  createLibraryItem,
  getChannelMd,
  setChannelMd,
  getBotMemory,
  setBotMemory,
  getChannelMemory,
  setChannelMemory,
  generateKind,
  getBotDetail,
  getLiveTurn,
  abortLiveTurn,
  healthPayload,
  importSkills,
  mergeModelsFile,
  publicModels,
  listBench,
  listLibrary,
  listMcpServers,
  listHostMcpServers,
  createMcpServer,
  importMcpServer,
  deleteMcpServer,
  listRoomMessages,
  listRoomTrajectory,
  openDm,
  parseAttachments,
  postUserMessage,
  removeChannelMember,
  retryMessage,
  steerUserMessage,
  StoreError,
  updateBot,
  workspace,
  type HandlerExtras,
} from "./handlers.ts";
import type { GuildStore } from "./store.ts";
import {
  completeLogin,
  listSubscriptions,
  logoutOAuth,
  pollLogin,
  startLogin,
} from "./oauth.ts";
import { hostGit, hostList, hostRead, hostTree } from "./host-browse.ts";
import { listHostSkills } from "./host-skills.ts";
import { listHostAgents } from "./host-agents.ts";
import { generatedDir, isSafeGeneratedName } from "./image-gen.ts";

const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));

const PAGES: Record<string, { file: string; type: string }> = {
  "/": { file: "chat.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "chat.html", type: "text/html; charset=utf-8" },
  "/library": { file: "library.html", type: "text/html; charset=utf-8" },
  "/subagents": { file: "library.html", type: "text/html; charset=utf-8" },
  "/subagents/add": { file: "subagents-add.html", type: "text/html; charset=utf-8" },
  "/mcp": { file: "library.html", type: "text/html; charset=utf-8" },
  "/mcp/add": { file: "mcp-add.html", type: "text/html; charset=utf-8" },
  "/studio": { file: "studio.html", type: "text/html; charset=utf-8" },
  "/skills/add": { file: "skills-add.html", type: "text/html; charset=utf-8" },
  "/chat": { file: "chat.html", type: "text/html; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  "/chat.css": { file: "chat.css", type: "text/css; charset=utf-8" },
  "/md.js": { file: "md.js", type: "text/javascript; charset=utf-8" },
  "/i18n.js": { file: "i18n.js", type: "text/javascript; charset=utf-8" },
  "/favicon.ico": { file: "favicon.ico", type: "image/x-icon" },
  "/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
  "/favicon-16.svg": { file: "favicon-16.svg", type: "image/svg+xml" },
  "/favicon-32.png": { file: "favicon-32.png", type: "image/png" },
  "/favicon-16.png": { file: "favicon-16.png", type: "image/png" },
  "/settings": { file: "settings.html", type: "text/html; charset=utf-8" },
  "/settings/subs": { file: "settings.html", type: "text/html; charset=utf-8" },
  "/settings/keys": { file: "settings.html", type: "text/html; charset=utf-8" },
};

const LIBRARY_KINDS = new Set<LibraryKind>([
  "souls",
  "agents",
  "skills",
  "positions",
  "subagents",
]);

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
} as const;

function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...CORS_HEADERS,
    ...extra,
  });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://127.0.0.1");
}

function pathname(req: IncomingMessage): string {
  return requestUrl(req).pathname.replace(/\/+$/, "") || "/";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new StoreError(413, "body too large");
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new StoreError(400, "invalid JSON");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new StoreError(400, "JSON object required");
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") return "";
  return value;
}

function modelRefFrom(value: unknown): ModelRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const provider = str(rec, "provider").trim();
  const model = str(rec, "model").trim();
  if (!provider || !model) return null;
  return { provider, model };
}

function strList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value) return [value];
  return [];
}

function draft(
  record: Record<string, unknown>,
  key: string,
): { name: string; body: string } | undefined {
  const value = record[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const nested = value as Record<string, unknown>;
  const name = str(nested, "name");
  const body = str(nested, "body");
  if (!body.trim()) return undefined;
  return { name, body };
}

function libraryKindFromPath(path: string): LibraryKind | null {
  const match = /^\/library\/(souls|agents|skills|positions|subagents)$/.exec(path);
  if (!match) return null;
  const kind = match[1];
  if (!LIBRARY_KINDS.has(kind as LibraryKind)) return null;
  return kind as LibraryKind;
}

/** Shipped request handler used by the daemon process and tests. */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: GuildStore,
  env: NodeJS.ProcessEnv = process.env,
  extras: HandlerExtras = {},
): Promise<void> {
  const method = req.method ?? "GET";
  const path = pathname(req);

  try {
    if (method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const page = PAGES[path];
    if (method === "GET" && /^\/edit\/[^/]+$/.test(path)) {
      const html = readFileSync(`${PUBLIC}studio.html`);
      send(res, 200, "text/html; charset=utf-8", html);
      return;
    }

    if (method === "GET" && page) {
      const body = readFileSync(`${PUBLIC}${page.file}`);
      const extra = page.type.startsWith("image/")
        ? { "cache-control": "public, max-age=86400" }
        : {};
      send(res, 200, page.type, body, extra);
      return;
    }

    if (method === "GET" && path.startsWith("/generated/")) {
      const name = decodeURIComponent(path.slice("/generated/".length));
      if (!isSafeGeneratedName(name)) {
        json(res, 404, { error: "not_found", path });
        return;
      }
      const file = `${generatedDir(store.dataDir)}/${name}`;
      if (!existsSync(file)) {
        json(res, 404, { error: "not_found", path });
        return;
      }
      const type = name.endsWith(".png")
        ? "image/png"
        : name.endsWith(".webp")
          ? "image/webp"
          : name.endsWith(".gif")
            ? "image/gif"
            : "image/jpeg";
      const bytes = readFileSync(file);
      res.writeHead(200, {
        "content-type": type,
        "content-length": bytes.length,
        "cache-control": "private, max-age=86400",
        ...CORS_HEADERS,
      });
      res.end(bytes);
      return;
    }

    if (method === "GET" && path.startsWith("/rpg/")) {
      const name = path.slice(5);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        json(res, 404, { error: "not_found", path });
        return;
      }
      const file = `${PUBLIC}rpg/${name}`;
      if (!existsSync(file)) {
        json(res, 404, { error: "not_found", path });
        return;
      }
      const type = name.endsWith(".png")
        ? "image/png"
        : name.endsWith(".jpg") || name.endsWith(".jpeg")
          ? "image/jpeg"
          : "application/octet-stream";
      send(res, 200, type, readFileSync(file));
      return;
    }

    if (method === "GET" && path === "/health") {
      json(res, 200, healthPayload());
      return;
    }

    if (method === "GET" && (path === "/bots" || path === "/bench")) {
      json(res, 200, listBench(store));
      return;
    }

    if (method === "GET" && path === "/workspace") {
      json(res, 200, workspace(store));
      return;
    }

    if (method === "GET" && path === "/host/ls") {
      json(res, 200, hostList(requestUrl(req).searchParams.get("path") || "~"));
      return;
    }
    if (method === "GET" && path === "/host/read") {
      json(res, 200, hostRead(requestUrl(req).searchParams.get("path") || ""));
      return;
    }
    if (method === "GET" && path === "/host/tree") {
      json(res, 200, hostTree(requestUrl(req).searchParams.get("path") || "~"));
      return;
    }
    if (method === "GET" && path === "/host/git") {
      json(res, 200, await hostGit(requestUrl(req).searchParams.get("path") || "~"));
      return;
    }

    if (method === "POST" && path === "/channels") {
      const body = asRecord(await readJson(req));
      json(res, 201, createChannel(store, str(body, "name")));
      return;
    }
    const channelOne = path.match(/^\/channels\/([^/]+)$/);
    if (channelOne && method === "DELETE") {
      json(res, 200, deleteChannel(store, decodeURIComponent(channelOne[1])));
      return;
    }

    const channelMd = path.match(/^\/channels\/([^/]+)\/channel\.md$/);
    if (channelMd && method === "GET") {
      json(res, 200, getChannelMd(store, decodeURIComponent(channelMd[1])));
      return;
    }
    if (channelMd && method === "PUT") {
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        setChannelMd(
          store,
          decodeURIComponent(channelMd[1]),
          typeof body.body === "string" ? body.body : "",
        ),
      );
      return;
    }

    const dmChannelMd = path.match(/^\/dms\/([^/]+)\/channel\.md$/);
    if (dmChannelMd && (method === "GET" || method === "PUT")) {
      throw new StoreError(400, "Channel.md is only for channels");
    }

    const botMemory = path.match(/^\/bots\/([^/]+)\/memory\.md$/);
    if (botMemory && method === "GET") {
      json(res, 200, getBotMemory(store, decodeURIComponent(botMemory[1])));
      return;
    }
    if (botMemory && method === "PUT") {
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        setBotMemory(
          store,
          decodeURIComponent(botMemory[1]),
          typeof body.body === "string" ? body.body : "",
        ),
      );
      return;
    }

    const channelMemory = path.match(/^\/channels\/([^/]+)\/memory\.md$/);
    if (channelMemory && method === "GET") {
      json(
        res,
        200,
        getChannelMemory(store, decodeURIComponent(channelMemory[1])),
      );
      return;
    }
    if (channelMemory && method === "PUT") {
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        setChannelMemory(
          store,
          decodeURIComponent(channelMemory[1]),
          typeof body.body === "string" ? body.body : "",
        ),
      );
      return;
    }

    const dmMemory = path.match(/^\/dms\/([^/]+)\/memory\.md$/);
    if (dmMemory && (method === "GET" || method === "PUT")) {
      throw new StoreError(400, "Channel MEMORY.md is only for channels");
    }

    const channelMember = path.match(
      /^\/channels\/([^/]+)\/members\/([^/]+)$/,
    );
    if (channelMember && method === "DELETE") {
      json(
        res,
        200,
        removeChannelMember(store, channelMember[1], channelMember[2]),
      );
      return;
    }

    const channelMembers = path.match(/^\/channels\/([^/]+)\/members$/);
    if (channelMembers && method === "POST") {
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        addChannelMember(store, channelMembers[1], str(body, "botId")),
      );
      return;
    }

    const retryChannel = path.match(
      /^\/channels\/([^/]+)\/messages\/([^/]+)\/retry$/,
    );
    if (retryChannel && method === "POST") {
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        await retryMessage(
          store,
          retryChannel[1],
          retryChannel[2],
          str(body, "body") || undefined,
          env,
          str(body, "assigneeId") || undefined,
          extras,
        ),
      );
      return;
    }

    const retryDm = path.match(
      /^\/dms\/([^/]+)\/messages\/([^/]+)\/retry$/,
    );
    if (retryDm && method === "POST") {
      const room = openDm(store, retryDm[1]);
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        await retryMessage(
          store,
          room.id,
          retryDm[2],
          str(body, "body") || undefined,
          env,
          str(body, "assigneeId") || undefined,
          extras,
        ),
      );
      return;
    }

    const channelTraj = path.match(/^\/channels\/([^/]+)\/trajectory$/);
    if (channelTraj && method === "GET") {
      json(res, 200, listRoomTrajectory(store, channelTraj[1]));
      return;
    }
    const dmTraj = path.match(/^\/dms\/([^/]+)\/trajectory$/);
    if (dmTraj && method === "GET") {
      const room = openDm(store, dmTraj[1]);
      json(res, 200, listRoomTrajectory(store, room.id));
      return;
    }

    const channelLive = path.match(/^\/channels\/([^/]+)\/live$/);
    if (channelLive && method === "GET") {
      json(res, 200, getLiveTurn(store, decodeURIComponent(channelLive[1])));
      return;
    }
    const dmLive = path.match(/^\/dms\/([^/]+)\/live$/);
    if (dmLive && method === "GET") {
      const room = openDm(store, decodeURIComponent(dmLive[1]));
      json(res, 200, getLiveTurn(store, room.id));
      return;
    }

    const channelAbort = path.match(/^\/channels\/([^/]+)\/abort$/);
    if (channelAbort && method === "POST") {
      json(res, 200, abortLiveTurn(store, decodeURIComponent(channelAbort[1])));
      return;
    }
    const dmAbort = path.match(/^\/dms\/([^/]+)\/abort$/);
    if (dmAbort && method === "POST") {
      const room = openDm(store, decodeURIComponent(dmAbort[1]));
      json(res, 200, abortLiveTurn(store, room.id));
      return;
    }

    const channelSteer = path.match(/^\/channels\/([^/]+)\/steer$/);
    if (channelSteer && method === "POST") {
      const body = asRecord(await readJson(req));
      json(
        res,
        201,
        steerUserMessage(
          store,
          decodeURIComponent(channelSteer[1]),
          str(body, "body"),
          parseAttachments(body.attachments),
        ),
      );
      return;
    }
    const dmSteer = path.match(/^\/dms\/([^/]+)\/steer$/);
    if (dmSteer && method === "POST") {
      const room = openDm(store, decodeURIComponent(dmSteer[1]));
      const body = asRecord(await readJson(req));
      json(
        res,
        201,
        steerUserMessage(
          store,
          room.id,
          str(body, "body"),
          parseAttachments(body.attachments),
        ),
      );
      return;
    }

    const channelMessages = path.match(/^\/channels\/([^/]+)\/messages$/);
    if (channelMessages && method === "GET") {
      json(res, 200, listRoomMessages(store, channelMessages[1]));
      return;
    }
    if (channelMessages && method === "POST") {
      const body = asRecord(await readJson(req));
      json(
        res,
        201,
        await postUserMessage(
          store,
          channelMessages[1],
          str(body, "body"),
          env,
          str(body, "replyTo") || undefined,
          parseAttachments(body.attachments),
          str(body, "assigneeId") || undefined,
          extras,
        ),
      );
      return;
    }

    const dmMessages = path.match(/^\/dms\/([^/]+)\/messages$/);
    if (dmMessages && method === "GET") {
      const room = openDm(store, dmMessages[1]);
      json(res, 200, listRoomMessages(store, room.id));
      return;
    }
    if (dmMessages && method === "POST") {
      const room = openDm(store, dmMessages[1]);
      const body = asRecord(await readJson(req));
      json(
        res,
        201,
        await postUserMessage(
          store,
          room.id,
          str(body, "body"),
          env,
          str(body, "replyTo") || undefined,
          parseAttachments(body.attachments),
          str(body, "assigneeId") || undefined,
          extras,
        ),
      );
      return;
    }

    if (method === "GET" && path === "/mcp/servers") {
      if (extras.mcp === false) {
        json(res, 200, []);
        return;
      }
      json(res, 200, listMcpServers(store));
      return;
    }
    if (method === "GET" && path === "/mcp/host") {
      json(res, 200, listHostMcpServers());
      return;
    }
    if (method === "POST" && path === "/mcp/servers") {
      if (extras.mcp === false) {
        json(res, 503, { error: "mcp_disabled" });
        return;
      }
      const body = asRecord(await readJson(req));
      const envValue = body.env;
      const env: Record<string, string> = {};
      if (envValue && typeof envValue === "object" && !Array.isArray(envValue)) {
        for (const [key, value] of Object.entries(
          envValue as Record<string, unknown>,
        )) {
          if (typeof value === "string") env[key] = value;
        }
      }
      json(
        res,
        201,
        createMcpServer(store, {
          name: str(body, "name"),
          command: str(body, "command"),
          args: strList(body, "args"),
          env: Object.keys(env).length ? env : undefined,
          cwd: str(body, "cwd") || undefined,
          url: str(body, "url") || undefined,
        }),
      );
      return;
    }
    if (method === "POST" && path === "/mcp/import") {
      if (extras.mcp === false) {
        json(res, 503, { error: "mcp_disabled" });
        return;
      }
      const body = asRecord(await readJson(req));
      json(res, 201, importMcpServer(store, str(body, "id")));
      return;
    }
    const mcpOne = path.match(/^\/mcp\/servers\/([^/]+)$/);
    if (mcpOne && method === "DELETE") {
      if (extras.mcp === false) {
        json(res, 503, { error: "mcp_disabled" });
        return;
      }
      json(res, 200, deleteMcpServer(store, decodeURIComponent(mcpOne[1])));
      return;
    }

    if (method === "GET" && path === "/library/skills/host") {
      const url = requestUrl(req);
      const id = url.searchParams.get("id");
      const includeBody = id ? true : url.searchParams.get("body") !== "0";
      const listed = listHostSkills({ includeBody });
      if (id) {
        const hit = listed.find((item) => item.id === id);
        if (!hit) {
          json(res, 404, { error: "not_found" });
          return;
        }
        json(res, 200, hit);
        return;
      }
      json(res, 200, listed);
      return;
    }

    if (method === "GET" && path === "/library/subagents/host") {
      const url = requestUrl(req);
      const id = url.searchParams.get("id");
      const includeBody = id ? true : url.searchParams.get("body") !== "0";
      const listed = listHostAgents({ includeBody });
      if (id) {
        const hit = listed.find((item) => item.id === id);
        if (!hit) {
          json(res, 404, { error: "not_found" });
          return;
        }
        json(res, 200, hit);
        return;
      }
      json(res, 200, listed);
      return;
    }

    if (method === "POST" && path === "/library/skills/import") {
      const body = asRecord(await readJson(req));
      const imported = await importSkills(store, {
        source: str(body, "source"),
        url: str(body, "url") || undefined,
        repo: str(body, "repo") || undefined,
      });
      json(res, 201, { imported });
      return;
    }

    if (method === "POST" && path === "/generate") {
      const body = asRecord(await readJson(req));
      const generated = await generateKind(
        store,
        str(body, "kind"),
        str(body, "prompt"),
      );
      json(res, 200, generated);
      return;
    }

    if (method === "GET" && path === "/settings/models") {
      json(res, 200, publicModels(store.dataDir));
      return;
    }
    if (method === "PUT" && path === "/settings/models") {
      const body = asRecord(await readJson(req));
      const providers = body.providers;
      const patch: Partial<ModelsFile> = {};
      if (providers && typeof providers === "object" && !Array.isArray(providers)) {
        patch.providers = providers as ModelsFile["providers"];
      }
      if (Object.hasOwn(body, "default")) {
        patch.default =
          body.default && typeof body.default === "object"
            ? {
                provider: str(body.default as Record<string, unknown>, "provider"),
                model: str(body.default as Record<string, unknown>, "model"),
              }
            : null;
      }
      if (typeof body.reasoning === "string") {
        patch.reasoning = body.reasoning as ModelsFile["reasoning"];
      }
      if (typeof body.fast === "boolean") patch.fast = body.fast;
      if (Object.hasOwn(body, "aux") && body.aux && typeof body.aux === "object") {
        patch.aux = body.aux as ModelsFile["aux"];
      }
      mergeModelsFile(store.dataDir, patch);
      json(res, 200, publicModels(store.dataDir));
      return;
    }

    if (method === "GET" && path === "/settings/oauth") {
      if (extras.oauth === false) {
        json(res, 200, { subscriptions: [] });
        return;
      }
      json(res, 200, { subscriptions: listSubscriptions(store.dataDir) });
      return;
    }
    const oauthLogin = path.match(/^\/settings\/oauth\/([^/]+)\/login$/);
    if (oauthLogin && method === "POST") {
      if (extras.oauth === false) {
        json(res, 503, { error: "oauth_disabled" });
        return;
      }
      json(res, 200, await startLogin(store.dataDir, decodeURIComponent(oauthLogin[1])));
      return;
    }
    const oauthPoll = path.match(/^\/settings\/oauth\/([^/]+)\/poll$/);
    if (oauthPoll && method === "POST") {
      if (extras.oauth === false) {
        json(res, 503, { error: "oauth_disabled" });
        return;
      }
      json(res, 200, await pollLogin(store.dataDir, decodeURIComponent(oauthPoll[1])));
      return;
    }
    const oauthComplete = path.match(/^\/settings\/oauth\/([^/]+)\/complete$/);
    if (oauthComplete && method === "POST") {
      if (extras.oauth === false) {
        json(res, 503, { error: "oauth_disabled" });
        return;
      }
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        await completeLogin(store.dataDir, decodeURIComponent(oauthComplete[1]), {
          code: str(body, "code") || undefined,
          url: str(body, "url") || undefined,
        }),
      );
      return;
    }
    const oauthLogout = path.match(/^\/settings\/oauth\/([^/]+)\/logout$/);
    if (oauthLogout && method === "POST") {
      if (extras.oauth === false) {
        json(res, 503, { error: "oauth_disabled" });
        return;
      }
      json(res, 200, await logoutOAuth(store.dataDir, decodeURIComponent(oauthLogout[1])));
      return;
    }

    const botId = path.match(/^\/bots\/([^/]+)$/)?.[1];
    if (botId && method === "GET") {
      json(res, 200, getBotDetail(store, botId));
      return;
    }
    if (botId && method === "DELETE") {
      json(res, 200, deleteBot(store, decodeURIComponent(botId)));
      return;
    }
    if (botId && method === "PATCH") {
      const body = asRecord(await readJson(req));
      const bot = updateBot(store, botId, {
        name: str(body, "name") || undefined,
        handle: str(body, "handle") || undefined,
        oneLiner: str(body, "oneLiner") || undefined,
        skillIds: Object.hasOwn(body, "skillIds")
          ? strList(body, "skillIds")
          : undefined,
        soul: draft(body, "soul"),
        agent: draft(body, "agent"),
        position: draft(body, "position"),
        ...(Object.hasOwn(body, "model")
          ? { model: modelRefFrom(body.model) }
          : {}),
      });
      json(res, 200, bot);
      return;
    }

    if (method === "POST" && path === "/bots") {
      const body = asRecord(await readJson(req));
      const bot = createBot(store, {
        name: str(body, "name"),
        handle: str(body, "handle"),
        oneLiner: str(body, "oneLiner") || undefined,
        soulId: str(body, "soulId") || undefined,
        agentTemplateId: str(body, "agentTemplateId") || undefined,
        defaultPositionId: str(body, "defaultPositionId") || undefined,
        soul: draft(body, "soul"),
        agent: draft(body, "agent"),
        position: draft(body, "position"),
        skillIds: strList(body, "skillIds"),
        skillId: str(body, "skillId") || undefined,
      });
      json(res, 201, bot);
      return;
    }

    const kind = libraryKindFromPath(path);
    if (kind && method === "GET") {
      json(res, 200, listLibrary(store, kind));
      return;
    }
    if (kind && method === "POST") {
      const body = asRecord(await readJson(req));
      const item = createLibraryItem(store, kind, {
        name: str(body, "name"),
        body: str(body, "body"),
        slug: str(body, "slug") || undefined,
        description: str(body, "description") || undefined,
      });
      json(res, 201, item);
      return;
    }

    json(res, 404, { error: "not_found", path });
  } catch (error) {
    if (error instanceof StoreError) {
      json(res, error.status, { error: error.message });
      return;
    }
    json(res, 500, { error: "internal_error" });
  }
}
