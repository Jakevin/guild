import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGuildContext,
  type CreateGuildContextOptions,
} from "../src/start.ts";

export function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "guild-home-"));
}

export async function listen(
  dataDir: string,
  env?: NodeJS.ProcessEnv,
  options?: CreateGuildContextOptions,
) {
  const base = {
    ...(env ?? process.env),
    GUILD_HOME: dataDir,
    GUILD_HOST: "127.0.0.1",
    GUILD_PORT: "0",
  };
  if (!base.GUILD_FREE_SCAN) base.GUILD_FREE_SCAN = "0";
  const ctx = await createGuildContext(base, options);
  return {
    ctx,
    server: ctx.server.node,
    origin: `http://127.0.0.1:${ctx.server.port}`,
  };
}

export async function closeServer(server: {
  close: (cb: (err?: Error) => void) => void;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

export async function closeApp(app: {
  ctx: { fiber: { dispose: () => Promise<void> } };
}): Promise<void> {
  await app.ctx.fiber.dispose();
}
