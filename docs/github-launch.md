# GitHub launch copy

**Do not publish until the gate is green.** Public battlefield is this repo. Open-source day = first public. Show HN / X / r/LocalLLaMA / Discord all point here.

Gate: LICENSE + README + SECURITY.md + 60s GIF. **No GIF → do not go public.** Public date may be before sandbox, not before honest limits are in the README.

Status (2026-08-28):

| Item | State |
|---|---|
| G1 LICENSE MIT | done |
| G2 README rewrite | done (adventurer-guild voice; GIF in README) |
| G3 SECURITY.md | done (host MCP live, Position `sandbox:`, browser) |
| G4 CONTRIBUTING.md | done |
| G5 issue templates + this file | done |
| G6 60s GIF | signed and hung in README |
| G7 GitHub remote | done — `https://github.com/Jakevin/guild` |
| G8 public + `v0.1.0` | done (first cut, tag stays) |
| G9 `v0.2.0` | hall UI, host MCP, browser, parallel turns — this cut |

**Repo name locked: `guild`.** Public URL is `https://github.com/Jakevin/guild`. OWNER is `Jakevin`. `.github/ISSUE_TEMPLATE/config.yml` points at `Jakevin/guild`.

---

## GitHub About (repo settings)

**Description**

```
A local guild of adventurers. @mention the one you actually want. Not another omniscient chat.
```

**Website:** leave empty until there is a real site. The README is the landing page.

**Topics** (exact): `local-first` `ai-agents` `ollama` `openai` `anthropic` `typescript`

**Social preview:** one hall / roster screenshot. Not RPG tavern art. Not a logo lockup.

**Pin:** Discussion `Current vs design` (body below).

---

## 60s GIF (G6 — human; this is the shot list)

If these 60 seconds are unclear, do not polish copy and do not go public.

**Bots cannot record this.** Need a real desktop session, a wired model, live replies, and a visible tone change after editing `SOUL.md`. Stitched screenshots are not the demo.

1. Open the bench. Pan across the five seats (`@infra` `@pm` `@rd` `@design` `@marketing`).
2. Open a channel. Paste a short Channel.md (one job, one “most important thing”).
3. `@pm` — “what is the one most important thing now?”
4. `@rd` — look at current code, do not start a new feature.
5. Bot Studio: change one line of that bot’s `SOUL.md`. Ask the same person again. Tone must change.

Export: 16:9 or repo-native, <15MB, silent or captions only. Drop into README where the HTML comment says `60s GIF goes here`. Filename suggestion: `docs/demo.gif`.

Quick capture on this Mac (once you are in the UI): QuickTime Player → New Screen Recording, or `screencapture -v`, then `ffmpeg` to GIF. Chrome and ffmpeg are already installed.

---

## Show HN (T0+1, after a clean clone walk)

**Title**

```
Show HN: Guild – local guild of adventurers you @mention, not another omniscient chat
```

**Body** (paste as-is after URL replace)

```
Guild is a local guild of adventurers. You hire @pm, @rd, … and @mention the one you actually want. Data lives in ~/.guild. Models are yours (OpenAI / Anthropic / Ollama / OpenRouter, API key or OAuth).

It is not another omniscient chat window. It is also not a Codex harness and not a quest board. A roster is not a sortie — work still goes to one @handle.

Tools (run / write) execute in your user shell unless you set GUILD_SANDBOX or a Position sandbox: line. Default cwd for run is $HOME. Host Claude/Cursor/Codex MCP is live in chat with no import step. Treat this as a workshop. Details are in SECURITY.md.

Quick start: Node ≥ 22, then:

    pnpm i && pnpm test && pnpm dev
    # http://127.0.0.1:7420

Repo: https://github.com/Jakevin/guild
```

Do not include: CrewAI / OpenClaw comparison tables, Harness dates, Product Hunt, “ships your project”, desktop-app promises.

---

## X (one post, not a thread)

```
A local guild of adventurers. @mention the one you actually want.
Not another omniscient chat.
Local-first. Your files. Your models.

Tools run as you — treat as a workshop.

https://github.com/Jakevin/guild
```

Attach the 60s GIF. Do not follow with a vision thread.

---

## r/LocalLLaMA

**Title**

```
Guild – local guild of adventurers; bring your own Ollama (or OpenAI / Anthropic)
```

**Body**

```
I open-sourced Guild: a local guild of adventurers you @mention, instead of one omniscient chat.

- Data in ~/.guild, not a cloud account
- Default roster of five; hire more in Bot Studio
- Soul / Agent / Skill / Position are markdown
- Wire Ollama, OpenAI, Anthropic, OpenRouter (key or OAuth)

Honest limit: run / write use your user shell unless you set GUILD_SANDBOX or Position sandbox:. Host MCP is live without import. README and SECURITY.md say this up front.

    pnpm i && pnpm dev
    # Node ≥ 22 → http://127.0.0.1:7420

https://github.com/Jakevin/guild
```

Do not post to r/ChatGPT.

---

## Discord (one channel, one message)

Pick *one* agent-builder Discord. Do not spray.

```
Open-sourced Guild: local guild of adventurers you @mention.
https://github.com/Jakevin/guild
Known: run/write execute as you. Host MCP is live without import. Treat as a workshop. GIF in the README.
```

---

## GitHub Release `v0.1.0` (first public)

Leave the tag on `d16b581`. Do not move it.

**Title:** `v0.1.0 — local bench`

## GitHub Release `v0.2.0` (this cut)

Tag `main` after a clean clone walk. Do not retag `v0.1.0`.

**Title:** `v0.2.0 — adventurer guild`

**Body**

```
A local guild of adventurers. @mention the one you actually want.

Has
- Roster of persistent adventurers (default: @infra @pm @rd @design @marketing)
- Bot Studio (hire / edit Soul, Agent, Skill, Position)
- Halls (channels) + whispers (DMs); reply on @mention, on reply-to, or — if you name nobody — the last adventurer who spoke
- @all runs members in parallel
- Workshop: skills, spawn subagents, stdio MCP
- Host Claude / Cursor / Codex MCP live in chat — no import step
- Local tools: run, read, write, list, skill, spawn, browser, image_gen
- Optional Position sandbox: / GUILD_SANDBOX tool gate (unset = full_access)
- SQLite for rooms, messages, trajectory
- Models you wire: OpenAI, Anthropic, xAI, Ollama, OpenRouter (key or OAuth)
- Cordis 4 daemon (guildd)

Does not have
- OS jail / approval around run and write (the sandbox is a tool gate)
- Quest / project / task board — a roster is not a sortie
- Codex app-server harness
- Tauri product UI (apps/desktop is an orphan)
- HTTP MCP

Security
run and write execute as you unless you set GUILD_SANDBOX or a Position sandbox: line. Default cwd for run is $HOME. Host MCP spawns as you with no import / consent prompt. Read SECURITY.md before you point this at a machine you care about.

Quick start
pnpm i && pnpm test && pnpm dev
```

---

## Pinned Discussion: Current vs design

Create after the repo is public. Pin it. Title exactly:

```
Current vs design
```

**Body**

```
Please read this before filing a wishlist issue.

Shipped (this repo, v0.2.0)
- Local guild + Bot Studio
- @mention one adventurer; unnamed follow-up goes to the last speaker; @all is parallel
- Channel.md / DM
- Tools: run, read, write, list, skill, spawn, browser, image_gen
- Optional Position sandbox: / GUILD_SANDBOX (unset = full_access — still your shell)
- stdio MCP (mcp.json + host Claude/Cursor/Codex, no import)
- Data in ~/.guild (`guild.sqlite` for rooms/messages/trajectory; markdown for library)

Not shipped (design docs under docs/ are a target, not a changelog)
- Codex app-server isolation / CODEX_HOME per bot
- Position → approval mapping
- Quest / project / task board
- Tauri product UI, HTTP MCP

What we will not add next
- Treating apps/desktop as the product UI
- A quest board or party sortie
- Dates for a later isolation cut

Useful issue types: bug (does not match README), security (see SECURITY.md), idea that is not a chat feature.
```

---

## T0 checklist (human)

1. GitHub **OWNER** is `Jakevin`. Repo name is already `guild`. This file and `.github/ISSUE_TEMPLATE/config.yml` use `Jakevin/guild`.
2. `git init` on a **clean** tree (not this working directory dumped as-is if it still has junk). MIT LICENSE on the default branch.
3. Walk: `pnpm i && pnpm test && pnpm dev` in a fresh clone.
4. Paste 60s GIF at the top of README.
5. Set About, Topics, social preview, issue templates, pin Discussion.
6. Then shout — Release `v0.2.0`, Show HN, X, r/LocalLLaMA, one Discord. Same URL. Same limits sentence. Leave `v0.1.0` where it is.
7. Not before.

---

## 14-day experiment (stars are vanity)

| Watch | Pass | Fail |
|---|---|---|
| Independent clone / `pnpm dev` traces (issue or Discussion) | ≥10 | stars only |
| First-page issues | people quote README limits | “how is this not ChatGPT” |
| Security | thanks SECURITY.md, or a sandbox issue | `run` scare → unstar + public flame |
| Star → next step | someone hired a 6th bot / edited Channel.md | 500 stars, zero “I staffed someone” |
| Most-asked | sandbox / board | desktop app / multiplayer (wrong sell) |

Day 14: only revisit README first 20 lines. Do not restyle, add features, and relaunch in the same week.

---

## Do not

- Product Hunt
- Paid stars / ads
- GitHub Sponsors as launch news
- “Open-source CrewAI killer”
- RPG tavern as social preview
- Design docs pasted as a feature list
- Harness dates (those bind to `@rd`, not this file)
- Shouting before GIF + clean clone
- Fake GIF from stitched screenshots
