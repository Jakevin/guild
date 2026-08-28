import { Service, type Context } from "cordis";
import {
  callMcpTool,
  importHostMcp,
  listGuildMcp,
  listHostMcp,
  listMcpToolRefs,
  removeGuildMcp,
  upsertGuildMcp,
  type McpLaunch,
} from "../mcp.ts";

export class McpService extends Service {
  static inject = ["store", "tools"];

  constructor(ctx: Context) {
    super(ctx, "mcp");
    ctx.tools.registerPrefix("mcp__", (name, args, toolCtx) => {
      const dataDir = toolCtx.dataDir ?? this.dataDir;
      if (!dataDir) return { text: "mcp needs a dataDir", isError: true };
      return callMcpTool(dataDir, name, args, toolCtx.mcpTools ?? []);
    });
  }

  get dataDir(): string {
    return this.ctx.store.dataDir;
  }

  list() {
    return listGuildMcp(this.dataDir);
  }

  listHost() {
    return listHostMcp();
  }

  upsert(name: string, launch: McpLaunch) {
    return upsertGuildMcp(this.dataDir, name, launch);
  }

  importHost(hostId: string) {
    return importHostMcp(this.dataDir, hostId);
  }

  remove(name: string) {
    return removeGuildMcp(this.dataDir, name);
  }

  toolRefs() {
    return listMcpToolRefs(this.dataDir);
  }

  call(name: string, args: Record<string, unknown>) {
    return callMcpTool(this.dataDir, name, args);
  }
}

export default McpService;
