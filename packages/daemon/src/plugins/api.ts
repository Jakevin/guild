import type { Context } from "cordis";

function apply(ctx: Context) {
  void ctx.server.listen();
}
Object.assign(apply, { inject: ["server", "store", "chat", "llm"] });

export default apply;
