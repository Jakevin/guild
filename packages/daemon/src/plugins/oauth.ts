import { Service, type Context } from "cordis";
import {
  completeLogin,
  listSubscriptions,
  logoutOAuth,
  pollLogin,
  startLogin,
  storedAccessToken,
} from "../oauth.ts";

export class OAuthService extends Service {
  static inject = ["store"];

  constructor(ctx: Context) {
    super(ctx, "oauth");
  }

  get dataDir(): string {
    return this.ctx.store.dataDir;
  }

  list() {
    return listSubscriptions(this.dataDir);
  }

  start(id: string) {
    return startLogin(this.dataDir, id);
  }

  poll(id: string) {
    return pollLogin(this.dataDir, id);
  }

  complete(id: string, input: { code?: string; url?: string }) {
    return completeLogin(this.dataDir, id, input);
  }

  logout(id: string) {
    return logoutOAuth(this.dataDir, id);
  }

  token(id: string) {
    return storedAccessToken(this.dataDir, id);
  }
}

export default OAuthService;
