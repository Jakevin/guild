# Call one adventurer: Guild in ten minutes

Guild is a local guild of adventurers. You staff people with names and `@mention` the one you actually want. Not another omniscient chat.

Your disk (default `~/.guild`). Your models. The log stays at the hall.

![A local guild. @mention one adventurer.](demo-hall-en-2026-08-29.gif)

Repo: https://github.com/Jakevin/guild · `v0.2.1`

## You need

A **model first**. Guild cannot think or run tools without one. Then Node ≥ 22.19 and [pnpm](https://pnpm.io) 10.x.

## 1. Get a model (do this first)

Pick **one**. Do not `@mention` anyone until it is connected.

| You have | Do |
|---|---|
| ChatGPT Plus / Pro | Codex OAuth on Models → Subscriptions |
| Claude Pro / Max | Claude OAuth |
| Grok / SuperGrok / X Premium | xAI OAuth |
| Copilot / OpenRouter / Kimi Code / Pi Radius | that OAuth |
| OpenAI / Anthropic / xAI / OpenRouter API key | paste it on Models → API Key |
| Ollama | install Ollama, pull a local model |

Without this step, Guild is not usable.

## 2. Open the hall

Node ≥ 22.19. One command, same shape as `npx @deepseek-ai/dsh web`:

```bash
npx @kevin5251984/guild web
```

That starts `guildd` at http://127.0.0.1:7420 and opens a browser. From a checkout instead:

```bash
git clone https://github.com/Jakevin/guild.git
cd guild
pnpm i
pnpm test
pnpm dev
```

Chrome should read **Channels / Roster / Workshop**.

**First click in the hall: Models** (`/settings`). Finish the login or paste the key, then **Apply** a default model. The empty thread will send you there if you skipped it.

Rooms, messages, and trajectory live in `guild.sqlite`. Souls / skills / MEMORY.md stay files. Not a cloud account.

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
- **Browser snapshots your Chrome logins by default.** Set `GUILD_BROWSER_REAL_PROFILE=0` for a throwaway empty profile.

Do not paste secrets into a channel and then `@mention` someone. Prefer a throwaway `GUILD_HOME` if you are evaluating.

## What it is not

Not a Codex harness. Not a quest board. Not a party sortie. Not a cloud account. Not `apps/desktop` (orphan; the product UI is the daemon).

## After it works

Ask `@rd` about the repo you cloned. Edit one line of `SOUL.md`. File an issue only if the limits in the README are wrong.

```
pnpm i && pnpm test && pnpm dev
```
