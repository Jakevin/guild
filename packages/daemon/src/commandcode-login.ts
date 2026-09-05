/**
 * Official Command Code `cmd login` loopback.
 * Copied from dsh-commandcode-provider/login.ts (MIT): bind 127.0.0.1 from
 * 5959, Studio POSTs { apiKey, state, userId, userName, keyName } to /callback.
 */
import { randomBytes } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  buildCommandCodeAuthUrl,
  COMMANDCODE_STUDIO_BASE,
  commandCodeStatus,
  saveCommandCodeApiKey,
  type CommandCodeStatus,
} from "./commandcode.ts";
import { StoreError } from "./store.ts";

export const LOGIN_TIMEOUT_MS = 120_000;
export const LOGIN_START_PORT = 5959;
export const LOGIN_MAX_PORT_ATTEMPTS = 10;
export const LOGIN_BODY_LIMIT_BYTES = 10_000;
export const LOGIN_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:3000",
  "https://staging.commandcode.ai",
  "https://commandcode.ai",
];

type PendingLogin = {
  dataDir: string;
  state: string;
  loginUrl: string;
  server: Server;
  timer?: ReturnType<typeof setTimeout>;
  done: Promise<CommandCodeStatus>;
};

const pending = new Map<string, PendingLogin>();

export type CommandCodeLoginStart = CommandCodeStatus & {
  loginUrl: string;
};

export type CommandCodeLoginDeps = {
  fetchImpl?: typeof fetch;
  startPort?: number;
  timeoutMs?: number;
  apiBase?: string;
  studioBase?: string;
  randomToken?: () => string;
};

function cors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin || "";
  if (LOGIN_ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  const requested = req.headers["access-control-request-headers"];
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    typeof requested === "string" && requested.length > 0 ? requested : "Content-Type",
  );
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("content-type", "application/json");
}

function listenOnPort(server: Server, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let offset = 0;
    const tryListen = () => {
      const fallback = startPort === 0 || offset >= LOGIN_MAX_PORT_ATTEMPTS;
      const port = fallback ? 0 : startPort + offset;
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE" && !fallback) {
          offset += 1;
          tryListen();
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve((server.address() as AddressInfo).port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };
    tryListen();
  });
}

function closeServer(server: Server): void {
  server.close(() => {});
}

function finishPending(dataDir: string): void {
  const cur = pending.get(dataDir);
  if (!cur) return;
  if (cur.timer) clearTimeout(cur.timer);
  closeServer(cur.server);
  pending.delete(dataDir);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
      if (body.length > LOGIN_BODY_LIMIT_BYTES) req.destroy();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function startCommandCodeLogin(
  dataDir: string,
  deps: CommandCodeLoginDeps = {},
): Promise<CommandCodeLoginStart> {
  const existing = pending.get(dataDir);
  if (existing) {
    return { ...commandCodeStatus(dataDir, process.env, { pending: true }), loginUrl: existing.loginUrl };
  }
  const state = deps.randomToken?.() ?? randomBytes(32).toString("base64url");
  let resolveDone!: (status: CommandCodeStatus) => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<CommandCodeStatus>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});

  const server = createHttpServer((req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = req.url || "";
    if (url.split("?")[0] !== "/callback") {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: "Not found" }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ success: false, error: "Method not allowed. Use POST." }));
      return;
    }
    void (async () => {
      try {
        const parsed = JSON.parse(await readBody(req)) as Record<string, unknown>;
        if (parsed.error) {
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
          const description =
            typeof parsed.error_description === "string"
              ? parsed.error_description
              : String(parsed.error);
          rejectDone(new Error(description || String(parsed.error)));
          finishPending(dataDir);
          return;
        }
        const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
        const gotState = typeof parsed.state === "string" ? parsed.state : "";
        const userId = typeof parsed.userId === "string" ? parsed.userId : "";
        const userName = typeof parsed.userName === "string" ? parsed.userName : "";
        const keyName = typeof parsed.keyName === "string" ? parsed.keyName : "";
        if (!apiKey || !gotState || !userId || !userName || !keyName) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: "Missing required fields" }));
          return;
        }
        if (gotState !== state) {
          res.writeHead(403);
          res.end(JSON.stringify({ success: false, error: "Invalid state token" }));
          return;
        }
        const status = await saveCommandCodeApiKey(dataDir, apiKey, {
          userName,
          keyName,
          fetchImpl: deps.fetchImpl,
        });
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        resolveDone(status);
        finishPending(dataDir);
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: "Invalid JSON" }));
        rejectDone(error instanceof Error ? error : new Error(String(error)));
        finishPending(dataDir);
      }
    })();
  });

  const port = await listenOnPort(server, deps.startPort ?? LOGIN_START_PORT);
  const callback = `http://localhost:${port}/callback`;
  const loginUrl = buildCommandCodeAuthUrl({
    studioBase: deps.studioBase ?? COMMANDCODE_STUDIO_BASE,
    callback,
    state,
  });
  const timeoutMs = deps.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const timer = setTimeout(() => {
    const cur = pending.get(dataDir);
    if (!cur || cur.state !== state) return;
    finishPending(dataDir);
    rejectDone(new Error("Browser authentication timed out"));
  }, timeoutMs);
  pending.set(dataDir, { dataDir, state, loginUrl, server, timer, done });
  return { ...commandCodeStatus(dataDir, process.env, { pending: true, loginUrl }), loginUrl };
}

export function pollCommandCodeLogin(dataDir: string): CommandCodeStatus {
  const cur = pending.get(dataDir);
  if (cur) return { ...commandCodeStatus(dataDir, process.env, { pending: true, loginUrl: cur.loginUrl }) };
  return commandCodeStatus(dataDir);
}

export async function waitCommandCodeLogin(dataDir: string): Promise<CommandCodeStatus> {
  const cur = pending.get(dataDir);
  if (!cur) return commandCodeStatus(dataDir);
  try {
    return await cur.done;
  } catch (error) {
    throw new StoreError(400, error instanceof Error ? error.message : String(error));
  }
}

export function cancelCommandCodeLogin(dataDir: string): CommandCodeStatus {
  finishPending(dataDir);
  return commandCodeStatus(dataDir);
}
