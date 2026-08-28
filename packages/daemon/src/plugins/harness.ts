import { Service, type Context } from "cordis";
import { chatReply, type ChatReply } from "../generate.ts";
import { guildEnvOf } from "../start.ts";
import {
  policyFromEnv,
  runAgentLoop,
  type HarnessPolicy,
  type Sandbox,
} from "../harness.ts";
import type { ToolContext, ToolOutcome } from "../tools.ts";

export class HarnessService extends Service {
  static inject = ["store", "tools"];

  constructor(ctx: Context) {
    super(ctx, "harness");
  }

  policy(): HarnessPolicy {
    return policyFromEnv(guildEnvOf(this.ctx), this.ctx.store.dataDir);
  }

  sandbox(): Sandbox {
    return this.policy().sandbox;
  }

  workspace(): string {
    return this.policy().workspace;
  }

  dispatch(
    name: string,
    args: Record<string, unknown>,
    toolCtx: ToolContext,
  ): Promise<ToolOutcome> {
    return this.ctx.tools.execute(name, args, toolCtx);
  }

  loop = runAgentLoop;

  async turn(
    input: Parameters<typeof chatReply>[0],
  ): Promise<ChatReply> {
    const policy = this.policy();
    const mcp = this.ctx.get("mcp");
    const mcpTools =
      input.mcpTools !== undefined
        ? input.mcpTools
        : mcp
          ? await mcp.toolRefs()
          : [];
    return chatReply({
      ...input,
      sandbox: input.sandbox ?? policy.sandbox,
      workspace: input.workspace ?? policy.workspace,
      mcpTools,
      dispatch: (name, args, toolCtx) => this.dispatch(name, args, toolCtx),
    });
  }
}

export default HarnessService;
