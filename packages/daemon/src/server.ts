import http from "node:http";
import { handleRequest } from "./router.ts";
import { defaultDataDir, GuildStore } from "./store.ts";

export type GuildServerOptions = {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
};

/** The Guild HTTP server used by the CLI and tests. */
export function createGuildServer(
  options: GuildServerOptions = {},
): http.Server {
  const store = new GuildStore(options.dataDir ?? defaultDataDir());
  return http.createServer((req, res) => {
    void handleRequest(req, res, store, options.env);
  });
}

export function listenGuildServer(
  server: http.Server,
  host: string,
  port: number,
): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("guildd failed to bind a TCP port"));
        return;
      }
      resolve({ host: address.address, port: address.port });
    });
  });
}
