# Security

**`run` / `write` currently use your user shell. There is no sandbox.** Treat Guild as a workshop / experiment, not as something you point at untrusted prompts, untrusted repos, or a machine you cannot afford to lose files on.

## What ships today

Guild bots can call local tools. The process is `guildd` running as **you**.

| Tool | What it actually does |
|---|---|
| `run` | `execFile($SHELL, ["-lc", command])`. Default cwd is `$HOME`. Timeout 45s. |
| `write` | Writes any path the process can write. Creates parent folders. |
| `read` / `list` | Read any path the process can read. |
| `skill` / `spawn` / `image_gen` | In-process. `spawn` cannot nest. Read-only subagents cannot `write`. |

The only hard refusals in `run` are a narrow `rm -rf /` pattern and `mkfs`. That is not a sandbox. Position files do **not** change OS permissions. There is no approval prompt.

Data lives under `GUILD_HOME` (default `~/.guild`): bots, rooms, `models.json`, `oauth.json` (mode `0600`). API keys may be env vars (`$OPENAI_API_KEY`, …) or literals in `models.json`. Do not commit `~/.guild`.

## What is not here

- Codex `app-server` isolation / `CODEX_HOME` per bot
- Position → sandbox / approval mapping
- A `Harness` boundary around `tools.executeTool`
- Multi-user auth, network allowlists, or an installer

Those are design, not code. See `docs/2026-08-23-guild-design.md`.

## How to use it anyway

- Run it on a machine you trust, with a model you trust.
- Do not paste secrets into a channel and then `@mention` a bot.
- Prefer a throwaway `GUILD_HOME` if you are evaluating.
- Assume a jailbroken / confused bot can `rm` or overwrite files you can overwrite.

## Reporting

Until the repo is public with a private vulnerability path, write a **security** issue (or a private note to the maintainer) and include:

1. What the bot could do (path, command, not a full exploit PoC against third parties)
2. Whether it needs a model in the loop or is a direct HTTP/tool bug
3. Guild version / commit, OS, `GUILD_HOME` if relevant

Please do not file a public issue that includes a working exploit, credentials, or someone else's data.
