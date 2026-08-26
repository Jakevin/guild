import type { Server } from "node:http";
import { DEFAULT_GUILD_HOST, DEFAULT_GUILD_PORT } from "@guild/protocol";
import { createGuildServer, listenGuildServer } from "./server.ts";
import { defaultDataDir } from "./store.ts";

export async function startGuildDaemon(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Server> {
  const host = env.GUILD_HOST ?? DEFAULT_GUILD_HOST;
  const port = Number(env.GUILD_PORT ?? DEFAULT_GUILD_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid GUILD_PORT: ${env.GUILD_PORT}`);
  }

  const dataDir = defaultDataDir(env);
  const server = createGuildServer({ dataDir });
  const bound = await listenGuildServer(server, host, port);
  const line = JSON.stringify({
    listening: true,
    host: bound.host,
    port: bound.port,
    service: "guildd",
    status: "ok",
    ready: true,
    dataDir,
  });
  process.stdout.write(`${line}\n`);
  return server;
}
