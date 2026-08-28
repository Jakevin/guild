import { Service, type Context } from "cordis";
import { chatReply, type ChatReply } from "../generate.ts";
import { guildEnvOf } from "../start.ts";
import {
  policyFor,
  runAgentLoop,
  type HarnessPolicy,
  type Sandbox,
} from "../harness.ts";
import type { ToolContext, ToolOutcome } from "../tools.ts";

export type HarnessConfig = {
  sandbox?: Sandbox;
  workspace?: string;
};

export class HarnessService extends Service {
  static inject = ["store", "tools"];
  private readonly config: HarnessConfig;

  constructor(ctx: Context, config: HarnessConfig = {}) {
    super(ctx, "harness");
    this.config = config;
  }

  policy(position?: string): HarnessPolicy {
    return policyFor(guildEnvOf(this.ctx), {
      sandbox: this.config.sandbox,
      workspace: this.config.workspace,
      position,
    });
  }

  sandbox(position?: string): Sandbox {
    return this.policy(position).sandbox;
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
    const policy = policyFor(guildEnvOf(this.ctx), {
      sandbox: input.sandbox ?? this.config.sandbox,
      workspace: input.workspace ?? this.config.workspace,
      position: input.position,
    });
    const mcp = this.ctx.get("mcp");
    const mcpTools =
      input.mcpTools !== undefined
        ? input.mcpTools
        : mcp
          ? await mcp.toolRefs()
          : [];
    return chatReply({
      ...input,
      sandbox: policy.sandbox,
      workspace: policy.workspace,
      mcpTools,
      dispatch: (name, args, toolCtx) => this.dispatch(name, args, toolCtx),
    });
  }
}

export default HarnessService;
