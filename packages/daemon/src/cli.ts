import { execFile } from "node:child_process";
import { startGuildDaemon } from "./start.ts";
import {
  guildCliHelp,
  parseGuildCli,
  shouldOpenBrowser,
} from "./cli-args.ts";
import { guildVersion } from "./version.ts";

const opts = parseGuildCli(process.argv);
if (opts.error) {
  console.error(opts.error);
  process.stderr.write(guildCliHelp());
  process.exitCode = 2;
} else if (opts.help) {
  process.stdout.write(guildCliHelp());
} else if (opts.version) {
  process.stdout.write(`${guildVersion()}\n`);
} else {
  if (opts.port !== undefined) process.env.GUILD_PORT = String(opts.port);
  const started = startGuildDaemon();
  started
    .then(({ ctx }) => {
      const url = `http://${ctx.server.host}:${ctx.server.port}`;
      process.stdout.write(`guildd web: ${url}\n`);
      if (shouldOpenBrowser(opts.open, process.env)) openUrl(url);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });

  async function shutdown() {
    try {
      const { ctx } = await started;
      await ctx.fiber.dispose();
    } finally {
      process.exit(0);
    }
  }

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

function openUrl(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = execFile(cmd, args, () => {});
  child.unref();
}
