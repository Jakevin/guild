import { Service, type Context } from "cordis";
import { closeFreebuffBrowser } from "../freebuff-bridge.ts";

export class FreebuffService extends Service {
  static inject = ["store"];

  constructor(ctx: Context) {
    super(ctx, "freebuff");
    ctx.effect(() => () => {
      void closeFreebuffBrowser();
    });
  }

  get dataDir(): string {
    return this.ctx.store.dataDir;
  }
}

export default FreebuffService;
