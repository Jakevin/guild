# Call one adventurer: Guild in ten minutes

Guild is a local guild of adventurers. You staff people with names and `@mention` the one you actually want. Not another omniscient chat.

Your disk (default `~/.guild`). Your models. The log stays at the hall.

![A local guild. @mention one adventurer.](demo-hall-en-2026-08-29.gif)

Repo: https://github.com/Jakevin/guild · `v0.2.1`

## You need

Node ≥ 22.19, pnpm 10.x, and a model (Ollama, an API key, or a subscription: ChatGPT Codex / Claude Pro / Grok / Copilot / OpenRouter). Without a model they can ack; they cannot think.

## 1. Open the hall

```bash
git clone https://github.com/Jakevin/guild.git
cd guild
pnpm i
pnpm test
pnpm dev
```

Open http://127.0.0.1:7420. Chrome should read **Channels / Roster / Workshop**.

Rooms, messages, and trajectory live in `guild.sqlite`. Souls / skills / MEMORY.md stay files. Not a cloud account.

## 2. Wire a model

**Models** (`/settings`). Pick Ollama, paste a key, or complete OAuth. Skip this and `@pm` only nods.

## 3. Write a contract

Open a channel. That is a **contract**, not a quest board and not a ticket that closes.

From the hall icon, write `Channel.md`:

```md
# first-mention
Job: get one real reply from a named adventurer.
Most important thing: @mention the person you want. Do not start a new feature.
```

Whispers have no `Channel.md`.

## 4. Call one person

Default roster of five: `@infra` `@pm` `@rd` `@design` `@marketing`. A roster, not a sortie — work still goes to one `@handle`.

```
@pm what is the one most important thing now?
```

Wait for that one person. `@channel` pings the whole roster — usually the wrong move.

Pass: only `@pm` replies, and it matches the contract you just wrote. If you name nobody, the last adventurer who spoke continues.

## 5. People are markdown

Roster (`/studio`) → `@pm` → `SOUL.md`. Change one Voice line. Ask the same question. The tone should change.

Hire a sixth adventurer here. Skills are markdown; you can copy them from a local CLI.

## Workshop (later)

`/library`: Skills (markdown, staffed onto an adventurer), Subagents (`spawn`, no nest, no MCP), MCP (stdio tool server, **not a skill**). You do not need these for the first reply.

## Honest limits

Treat this as a workshop. Do not point it at untrusted prompts, untrusted repos, or a machine you cannot afford to lose files on. Details: [SECURITY.md](../SECURITY.md).

- **`run` / `write` are your shell.** Default `full_access`. `run` cwd is `$HOME`. Optional Position `sandbox:` / `GUILD_SANDBOX` is a tool gate, not an OS jail.
- **MCP spawns as you, with no import / consent.** Guild `mcp.json` **and** host Claude / Cursor / Codex configs. Env is inherited. To keep a host server out: remove it from the host file, or set `id: mcp` to `disabled: true` in `packages/daemon/cordis.yml`.
- **Browser is off-login by default.**

Do not paste secrets into a channel and then `@mention` someone. Prefer a throwaway `GUILD_HOME` if you are evaluating.

## What it is not

Not a Codex harness. Not a quest board. Not a party sortie. Not a cloud account. Not `apps/desktop` (orphan; the product UI is the daemon).

## After it works

Ask `@rd` about the repo you cloned. Edit one line of `SOUL.md`. File an issue only if the limits in the README are wrong.

```
pnpm i && pnpm test && pnpm dev
```
