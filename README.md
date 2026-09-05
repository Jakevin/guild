<p align="left"><img src="docs/logo/B-g-monogram.svg" width="128" height="128" alt="Guild"></p>

# Guild

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md)

**A local guild of adventurers. @mention the one you actually want. Not another omniscient chat.**

Local-first. Your files. Your models.

![A local guild. @mention one adventurer.](docs/demo-hall-en-2026-08-31.gif)

## Open the hall

Need [Node](https://nodejs.org) ≥ 22.19. One line, no clone:

```bash
npx @kevin5251984/guild web
```

Open [http://127.0.0.1:7420](http://127.0.0.1:7420). `--port` moves the port; `--no-open` keeps the browser shut.

Reading or changing the code — checkout with [pnpm](https://pnpm.io) 10.x:

```bash
pnpm i
pnpm test
pnpm dev
```

Fixture preview (no model, no tools): [jakevin.github.io/guild](https://jakevin.github.io/guild/).

1. **Models** (`/settings`) — **first click.** Connect a subscription (OAuth) or paste an API key, then Apply a default. Without a ready model Guild cannot think or run tools. Do not `@mention` yet.
2. Open a channel — a contract. Write `Channel.md` if the hall has a job.
3. `@pm` to scope, `@rd` to look at code. Put the `@handle` at the **start of a line** — that is the assignment. They also answer when you reply to them; name nobody and the last adventurer who spoke continues. `@channel` pings the whole roster — usually the wrong move.

Data: `GUILD_HOME` (default `~/.guild`). Rooms, messages, and trajectory live in `guild.sqlite` (WAL). Souls / skills / MEMORY.md stay files. Not a cloud account. `guildd` is a Cordis 4 app; plugin composition lives in `packages/daemon/cordis.yml`. `GUILD_*` env vars still win over YAML.

![The hall: channels, roster, and a live thread.](docs/readme-hall-2026-08-29.png)

## Run the hall

**Who answers.** Each quest keeps a **派工 list**. A mention appends a work record; finishing this turn drops that seat. Numbered items in one message (`1. @design` / `2. @marketing`) share a wave and run together. `完成後` / `最後` / `再交 @infra` append later waves and wait. A bot `@handle` files that spec in a 1:1 **交辦** so the next seat works from the brief, not the whole log — you do not press a button. Line-start `@handle` is not the only way on. Name nobody and the last adventurer who spoke continues, or the front of the 派工 list if it still has seats. `@all` / `@channel` / `@here` wake every seat in the hall in parallel — usually the wrong move. `@` someone who is not in the hall does not add them. A hall holds 6 seats (`#general` aside): reuse the roster before you hire.

**The composer.** Reply to one message to aim at that adventurer and show which line you mean. While a turn is running, Enter queues your next line; Cmd/Ctrl+↩ inserts it into the live turn. Pause holds that adventurer so you can switch models and Continue; Stop pulls them out of the turn. Retry re-asks one question. Delete removes one message and its trajectory. Rename a channel from the sidebar.

**Bring context.** Drag files into the composer, paste them, or pick them from the attachment menu — up to 12 per message. An image gets a hover preview; the preview is UI only, the model gets the text body. Too big to embed and Guild sends the path so the adventurer can `read` it.

**Borrow one skill.** Type `/` in the composer to pick a Workshop skill or subagent without staffing it onto anyone first. `/slug` inside a message applies to that turn only.

## The roster

- **The unit is a named adventurer:** Soul / Agent / Skill / Position, invoked with `@handle`.
- Default roster of five: `@infra` `@pm` `@rd` `@design` `@marketing`. A roster, not a sortie — work still goes to one `@handle` at a time.
- Hire more in Bot Studio (`/studio`). Skills are markdown; you can copy them from a local CLI. On the same form, ask the model to pick up to 8 skills for that seat; with no model wired it falls back to a local match.
- Models you bring: OpenAI, Anthropic, xAI, Ollama, OpenRouter — API key or OAuth (ChatGPT Codex, Claude Pro/Max, Grok, Copilot, OpenRouter, Kimi Code, Pi Radius). Command Code is an optional subscription picker (official Provider API; Go accounts fall back to `/alpha/generate`). Freebuff Chat is an optional chat-role picker (official free session); Guild still runs the tools.

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

## The harness

One turn, one process: `@handle` → `chatReply` → `HarnessService.turn` → `runAgentLoop`.

**Assembly.** `buildChatSystem` (`generate.ts`) stacks in this order: who you are (`@handle`), the hall rules, host facts, the tool list, this turn's skill / subagent catalog, `Channel.md`, then `MEMORY.md`, then `SOUL.md` / `AGENTS.md` / `POSITION.md`. The catalog is a name and a summary — a skill's body loads only when the model calls `skill`. `Channel.md` outranks `MEMORY.md`. History is compacted before the model sees it.

**Loop.** `runAgentLoop` (`harness.ts`) asks the model with the tool catalog. No tool call — that text is the answer. Tool calls — they run in parallel (`Promise.all`), every result goes back into the message list, and the model is asked again. The loop is bounded; at the bound it asks for a final answer instead of more tools.

**You stay in it.** A mid-turn reply queues; Cmd/Ctrl+↩ injects it into the live turn and it reaches the model next round as `<user_steer>`. Pause aborts the in-flight `AbortSignal` but keeps the live bubble so you can switch models and Continue (the next round sees thinking and tools so far). Stop aborts that seat's signal and ends the turn. There is no approval step; nothing asks you first.

**The gate.** Before a tool runs, `gateTool` (`harness.ts`) reads the seat's sandbox: `full_access` (default) lets everything through, `read_only` keeps `read` / `list` / `skill` / `spawn` / `read_spawn` / `cronjob`, `workspace_write` confines `write` / `run` to the workspace, `/tmp`, and `{GUILD_HOME}/cache`, and refuses MCP and `image_gen`. It is a tool gate in one process running as you — what it does not protect you from is spelled out in Current limits.

**Why Hermes is named here.** We borrowed one shape, not a codebase. Hermes is the closest published example of a local agent that browses as you without hijacking the browser you are using, so `browser.ts` copies that: never CDP the live Chrome profile (Chrome 136+), snapshot `last_used` into `~/.guild/browser-profile/chrome`, drive the copy. The borrowing stops there. The turn loop is Guild's own (`runAgentLoop` + `gateTool`); the sandbox names are Codex-shaped but this is not the Codex app-server harness; the `Harness` trait in `docs/` was never shipped.

Files: `packages/daemon/src/harness.ts` (loop, gate, policy) · `generate.ts` (system assembly, `HALL_RULES`) · `tools.ts` (catalog, steer drain, round fuse) · `browser.ts` (profile snapshot).

## What it is not

- Not a Codex harness
- Not a task board — a channel is an open contract
- Not a party sortie — you assign one @handle; @all is the exception, not the habit
- Not a cloud account
- Not an OS jail (optional Position / `GUILD_SANDBOX` tool gate only)
- Not `apps/desktop` (orphan; the product UI is the daemon)

## Current limits

**Freebuff Chat credentials stay local.** Official device login (`~/.config/manicode/credentials.json`) wins; with no login, a `CODEBUFF_API_KEY` from your environment is the fallback. Either way the token only signs SDK requests to Codebuff — the remote agent still cannot read, write, or run anything on your machine.

**Default: `run` and `write` execute as you, in your shell (`GUILD_SANDBOX` unset = `full_access`, unless the bot's POSITION.md has `sandbox:`).** Default cwd for `run` is `$HOME` (`workspace_write` uses `GUILD_WORKSPACE` or this checkout). The gate is not Codex isolation. Details: [SECURITY.md](./SECURITY.md).

**MCP spawns a local process as you** — Guild `mcp.json` **and** host Claude / Cursor / Codex configs, with no import / consent prompt. Env is inherited, then overlayed with the server's `env`. Blast radius is larger than a skill. Treat this as a workshop. Details: [SECURITY.md](./SECURITY.md).

**Browser snapshots your Chrome logins by default.** `browser` copies the **active** Chrome profile (`last_used`) into `~/.guild/browser-profile/chrome` and drives that copy (Hermes-shaped — never the live profile). Set `GUILD_BROWSER_REAL_PROFILE=0` for a throwaway empty profile. Details: [SECURITY.md](./SECURITY.md).

Also not built: Tauri app, staffing, approvals, per-bot `CODEX_HOME`, HTTP MCP. Design docs under `docs/` describe a later shape — they are not a changelog.

## License

[MIT](./LICENSE)
