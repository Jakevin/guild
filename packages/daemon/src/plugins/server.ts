import http from "node:http";
import { Service, type Context } from "cordis";
import {
  DEFAULT_GUILD_HOST,
  DEFAULT_GUILD_PORT,
} from "@guild/protocol";
import { handleRequest } from "../router.ts";
import { guildEnvOf } from "../start.ts";

export type ServerConfig = {
  host?: string;
  port?: number;
};

export type ListeningInfo = {
  host: string;
  port: number;
  dataDir: string;
};

export class ServerService extends Service {
  static inject = ["store"];
  readonly node: http.Server;
  host = "";
  port = 0;
  private readonly config: ServerConfig;
  private readonly listening: Promise<ListeningInfo>;
  private resolveListening!: (info: ListeningInfo) => void;
  private rejectListening!: (error: Error) => void;
  private started = false;

  constructor(ctx: Context, config: ServerConfig = {}) {
    super(ctx, "server");
    this.config = config;
    this.listening = new Promise<ListeningInfo>((resolve, reject) => {
      this.resolveListening = resolve;
      this.rejectListening = reject;
    });
    void this.listening.catch(() => {});

    const env = () => guildEnvOf(ctx);
    this.node = http.createServer((req, res) => {
      const store = ctx.store.guild;
      void handleRequest(req, res, store, env(), {
        mcp: Boolean(ctx.get("mcp")),
        oauth: Boolean(ctx.get("oauth")),
        harvest: false,
        onTurnComplete: (turn) => {
          ctx.emit("guild/turn-complete", turn);
        },
      });
    });
    ctx.effect(() => {
      return () =>
        new Promise<void>((resolve) => {
          this.rejectListening(new Error("disposed"));
          if (!this.node.listening) {
            resolve();
            return;
          }
          this.node.close(() => resolve());
        });
    });
  }

  whenListening(): Promise<ListeningInfo> {
    return this.listening;
  }

  listen(): Promise<ListeningInfo> {
    if (this.started) return this.listening;
    this.started = true;
    const env = guildEnvOf(this.ctx);
    const host = env.GUILD_HOST ?? this.config.host ?? DEFAULT_GUILD_HOST;
    const rawPort = env.GUILD_PORT ?? this.config.port ?? DEFAULT_GUILD_PORT;
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      const error = new Error(`invalid GUILD_PORT: ${env.GUILD_PORT}`);
      this.rejectListening(error);
      throw error;
    }
    this.node.once("error", (error) => {
      this.rejectListening(error);
    });
    const dataDir = this.ctx.store.dataDir;
    this.node.listen(port, host, () => {
      const address = this.node.address();
      if (address === null || typeof address === "string") {
        this.rejectListening(new Error("guildd failed to bind a TCP port"));
        return;
      }
      this.host = address.address;
      this.port = address.port;
      const info: ListeningInfo = {
        host: this.host,
        port: this.port,
        dataDir,
      };
      this.ctx.emit("guild/listening", info);
      this.resolveListening(info);
    });
    return this.listening;
  }
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

export default ServerService;
