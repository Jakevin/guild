import { Service, type Context } from "cordis";
import { runMainTool, type MainToolResult } from "../main-bot.ts";
import type { GuildStore } from "../store.ts";

const NAMES = ["create_bot", "create_channel", "assign"] as const;

export async function callMainTool(
  store: GuildStore,
  name: string,
  args: Record<string, unknown>,
  main: boolean | undefined,
): Promise<MainToolResult> {
  if (!main) return { text: "only the guild master can do that", isError: true };
  return runMainTool(store, name, args);
}

export class MainBotService extends Service {
  static inject = ["store", "tools"];

  constructor(ctx: Context) {
    super(ctx, "mainBot");
    for (const name of NAMES) {
      ctx.tools.register(name, (args, toolCtx) =>
        callMainTool(this.ctx.store.guild, name, args, toolCtx.main),
      );
    }
  }
}

export default MainBotService;
