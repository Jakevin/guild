import type { StoreService } from "./plugins/store.ts";
import type { OAuthService } from "./plugins/oauth.ts";
import type { LlmService } from "./plugins/llm.ts";
import type { ToolsService } from "./plugins/tools.ts";
import type { McpService } from "./plugins/mcp.ts";
import type { ChatService } from "./plugins/chat.ts";
import type { MemoryService } from "./plugins/memory.ts";
import type { ServerService } from "./plugins/server.ts";

declare module "cordis" {
  interface Context {
    guildEnv: NodeJS.ProcessEnv;
    store: StoreService;
    oauth: OAuthService;
    llm: LlmService;
    tools: ToolsService;
    mcp: McpService;
    chat: ChatService;
    memory: MemoryService;
    server: ServerService;
  }

  interface Events {
    "guild/listening"(info: {
      host: string;
      port: number;
      dataDir: string;
    }): void;
    "guild/turn-complete"(turn: {
      roomId: string;
      botId: string;
      userText: string;
      reply: string;
    }): void;
  }
}

export {};
