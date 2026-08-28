# Security

**Default sandbox is `full_access`: `run` / `write` use your user shell.** Treat Guild as a workshop / experiment, not as something you point at untrusted prompts, untrusted repos, or a machine you cannot afford to lose files on.

## What ships today

Guild bots can call local tools. The process is `guildd` running as **you**.

| Tool | What it actually does |
|---|---|
| `run` | `execFile($SHELL, ["-lc", command])`. Default cwd is `$HOME`. Timeout 45s. |
| `write` | Writes any path the process can write. Creates parent folders. |
| `read` / `list` | Read any path the process can read. |
| `skill` / `spawn` / `image_gen` | In-process. `spawn` cannot nest. Read-only subagents cannot `write`. |
| `browser` | Local Chrome/Chromium/Edge/Brave over CDP. Default: throwaway profile (no logins). `GUILD_BROWSER_REAL_PROFILE=1` snapshots the **active** Chrome profile (`Local State` → `last_used`) into `{GUILD_HOME}/browser-profile/chrome/` (cookies/logins via sqlite backup; dir mode `0700`) and drives **that copy**. Never opens the live profile (Chrome 136+). Off by default; turning it off deletes the snapshot. Windows: Chrome must be fully quit or the cookie DB is locked. |
| MCP (`mcp__server__tool`) | `guildd` spawns a **stdio child as you**. Sources: `{GUILD_HOME}/mcp.json` **and** host Claude / Cursor / Codex configs (`~/.claude.json`, `~/.cursor/mcp.json`, `~/.codex/config.toml`). Same-name `mcp.json` wins; leftover host row is skipped. **No import / consent prompt** — host servers are live as soon as `guildd` lists tools. Env is inherited, then overlayed with that server's `env`. Timeout 5 minutes. Caps: 40 tools per server, 80 total. |

The only hard refusals in `run` are a narrow `rm -rf /` pattern and `mkfs`. That is not an OS jail.

MCP blast radius is larger than a skill: it is another process with your uid, your env, and whatever the server binary does. **Host MCP is live without importing** — anything already wired for Claude / Cursor / Codex is spawned on bot turns. To keep a host server out of Guild, remove it from the host file. Setting `id: mcp` to `disabled: true` in `packages/daemon/cordis.yml` unloads Guild MCP entirely (`GET /mcp/servers` is empty; mutating routes 503), including `mcp.json`. It does **not** sandbox `run` / `write`.

### Optional sandbox (`GUILD_SANDBOX`)

Names match Codex: `read_only` | `workspace_write` | `full_access`. Unset = `full_access`, unless the bot's POSITION.md has a `sandbox:` line (`GUILD_SANDBOX` still wins).

| Mode | `run` / `write` | MCP / `image_gen` |
|---|---|---|
| `full_access` (default) | Any path the process can touch. `run` cwd defaults to `$HOME`. | Allowed |
| `workspace_write` | Only inside `GUILD_WORKSPACE` (else the Guild checkout). Relative paths resolve there. | Refused (child is unsandboxed) |
| `read_only` | Refused | Refused |

This is a Guild gate around `executeTool`, not Codex `app-server` isolation and not a kernel sandbox. `spawn` inherits the same mode.

**Position markdown** may include `sandbox: read_only` or `sandbox: workspace_write`. That is the per-bot default when `GUILD_SANDBOX` is unset. `GUILD_SANDBOX` still wins. Position files do **not** change OS permissions. There is no approval prompt.

Data lives under `GUILD_HOME` (default `~/.guild`): `guild.sqlite` (rooms, messages, trajectory; WAL), plus bots / library markdown, `models.json`, `oauth.json` (mode `0600`), and optional `browser-profile/` (copied Chrome logins when real-profile browsing is on). API keys may be env vars (`$OPENAI_API_KEY`, …) or literals in `models.json`. Do not commit `~/.guild`.

## What is not here

- Codex `app-server` isolation / `CODEX_HOME` per bot
- Position → approval mapping
- OS-level jail (Seatbelt / bubblewrap). `GUILD_SANDBOX` / Position `sandbox:` are a tool gate only.
- Multi-user auth, network allowlists, or an installer

Those are design, not code. See `docs/2026-08-23-guild-design.md`.

## How to use it anyway

- Run it on a machine you trust, with a model you trust.
- Do not paste secrets into a channel and then `@mention` a bot.
- Prefer a throwaway `GUILD_HOME` if you are evaluating.
- Assume a jailbroken / confused bot can `rm` or overwrite files you can overwrite.

## Reporting

The repo is public (`https://github.com/Jakevin/guild`). Prefer a private note to the maintainer. If you must use GitHub, open a **security** advisory (not a public issue) and include:

1. What the bot could do (path, command, not a full exploit PoC against third parties)
2. Whether it needs a model in the loop or is a direct HTTP/tool bug
3. Guild version / commit, OS, `GUILD_HOME` if relevant

Please do not file a public issue that includes a working exploit, credentials, or someone else's data.
