<p align="left"><img src="docs/logo/B-g-monogram.svg" width="128" height="128" alt="Guild"></p>

# Guild

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md)

**Staff a local bench of bots. @mention the one you actually want. Not another omniscient chat.**

Local-first. Your files. Your models.

![Staff a local bench. @mention one.](docs/demo.gif)

## Quick start

Need [Node](https://nodejs.org) ≥ 22.19 and [pnpm](https://pnpm.io) 10.x.

```bash
pnpm i
pnpm test
pnpm dev
```

Open [http://127.0.0.1:7420](http://127.0.0.1:7420).

1. **Models** (`/settings`) — wire a provider or a subscription. Without a model, bots can still ack; they cannot think.
2. Open a channel. Write `Channel.md` if the room has a job.
3. `@pm` to scope, `@rd` to look at code. They reply when mentioned (or when you reply to them). `@channel` pings everyone — usually the wrong move.

Data: `GUILD_HOME` (default `~/.guild`). Not a cloud account.

## What it is

- **Person** is the unit: Soul / Agent / Skill / Position, invoked with `@handle`.
- Default five: `@infra` `@pm` `@rd` `@design` `@marketing`.
- Hire in Bot Studio (`/studio`). Skills are markdown; you can copy them from a local CLI.
- Models you bring: OpenAI, Anthropic, xAI, Ollama, OpenRouter — API key or OAuth (ChatGPT Codex, Claude Pro/Max, Grok, Copilot, OpenRouter).

## Workshop

Open `/library`. One page, three tabs.

| Tab | What |
|---|---|
| **Skills** | Markdown instructions. Staff onto a bot. The model must call `skill` to load the body. |
| **Subagents** | Chat calls `spawn`. The child returns a summary. Cannot nest. No MCP tools. |
| **MCP** | A stdio tool server, **not a skill**. Do not put it in the skills library. |

### MCP

1. Workshop → MCP → [Add server](http://127.0.0.1:7420/mcp/add), or import a host card from Codex / Claude / Cursor on this machine.
2. Name + command + args. There is no URL field. HTTP MCP is not wired.
3. After it is connected, **every** bot in chat can call those tools. Names look like `mcp__server__tool`.

Config is `{GUILD_HOME}/mcp.json` (default `~/.guild/mcp.json`). Host files (`~/.claude.json`, `~/.cursor/mcp.json`, `~/.codex/config.toml`) are listed read-only until you import. Import copies the launch into Guild; chat does not use the host file directly.

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
- Not a project / task board
- Not a cloud account
- Not sandboxed tools
- Not `apps/desktop` (orphan; the product UI is the daemon)

## Current limits

**`run` and `write` execute as you, in your shell, with no sandbox.** Default cwd for `run` is `$HOME`. `write` can write any path the process can write. A couple of destructive commands are refused; that is not protection.

**MCP spawns a local process as you.** Env is inherited, then overlayed with the server's `env`. Blast radius is larger than a skill. Treat this as a workshop. Details: [SECURITY.md](./SECURITY.md).

Also not built: Tauri app, SQLite, staffing, approvals, per-bot `CODEX_HOME`, HTTP MCP. Design docs under `docs/` describe a later shape — they are not a changelog.

## License

[MIT](./LICENSE)
