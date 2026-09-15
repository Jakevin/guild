import { Service, type Context } from "cordis";
import { CRON_TICK_MS } from "../cron-schedule.ts";
import { executeCronjob, tickCronJobs } from "../cron.ts";
import { compactIdleRooms } from "../idle-compact.ts";
import { guildEnvOf } from "../start.ts";

export class CronService extends Service {
  static inject = ["store", "tools"];

  constructor(ctx: Context) {
    super(ctx, "cron");
    ctx.tools.register("cronjob", (args, toolCtx) =>
      executeCronjob(this.ctx.store.guild, args, toolCtx),
    );
    const tick = () => {
      const store = this.ctx.store.guild;
      const env = guildEnvOf(this.ctx);
      void tickCronJobs(store, env);
      void compactIdleRooms(store, env).catch(() => {});
    };
    const interval = setInterval(tick, CRON_TICK_MS);
    interval.unref();
    ctx.effect(() => () => clearInterval(interval));
    const boot = setTimeout(tick, 1500);
    boot.unref();
    ctx.effect(() => () => clearTimeout(boot));
  }
}

export default CronService;
