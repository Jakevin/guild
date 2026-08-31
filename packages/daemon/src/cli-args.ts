export type GuildCli = {
  help: boolean;
  version: boolean;
  open: boolean;
  port?: number;
  error?: string;
};

const HELP = `npx @kevin5251984/guild web [--port 7420] [--no-open]

Start the hall (same shape as \`npx @deepseek-ai/dsh web\`).
Listens on http://127.0.0.1:7420 unless GUILD_PORT / --port says otherwise.

  web, hall          start the hall (default)
  -p, --port <n>     listen port
  --no-open          do not open a browser
  -h, --help         this text
  -v, --version      print version
`;

export function guildCliHelp(): string {
  return HELP;
}

export function parseGuildCli(argv: string[]): GuildCli {
  const args = argv.slice(2);
  const out: GuildCli = { help: false, version: false, open: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "web" || arg === "hall") continue;
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      out.version = true;
      continue;
    }
    if (arg === "--no-open") {
      out.open = false;
      continue;
    }
    if (arg === "-p" || arg === "--port") {
      const raw = args[++i];
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        out.error = `invalid --port: ${raw ?? "(missing)"}`;
        return out;
      }
      out.port = port;
      continue;
    }
    if (arg.startsWith("--port=")) {
      const raw = arg.slice("--port=".length);
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        out.error = `invalid --port: ${raw}`;
        return out;
      }
      out.port = port;
      continue;
    }
    out.error = `unknown argument: ${arg}`;
    return out;
  }
  return out;
}

export function shouldOpenBrowser(open: boolean, env: NodeJS.ProcessEnv): boolean {
  if (!open) return false;
  if (env.GUILD_NO_OPEN === "1" || env.GUILD_NO_OPEN === "true") return false;
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}
