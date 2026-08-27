import type { Server } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Context } from "cordis";
import Loader from "@cordisjs/plugin-loader";
import Include from "@cordisjs/plugin-include";
import { DEFAULT_GUILD_PORT } from "@guild/protocol";

Include.prototype.write = function write() {};

const DAEMON_DIR = fileURLToPath(new URL("..", import.meta.url));
const LISTEN_TIMEOUT_MS = 10_000;

export type CreateGuildContextOptions = {
  configPath?: string;
  patches?: Array<{
    id: string;
    disabled?: boolean | null;
    config?: unknown;
  }>;
};

export type StartedDaemon = {
  server: Server;
  ctx: Context;
};

const guildEnvs = new WeakMap<Context, NodeJS.ProcessEnv>();

export function guildEnvOf(ctx: Context): NodeJS.ProcessEnv {
  return guildEnvs.get(ctx.root) ?? process.env;
}

function parsePort(env: NodeJS.ProcessEnv): number {
  const raw = env.GUILD_PORT ?? String(DEFAULT_GUILD_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid GUILD_PORT: ${env.GUILD_PORT}`);
  }
  return port;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createGuildContext(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateGuildContextOptions = {},
): Promise<Context> {
  parsePort(env);
  const ctx = new Context();
  guildEnvs.set(ctx, env);
  let baseUrl = pathToFileURL(DAEMON_DIR).href;
  if (!baseUrl.endsWith("/")) baseUrl += "/";
  ctx.baseUrl = baseUrl;

  await ctx.plugin(Loader, { baseUrl });
  await ctx.loader.create({
    name: "@cordisjs/plugin-include",
    config: {
      path: options.configPath ?? "./cordis.yml",
      patches: options.patches ?? [],
    },
  });
  await ctx.loader.await();

  const deadline = Date.now() + LISTEN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const server = ctx.get("server");
    if (server) {
      const remaining = Math.max(deadline - Date.now(), 0);
      const result = await Promise.race([
        server.whenListening().then((info) => ({ ok: true as const, info })),
        sleep(remaining).then(() => ({ ok: false as const })),
      ]);
      if (!result.ok) throw new Error("guildd did not listen");
      return ctx;
    }
    await sleep(50);
  }
  throw new Error("guildd did not listen");
}

export async function startGuildDaemon(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StartedDaemon> {
  const ctx = await createGuildContext(env);
  const line = JSON.stringify({
    listening: true,
    host: ctx.server.host,
    port: ctx.server.port,
    service: "guildd",
    status: "ok",
    ready: true,
    dataDir: ctx.store.dataDir,
  });
  process.stdout.write(`${line}\n`);
  return { server: ctx.server.node, ctx };
}
