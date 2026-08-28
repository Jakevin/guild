import { Service, type Context } from "cordis";
import { gateTool } from "../harness.ts";
import {
  builtinExecute,
  BUILTIN_TOOL_NAMES,
  type ToolContext,
  type ToolOutcome,
} from "../tools.ts";

export type NamedToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolOutcome> | ToolOutcome;

export type PrefixToolHandler = (
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolOutcome> | ToolOutcome;

export class ToolsService extends Service {
  static inject = ["store"];
  private readonly named = new Map<string, NamedToolHandler>();
  private readonly prefixes = new Map<string, PrefixToolHandler>();

  constructor(ctx: Context) {
    super(ctx, "tools");
    for (const name of BUILTIN_TOOL_NAMES) {
      this.register(name, (args, toolCtx) => builtinExecute(name, args, toolCtx));
    }
  }

  has(name: string): boolean {
    if (this.named.has(name)) return true;
    for (const prefix of this.prefixes.keys()) {
      if (name.startsWith(prefix)) return true;
    }
    return false;
  }

  register(name: string, handler: NamedToolHandler): () => void {
    this.named.set(name, handler);
    const undo = () => {
      if (this.named.get(name) === handler) this.named.delete(name);
    };
    this.ctx.effect(() => undo);
    return undo;
  }

  registerPrefix(prefix: string, handler: PrefixToolHandler): () => void {
    this.prefixes.set(prefix, handler);
    const undo = () => {
      if (this.prefixes.get(prefix) === handler) this.prefixes.delete(prefix);
    };
    this.ctx.effect(() => undo);
    return undo;
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    toolCtx: ToolContext = {},
  ): Promise<ToolOutcome> {
    const refused = gateTool(name, args, toolCtx);
    if (refused) return refused;
    const named = this.named.get(name);
    if (named) return named(args, toolCtx);
    for (const [prefix, handler] of this.prefixes) {
      if (name.startsWith(prefix)) return handler(name, args, toolCtx);
    }
    return { text: `unknown tool: ${name}`, isError: true };
  }
}

export default ToolsService;
