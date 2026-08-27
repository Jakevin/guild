import { Service, type Context } from "cordis";
import { executeToolTraced, type ToolContext } from "../tools.ts";

export class ToolsService extends Service {
  static inject = ["store"];

  constructor(ctx: Context) {
    super(ctx, "tools");
  }

  execute(
    name: string,
    args: Record<string, unknown>,
    toolCtx: ToolContext,
  ) {
    return executeToolTraced(name, args, toolCtx);
  }
}

export default ToolsService;
