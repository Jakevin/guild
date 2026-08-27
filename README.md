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

## What it is not

- Not a Codex harness
- Not a project / task board
- Not a cloud account
- Not sandboxed tools
- Not `apps/desktop` (orphan; the product UI is the daemon)

## Current limits

**`run` and `write` execute as you, in your shell, with no sandbox.** Default cwd for `run` is `$HOME`. `write` can write any path the process can write. A couple of destructive commands are refused; that is not protection. Treat this as a workshop. Details: [SECURITY.md](./SECURITY.md).

Also not built: Tauri app, SQLite, staffing, approvals, per-bot `CODEX_HOME`. Design docs under `docs/` describe a later shape — they are not a changelog.

## License

[MIT](./LICENSE)
