import { Service, type Context } from "cordis";
import { defaultDataDir, GuildStore } from "../store.ts";
import { guildEnvOf } from "../start.ts";

export type StoreConfig = {
  dataDir?: string;
};

export class StoreService extends Service {
  readonly guild: GuildStore;
  readonly env: NodeJS.ProcessEnv;

  constructor(ctx: Context, config: StoreConfig = {}) {
    super(ctx, "store");
    this.env = guildEnvOf(ctx);
    const dataDir =
      this.env.GUILD_HOME ?? config.dataDir ?? defaultDataDir(this.env);
    this.guild = new GuildStore(dataDir);
  }

  get dataDir(): string {
    return this.guild.dataDir;
  }
}

export default StoreService;
