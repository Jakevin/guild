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
| `browser` | Local Chrome/Chromium/Edge/Brave over CDP. Default (`GUILD_BROWSER_REAL_PROFILE=1`): snapshots the **active** Chrome profile (`Local State` → `last_used`) into `{GUILD_HOME}/browser-profile/chrome/` (cookies/logins via sqlite backup; dir mode `0700`) and drives **that copy**. Never opens the live profile (Chrome 136+). Set `GUILD_BROWSER_REAL_PROFILE=0` for a throwaway profile (no logins); turning it off deletes the snapshot. Windows: Chrome must be fully quit or the cookie DB is locked. |
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

### Restart, `/host`, and what the gates are not

**No hot reload.** There is no HMR. `guildd` loads daemon source and `src/public/*` once. Changing that code — including the `/host` denylist and MCP env redaction — does nothing until you stop the process (Ctrl-C / SIGTERM on the `guildd` listening on port 7420) and start it again. SQLite under `GUILD_HOME` survives a restart. In-memory live turns, MCP stdio children, and the browser CDP session do not. `models.json` is re-read on request; an already-spawned MCP child keeps the env it started with.

**`/host/*` is an attach picker over `$HOME`, not a chroot.** The picker browses the machine on purpose so you can attach files from outside the workspace. A denylist refuses Guild secrets (`oauth.json`, `models.json`, `mcp.json`, `browser-profile/` under `~/.guild` and `GUILD_HOME`), SSH private keys and `id_*` files, key-material suffixes (`.pem`, `.p12`, `.pfx`, `.key`, `.p8`, `.jks`, `.keystore`), and the usual credential files / folders (`~/.claude.json`, `~/.npmrc`, `~/.netrc`, `~/.yarnrc.yml`, `~/.git-credentials`, `~/.pgpass`, `~/.pypirc`, `~/.my.cnf`, `~/.env*`, `credentials.json`, `service-account.json`, `~/.aws`, `~/.docker`, `~/.gnupg`, `~/.claude`, `~/.codex`, `~/.cursor`, `~/.kube`, `~/.azure`, `~/.config/gcloud`, `~/.config/gh`, `~/Library/Keychains`). Non-secret `$HOME` and files such as `/etc/passwd` stay readable by design. A request with a foreign `Origin` is `403 cross-origin refused`. This list is **not** applied to the bot's `read` / `list` / `run` tools: under `full_access` those tools are you.

**MCP env is masked on HTTP, not in the process.** `GET /mcp/servers`, `GET /mcp/host`, and the `POST` replies replace every `launch.env` value with `***` (keys stay, so the UI can show that env is set). `{GUILD_HOME}/mcp.json` is mode `0600` and still holds the real values; spawned children receive them. Anything that can read that file as your uid can read the keys.

**`workspace_write` is a Guild tool gate, not a shell jail.** `gateTool` checks the `run` cwd and `write` / `read` / `list` paths against `GUILD_WORKSPACE` (else this checkout). MCP, `image_gen`, and `browser` are refused because they are unsandboxed. The command body is still `execFile($SHELL, ["-lc", command])` as you. A `run` whose cwd is inside the workspace can `cat ~/.npmrc`, `curl`, or `rm` whatever your user can. It is not Seatbelt, bubblewrap, or Codex `app-server` isolation.

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
