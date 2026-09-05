import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { LibraryKind, ModelRef, ModelsFile } from "@guild/protocol";
import {
  addChannelMember,
  createBot,
  createChannel,
  createBranch,
  closeBranch,
  deleteBot,
  deleteChannel,
  renameChannel,
  createLibraryItem,
  getChannelMd,
  setChannelMd,
  getBotMemory,
  setBotMemory,
  getChannelMemory,
  setChannelMemory,
  generateKind,
  pickBotSkills,
  generateBotLook,
  getBotDetail,
  getLiveTurn,
  abortLiveTurn,
  pauseLiveTurn,
  continueLiveTurn,
  healthPayload,
  importSkills,
  mergeModelsFile,
  publicModels,
  setShownModels,
  refreshOpenCodeFreeCatalog,
  refreshReasoningCatalog,
  listBench,
  listLibrary,
  listMcpServers,
  listHostMcpServers,
  createMcpServer,
  importMcpServer,
  deleteMcpServer,
  deleteRoomMessage,
  listRoomMessages,
  listRoomTrajectory,
  resolveDm,
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
  refreshCopilotCatalog,
  logoutOAuth,
  pollLogin,
  startLogin,
} from "./oauth.ts";
import { isFreebuffChatEnabled, stripWebBridgePicker } from "./freebuff-chat.ts";
import {
  doctorFreebuff,
  freebuffWebStatus,
  logoutFreebuff,
  pollFreebuffLogin,
  startFreebuffLogin,
} from "./freebuff-bridge.ts";
import {
  clearCommandCodeState,
  commandCodeStatus,
  refreshCommandCodeCatalog,
  saveCommandCodeApiKey,
} from "./commandcode.ts";
import {
  cancelCommandCodeLogin,
  pollCommandCodeLogin,
  startCommandCodeLogin,
} from "./commandcode-login.ts";
import { hostGit, hostList, hostRead, hostTree } from "./host-browse.ts";
import { listHostSkills } from "./host-skills.ts";
import { listHostAgents } from "./host-agents.ts";
import { generatedDir, isSafeGeneratedName } from "./image-gen.ts";
import {
  createCronJob,
  fireCronJob,
  pauseCronJob,
  publicCronJob,
  publicCronRun,
  removeCronJob,
  resumeCronJob,
  updateCronJob,
} from "./cron.ts";
import {
  allowedWorkspaceWritePath,
  resolveToolPath,
  workspaceFromEnv,
} from "./harness.ts";

const LOCAL_IMAGE_CAP = 12 * 1024 * 1024;

function localImageType(path: string): string | null {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return null;
}

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
  "/m": { file: "mobile.html", type: "text/html; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  "/chat.css": { file: "chat.css", type: "text/css; charset=utf-8" },
  "/mobile.css": { file: "mobile.css", type: "text/css; charset=utf-8" },
  "/md.js": { file: "md.js", type: "text/javascript; charset=utf-8" },
  "/i18n.js": { file: "i18n.js", type: "text/javascript; charset=utf-8" },
  "/buddy.js": { file: "buddy.js", type: "text/javascript; charset=utf-8" },
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

/**
 * Same-origin guard. The hall UI is served by this daemon (`http://127.0.0.1:7420/`
 * and the Tailscale address), so it never needs CORS. A request that carries an
 * `Origin` from somewhere else is a foreign page trying to read local files
 * (`/host/read`), so it is refused before any route runs.
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
/** Tailscale MagicDNS names: `machine.tailnet.ts.net`. */
const MAGIC_DNS_SUFFIX = ".ts.net";

function headerLine(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : "";
}

function normalizeHost(host: string): string {
  const lower = host.trim().toLowerCase().replace(/\.$/, "");
  return LOCAL_HOSTS.has(lower) ? "127.0.0.1" : lower;
}

/** Host header is an authority, not a URL: `127.0.0.1:7420`, `[::1]:7420`, `bot.local`. */
function hostPortOf(authority: string): { host: string; port: string } {
  const value = authority.trim();
  if (!value) return { host: "", port: "" };
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    const host = end === -1 ? value : value.slice(0, end + 1);
    const rest = end === -1 ? "" : value.slice(end + 1);
    const colon = rest.indexOf(":");
    return { host, port: colon === -1 ? "" : rest.slice(colon + 1) };
  }
  const colon = value.indexOf(":");
  if (colon === -1) return { host: value, port: "" };
  return { host: value.slice(0, colon), port: value.slice(colon + 1) };
}

/** Dotted-quad octets, or null when this is not an IPv4 literal. */
function ipv4Octets(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * True only for authorities that cannot be a public name: loopback, RFC1918,
 * CGNAT / Tailscale 100.64/10, and MagicDNS `*.ts.net`. A rebinding page
 * (`evil.com` resolving to 127.0.0.1) matches Origin against Host, so the
 * authority itself has to be checked too.
 */
export function isLocalAuthority(raw: string): boolean {
  let host = String(raw || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (LOCAL_HOSTS.has(host)) return true;
  const octets = ipv4Octets(host);
  if (octets) {
    const [first, second] = octets as [number, number, number, number];
    if (first === 127) return true; // 127/8 loopback
    if (first === 10) return true; // RFC1918
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 100 && second >= 64 && second <= 127) return true; // CGNAT
    return false;
  }
  return host.endsWith(MAGIC_DNS_SUFFIX);
}

/** True when there is no Origin (curl, Node fetch, same-origin opaque) or it matches Host. */
export function sameOrigin(req: IncomingMessage): boolean {
  const raw = headerLine(req.headers.origin);
  if (!raw) return true;
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    return false;
  }
  const secure = origin.protocol === "https:";
  if (!secure && origin.protocol !== "http:") return false;
  const host = headerLine(req.headers.host);
  if (!host) return false;
  const wanted = hostPortOf(host);
  // Origin == Host is not enough: DNS rebinding makes a public name resolve to
  // this machine, so both authorities must be loopback / private.
  if (!isLocalAuthority(wanted.host) || !isLocalAuthority(origin.hostname)) {
    return false;
  }
  return (
    normalizeHost(wanted.host) === normalizeHost(origin.hostname) &&
    (wanted.port || (secure ? "443" : "80")) ===
      (origin.port || (secure ? "443" : "80"))
  );
}

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
  const reasoning = str(rec, "reasoning").trim();
  return reasoning ? { provider, model, reasoning } : { provider, model };
}

function strList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value) return [value];
  return [];
}

function freebuffHttpDisabled(
  extras: HandlerExtras,
  env: NodeJS.ProcessEnv,
): boolean {
  return extras.freebuff === false || !isFreebuffChatEnabled(env);
}

function modelsPayload(
  dataDir: string,
  extras: HandlerExtras,
  env: NodeJS.ProcessEnv,
) {
  const body = publicModels(dataDir, env);
  if (freebuffHttpDisabled(extras, env)) return stripWebBridgePicker(body);
  return body;
}

function extrasWithMentions(
  extras: HandlerExtras,
  body: Record<string, unknown>,
): HandlerExtras {
  const mentions = strList(body, "mentions")
    .map((id) => id.trim())
    .filter(Boolean);
  return mentions.length ? { ...extras, mentions } : extras;
}

function skillPickCatalog(
  record: Record<string, unknown>,
): { id: string; name: string; description?: string; tags?: string[]; slug?: string }[] {
  const raw = record.skills;
  if (!Array.isArray(raw)) return [];
  const out: {
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    slug?: string;
  }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const id = str(rec, "id").trim();
    const name = str(rec, "name").trim();
    if (!id || !name) continue;
    out.push({
      id,
      name,
      description: str(rec, "description"),
      slug: str(rec, "slug"),
      tags: strList(rec, "tags"),
    });
  }
  return out;
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
    if (!sameOrigin(req)) {
      throw new StoreError(403, "cross-origin refused");
    }

    if (method === "OPTIONS") {
      res.writeHead(204);
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
      const file = `${PUBLIC}${page.file}`;
      if (!existsSync(file)) {
        json(res, 404, { error: "not_found", path });
        return;
      }
      const body = readFileSync(file);
      const extra = page.type.startsWith("image/")
        ? { "cache-control": "public, max-age=86400" }
        : {};
      send(res, 200, page.type, body, extra);
      return;
    }

    if (method === "GET" && path === "/local") {
      const raw = requestUrl(req).searchParams.get("p") || "";
      const type = localImageType(raw);
      if (!raw.startsWith("/") || raw.includes("\0") || raw.includes("..") || !type) {
        json(res, 404, { error: "not_found", path });
        return;
      }
      const target = resolveToolPath(raw);
      if (!allowedWorkspaceWritePath(target, workspaceFromEnv(env), store.dataDir)) {
        json(res, 404, { error: "not_found", path });
        return;
      }
      if (!existsSync(target)) {
        json(res, 404, { error: "not_found", path });
        return;
      }
      const st = statSync(target);
      if (!st.isFile() || st.size > LOCAL_IMAGE_CAP) {
        json(res, 404, { error: "not_found", path });
        return;
      }
      const bytes = readFileSync(target);
      res.writeHead(200, {
        "content-type": type,
        "content-length": bytes.length,
        "cache-control": "private, max-age=60",
        "x-content-type-options": "nosniff",
      });
      res.end(bytes);
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
            : name.endsWith(".mp3")
              ? "audio/mpeg"
              : "image/jpeg";
      const bytes = readFileSync(file);
      res.writeHead(200, {
        "content-type": type,
        "content-length": bytes.length,
        "cache-control": "private, max-age=86400",
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

    if (path === "/cron" && method === "GET") {
      const room = requestUrl(req).searchParams.get("room") || "";
      json(res, 200, {
        jobs: store.listCronJobs(room || undefined).map(publicCronJob),
      });
      return;
    }
    if (path === "/cron" && method === "POST") {
      const body = asRecord(await readJson(req));
      const job = createCronJob(store, {
        roomId: str(body, "roomId") || str(body, "room_id"),
        botId: str(body, "botId") || str(body, "bot_id"),
        prompt: str(body, "prompt"),
        schedule: str(body, "schedule"),
        name: str(body, "name"),
        scope: str(body, "scope") === "bot" ? "bot" : "channel",
        delivery: str(body, "delivery") === "sheet" ? "sheet" : "hall",
      });
      json(res, 201, publicCronJob(job));
      return;
    }
    const cronAct = path.match(/^\/cron\/([^/]+)\/(pause|resume|run)$/);
    if (cronAct && method === "POST") {
      const id = decodeURIComponent(cronAct[1]);
      if (cronAct[2] === "pause") {
        json(res, 200, publicCronJob(pauseCronJob(store, id)));
        return;
      }
      if (cronAct[2] === "resume") {
        json(res, 200, publicCronJob(resumeCronJob(store, id)));
        return;
      }
      json(res, 200, await fireCronJob(store, id, env, {}, { force: true }));
      return;
    }
    const cronOne = path.match(/^\/cron\/([^/]+)$/);
    if (cronOne && method === "GET") {
      const id = decodeURIComponent(cronOne[1]);
      const job = store.getCronJob(id);
      const pub = publicCronJob(job);
      const sessionId =
        pub.delivery === "sheet"
          ? job.sessionRoomId || store.cronSessionRoomId(job.id)
          : "";
      json(res, 200, {
        ...pub,
        runs: store.listCronRuns(id).map(publicCronRun),
        messages: sessionId ? store.listMessages(sessionId) : [],
      });
      return;
    }
    if (cronOne && method === "PATCH") {
      const id = decodeURIComponent(cronOne[1]);
      const body = asRecord(await readJson(req));
      const job = updateCronJob(store, id, {
        name: str(body, "name") || undefined,
        prompt: str(body, "prompt") || undefined,
        schedule: str(body, "schedule") || undefined,
        delivery:
          str(body, "delivery") === "sheet"
            ? "sheet"
            : str(body, "delivery") === "hall"
              ? "hall"
              : undefined,
      });
      const pub = publicCronJob(job);
      const sessionId =
        pub.delivery === "sheet"
          ? job.sessionRoomId || store.cronSessionRoomId(job.id)
          : "";
      json(res, 200, {
        ...pub,
        runs: store.listCronRuns(id).map(publicCronRun),
        messages: sessionId ? store.listMessages(sessionId) : [],
      });
      return;
    }
    if (cronOne && method === "DELETE") {
      json(res, 200, removeCronJob(store, decodeURIComponent(cronOne[1])));
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
    const channelBranch = path.match(/^\/channels\/([^/]+)\/branches$/);
    if (channelBranch && method === "POST") {
      const body = asRecord(await readJson(req));
      json(
        res,
        201,
        createBranch(
          store,
          decodeURIComponent(channelBranch[1]),
          str(body, "messageId"),
          str(body, "name") || undefined,
        ),
      );
      return;
    }
    const channelClose = path.match(/^\/channels\/([^/]+)\/close$/);
    if (channelClose && method === "POST") {
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        await closeBranch(
          store,
          decodeURIComponent(channelClose[1]),
          body.merge === true,
          env,
        ),
      );
      return;
    }
    const channelOne = path.match(/^\/channels\/([^/]+)$/);
    if (channelOne && method === "DELETE") {
      json(res, 200, deleteChannel(store, decodeURIComponent(channelOne[1])));
      return;
    }
    if (channelOne && method === "PATCH") {
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        renameChannel(
          store,
          decodeURIComponent(channelOne[1]),
          str(body, "name"),
        ),
      );
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
          extrasWithMentions(extras, body),
        ),
      );
      return;
    }

    const retryDm = path.match(
      /^\/dms\/([^/]+)\/messages\/([^/]+)\/retry$/,
    );
    if (retryDm && method === "POST") {
      const room = resolveDm(store, retryDm[1]);
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
          extrasWithMentions(extras, body),
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
      const room = resolveDm(store, dmTraj[1]);
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
      const room = resolveDm(store, decodeURIComponent(dmLive[1]));
      json(res, 200, getLiveTurn(store, room.id));
      return;
    }

    const channelAbort = path.match(/^\/channels\/([^/]+)\/abort$/);
    if (channelAbort && method === "POST") {
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        abortLiveTurn(
          store,
          decodeURIComponent(channelAbort[1]),
          str(body, "botId") || undefined,
        ),
      );
      return;
    }
    const dmAbort = path.match(/^\/dms\/([^/]+)\/abort$/);
    if (dmAbort && method === "POST") {
      const room = resolveDm(store, decodeURIComponent(dmAbort[1]));
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        abortLiveTurn(store, room.id, str(body, "botId") || undefined),
      );
      return;
    }

    const channelPause = path.match(/^\/channels\/([^/]+)\/pause$/);
    if (channelPause && method === "POST") {
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        pauseLiveTurn(
          store,
          decodeURIComponent(channelPause[1]),
          str(body, "botId") || undefined,
        ),
      );
      return;
    }
    const dmPause = path.match(/^\/dms\/([^/]+)\/pause$/);
    if (dmPause && method === "POST") {
      const room = resolveDm(store, decodeURIComponent(dmPause[1]));
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        pauseLiveTurn(store, room.id, str(body, "botId") || undefined),
      );
      return;
    }

    const channelContinue = path.match(/^\/channels\/([^/]+)\/continue$/);
    if (channelContinue && method === "POST") {
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        await continueLiveTurn(
          store,
          decodeURIComponent(channelContinue[1]),
          str(body, "botId"),
          env,
          extras,
        ),
      );
      return;
    }
    const dmContinue = path.match(/^\/dms\/([^/]+)\/continue$/);
    if (dmContinue && method === "POST") {
      const room = resolveDm(store, decodeURIComponent(dmContinue[1]));
      const body = asRecord(await readJson(req));
      json(
        res,
        200,
        await continueLiveTurn(
          store,
          room.id,
          str(body, "botId"),
          env,
          extras,
        ),
      );
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
          str(body, "replyTo") || undefined,
          str(body, "botId") || undefined,
        ),
      );
      return;
    }
    const dmSteer = path.match(/^\/dms\/([^/]+)\/steer$/);
    if (dmSteer && method === "POST") {
      const room = resolveDm(store, decodeURIComponent(dmSteer[1]));
      const body = asRecord(await readJson(req));
      json(
        res,
        201,
        steerUserMessage(
          store,
          room.id,
          str(body, "body"),
          parseAttachments(body.attachments),
          str(body, "replyTo") || undefined,
          str(body, "botId") || undefined,
        ),
      );
      return;
    }

    const channelMessageOne = path.match(
      /^\/channels\/([^/]+)\/messages\/([^/]+)$/,
    );
    if (channelMessageOne && method === "DELETE") {
      json(
        res,
        200,
        deleteRoomMessage(
          store,
          decodeURIComponent(channelMessageOne[1]),
          decodeURIComponent(channelMessageOne[2]),
        ),
      );
      return;
    }

    const dmMessageOne = path.match(/^\/dms\/([^/]+)\/messages\/([^/]+)$/);
    if (dmMessageOne && method === "DELETE") {
      const room = resolveDm(store, decodeURIComponent(dmMessageOne[1]));
      json(
        res,
        200,
        deleteRoomMessage(store, room.id, decodeURIComponent(dmMessageOne[2])),
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
          extrasWithMentions(extras, body),
        ),
      );
      return;
    }

    const dmMessages = path.match(/^\/dms\/([^/]+)\/messages$/);
    if (dmMessages && method === "GET") {
      const room = resolveDm(store, dmMessages[1]);
      json(res, 200, listRoomMessages(store, room.id));
      return;
    }
    if (dmMessages && method === "POST") {
      const room = resolveDm(store, dmMessages[1]);
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
          extrasWithMentions(extras, body),
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

    if (method === "POST" && path === "/generate/skills") {
      const body = asRecord(await readJson(req));
      const picked = await pickBotSkills(store, {
        name: str(body, "name"),
        handle: str(body, "handle"),
        oneLiner: str(body, "oneLiner"),
        soul: str(body, "soul"),
        agent: str(body, "agent"),
        position: str(body, "position"),
        skills: skillPickCatalog(body),
      });
      json(res, 200, picked);
      return;
    }

    if (method === "GET" && path === "/settings/models") {
      await refreshCopilotCatalog(store.dataDir);
      await refreshOpenCodeFreeCatalog(store.dataDir);
      await refreshCommandCodeCatalog(store.dataDir, env).catch(() => {});
      await refreshReasoningCatalog().catch(() => {});
      json(res, 200, modelsPayload(store.dataDir, extras, env));
      return;
    }
    if (method === "POST" && path === "/settings/models/opencode-free/sync") {
      const refreshed = await refreshOpenCodeFreeCatalog(store.dataDir, true);
      json(res, 200, {
        ...modelsPayload(store.dataDir, extras, env),
        probe: refreshed.probe ?? [],
      });
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
      json(res, 200, modelsPayload(store.dataDir, extras, env));
      return;
    }

    if (method === "GET" && path === "/settings/oauth") {
      if (extras.oauth === false) {
        json(res, 200, { subscriptions: [] });
        return;
      }
      await refreshCopilotCatalog(store.dataDir);
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

    if (method === "GET" && path === "/settings/web") {
      if (freebuffHttpDisabled(extras, env)) {
        json(res, 200, { bridges: [] });
        return;
      }
      json(res, 200, { bridges: [freebuffWebStatus(store.dataDir)] });
      return;
    }
    if (method === "POST" && path === "/settings/web/freebuff-chat/login") {
      if (freebuffHttpDisabled(extras, env)) {
        json(res, 503, { error: "freebuff_disabled" });
        return;
      }
      json(res, 200, await startFreebuffLogin(store.dataDir));
      return;
    }
    if (method === "POST" && path === "/settings/web/freebuff-chat/poll") {
      if (freebuffHttpDisabled(extras, env)) {
        json(res, 503, { error: "freebuff_disabled" });
        return;
      }
      json(res, 200, await pollFreebuffLogin(store.dataDir));
      return;
    }
    if (method === "POST" && path === "/settings/web/freebuff-chat/logout") {
      if (freebuffHttpDisabled(extras, env)) {
        json(res, 503, { error: "freebuff_disabled" });
        return;
      }
      json(res, 200, await logoutFreebuff(store.dataDir));
      return;
    }
    if (method === "POST" && path === "/settings/web/freebuff-chat/doctor") {
      if (freebuffHttpDisabled(extras, env)) {
        json(res, 503, { error: "freebuff_disabled" });
        return;
      }
      json(res, 200, await doctorFreebuff(store.dataDir));
      return;
    }

    if (method === "GET" && path === "/settings/commandcode") {
      json(res, 200, pollCommandCodeLogin(store.dataDir));
      return;
    }
    if (method === "POST" && path === "/settings/commandcode/login") {
      json(res, 200, await startCommandCodeLogin(store.dataDir));
      return;
    }
    if (method === "POST" && path === "/settings/commandcode/poll") {
      json(res, 200, pollCommandCodeLogin(store.dataDir));
      return;
    }
    if (method === "POST" && path === "/settings/commandcode/logout") {
      cancelCommandCodeLogin(store.dataDir);
      clearCommandCodeState(store.dataDir);
      json(res, 200, commandCodeStatus(store.dataDir, env));
      return;
    }
    if (method === "POST" && path === "/settings/commandcode/key") {
      const body = asRecord(await readJson(req));
      const status = await saveCommandCodeApiKey(store.dataDir, str(body, "apiKey"));
      await refreshCommandCodeCatalog(store.dataDir, env, true).catch(() => {});
      json(res, 200, { ...status, models: commandCodeStatus(store.dataDir, env).models });
      return;
    }
    if (method === "PATCH" && path === "/settings/shown") {
      const body = asRecord(await readJson(req));
      const id = str(body, "id");
      if (!id) {
        json(res, 400, { error: "id required" });
        return;
      }
      const raw = body.shownIds;
      const shownIds = raw == null
        ? null
        : Array.isArray(raw)
          ? raw
              .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
              .map((item) => item.trim())
          : undefined;
      if (shownIds === undefined) {
        json(res, 400, { error: "shownIds required" });
        return;
      }
      setShownModels(store.dataDir, id, shownIds);
      json(res, 200, modelsPayload(store.dataDir, extras, env));
      return;
    }
    if (method === "POST" && path === "/settings/commandcode/sync") {
      const models = await refreshCommandCodeCatalog(store.dataDir, env, true);
      json(res, 200, {
        ...modelsPayload(store.dataDir, extras, env),
        synced: models.length,
      });
      return;
    }

    const lookId = path.match(/^\/bots\/([^/]+)\/look$/)?.[1];
    if (lookId && method === "POST") {
      json(res, 200, await generateBotLook(store, decodeURIComponent(lookId), env));
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
        ...(Object.hasOwn(body, "portrait")
          ? { portrait: body.portrait == null ? null : str(body, "portrait") }
          : {}),
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
    console.error(error);
    json(res, 500, { error: "internal_error" });
  }
}
