import type { Context } from "cordis";

function apply(ctx: Context) {
  void ctx.server.listen();
}
Object.assign(apply, { inject: ["server", "store", "chat", "llm", "harness"] });

export default apply;
