<p align="left"><img src="docs/logo/B-g-monogram.svg" width="128" height="128" alt="Guild"></p>

# Guild

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md)

**A local guild of adventurers. @mention the one you actually want. Not another omniscient chat.**

Local-first. Your files. Your models.

![A local guild. @mention one adventurer.](docs/demo-hall-en-2026-08-29.gif)

## Open the hall

Need [Node](https://nodejs.org) ≥ 22.19 and [pnpm](https://pnpm.io) 10.x.

```bash
pnpm i
pnpm test
pnpm dev
```

Open [http://127.0.0.1:7420](http://127.0.0.1:7420).

1. **Models** (`/settings`) — wire a provider or a subscription. Without a model, adventurers can still ack; they cannot think.
2. Open a channel — a contract. Write `Channel.md` if the hall has a job.
3. `@pm` to scope, `@rd` to look at code. They reply when `@mentioned`, when you reply to them, or — if you name nobody — the last adventurer who spoke. `@channel` pings the whole roster — usually the wrong move.

Data: `GUILD_HOME` (default `~/.guild`). Rooms, messages, and trajectory live in `guild.sqlite` (WAL). Souls / skills / MEMORY.md stay files. Not a cloud account. `guildd` is a Cordis 4 app; plugin composition lives in `packages/daemon/cordis.yml`. `GUILD_*` env vars still win over YAML.

![The hall: channels, roster, and a live thread.](docs/readme-hall-2026-08-29.png)

## The roster

- **The unit is a named adventurer:** Soul / Agent / Skill / Position, invoked with `@handle`.
- Default roster of five: `@infra` `@pm` `@rd` `@design` `@marketing`. A roster, not a sortie — work still goes to one `@handle` at a time.
- Hire more in Bot Studio (`/studio`). Skills are markdown; you can copy them from a local CLI.
- Models you bring: OpenAI, Anthropic, xAI, Ollama, OpenRouter — API key or OAuth (ChatGPT Codex, Claude Pro/Max, Grok, Copilot, OpenRouter).

![Roster of five named adventurers.](docs/readme-roster-2026-08-29.png)

## Workshop

Open `/library`. One page, three tabs.

| Tab | What |
|---|---|
| **Skills** | Markdown instructions. Staff onto an adventurer. The model must call `skill` to load the body. |
| **Subagents** | Chat calls `spawn`. The child returns a summary. Cannot nest. No MCP tools. |
| **MCP** | A stdio tool server, **not a skill**. Do not put it in the skills library. |

![Workshop: Skills, Subagents, and MCP.](docs/readme-workshop-2026-08-29.png)

### MCP

1. Workshop → MCP → [Add server](http://127.0.0.1:7420/mcp/add) writes `{GUILD_HOME}/mcp.json`.
2. Name + command + args. There is no URL field. HTTP MCP is not wired.
3. Chat also **spawns** stdio MCP already configured for Claude / Cursor / Codex on this machine (`~/.claude.json`, `~/.cursor/mcp.json`, `~/.codex/config.toml`). No import step. A same-name row in `mcp.json` wins; the host leftover is skipped.
4. After it is live, **every** adventurer in the hall can call those tools. Names look like `mcp__server__tool`.

![Host MCP is available in chat without an import step.](docs/readme-mcp-2026-08-29.png)

To keep a host server out of Guild: remove it from the host file, or set `id: mcp` to `disabled: true` in `packages/daemon/cordis.yml` (that unloads Guild MCP entirely, including `mcp.json`).

```json
{
  "mcpServers": {
    "echo": { "command": "node", "args": ["echo-mcp.mjs"] }
  }
}
```

If a row has `url` and no `command`, Guild refuses it (`stdio MCP needs a command`). Caps: 40 tools per server, 80 total. `tools/call` timeout is 5 minutes. Sessions live with `guildd`.

## What it is not

- Not a Codex harness
- Not a quest board — no project / task board
- Not a party sortie — you call one adventurer, not a squad
- Not a cloud account
- Not an OS jail (optional Position / `GUILD_SANDBOX` tool gate only)
- Not `apps/desktop` (orphan; the product UI is the daemon)

## Current limits

**Default: `run` and `write` execute as you, in your shell (`GUILD_SANDBOX` unset = `full_access`, unless the bot's POSITION.md has `sandbox:`).** Default cwd for `run` is `$HOME` (`workspace_write` uses `GUILD_WORKSPACE` or this checkout). The gate is not Codex isolation. Details: [SECURITY.md](./SECURITY.md).

**MCP spawns a local process as you** — Guild `mcp.json` **and** host Claude / Cursor / Codex configs, with no import / consent prompt. Env is inherited, then overlayed with the server's `env`. Blast radius is larger than a skill. Treat this as a workshop. Details: [SECURITY.md](./SECURITY.md).

**Browser snapshots your Chrome logins by default.** `browser` copies the **active** Chrome profile (`last_used`) into `~/.guild/browser-profile/chrome` and drives that copy (Hermes-shaped — never the live profile). Set `GUILD_BROWSER_REAL_PROFILE=0` for a throwaway empty profile. Details: [SECURITY.md](./SECURITY.md).

Also not built: Tauri app, staffing, approvals, per-bot `CODEX_HOME`, HTTP MCP. Design docs under `docs/` describe a later shape — they are not a changelog.

## License

[MIT](./LICENSE)
