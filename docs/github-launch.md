# GitHub launch copy

**Do not publish until the gate is green.** Public battlefield is this repo. Open-source day = first public. Show HN / X / r/LocalLLaMA / Discord all point here.

Gate: LICENSE + README + SECURITY.md + 60s GIF. **No GIF → do not go public.** Public date may be before sandbox, not before honest limits are in the README.

Status (2026-08-26):

| Item | State |
|---|---|
| G1 LICENSE MIT | done |
| G2 README rewrite | done (GIF slot marked, not filled) |
| G3 SECURITY.md | done |
| G4 CONTRIBUTING.md | done |
| G5 issue templates + this file | done |
| G6 60s GIF | signed and hung in README |
| G7 `git init` + GitHub remote | **human** — in progress (OWNER is `Jakevin`; git init still not done) |
| G8 public + `v0.1.0` | **human**, after G6+G7 |

**Repo name locked: `guild`.** Public URL is `https://github.com/Jakevin/guild`. OWNER is `Jakevin`. `.github/ISSUE_TEMPLATE/config.yml` points at `Jakevin/guild`.

---

## GitHub About (repo settings)

**Description**

```
Local-first talent bench for AI bots. @mention the one you want. Not another omniscient chat.
```

**Website:** leave empty until there is a real site. The README is the landing page.

**Topics** (exact): `local-first` `ai-agents` `ollama` `openai` `anthropic` `typescript`

**Social preview:** one bench / channel screenshot. Not RPG tavern art. Not a logo lockup.

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
Show HN: Guild – local-first bench of bots you @mention, not another omniscient chat
```

**Body** (paste as-is after URL replace)

```
Guild is a local-first talent bench. You staff bots (@pm, @rd, …) and @mention the one you actually want. Data lives in ~/.guild. Models are yours (OpenAI / Anthropic / Ollama / OpenRouter, API key or OAuth).

It is not another omniscient chat window. It is also not a Codex harness, not a task board, and not sandboxed.

Tools (run / write) execute in your user shell. Default cwd for run is $HOME. Treat this as a workshop, not a product launch. Details are in SECURITY.md.

Quick start: Node ≥ 22, then:

    pnpm i && pnpm test && pnpm dev
    # http://127.0.0.1:7420

Repo: https://github.com/Jakevin/guild
```

Do not include: CrewAI / OpenClaw comparison tables, Harness dates, Product Hunt, “ships your project”, desktop-app promises.

---

## X (one post, not a thread)

```
Staff a local bench of bots. @mention the one you actually want.
Not another omniscient chat.
Local-first. Your files. Your models.

Tools are unsandboxed — treat as a workshop.

https://github.com/Jakevin/guild
```

Attach the 60s GIF. Do not follow with a vision thread.

---

## r/LocalLLaMA

**Title**

```
Guild – local-first bot bench; bring your own Ollama (or OpenAI / Anthropic)
```

**Body**

```
I open-sourced Guild: a local bench of bots you @mention, instead of one omniscient chat.

- Data in ~/.guild, not a cloud account
- Default five seats; hire more in Bot Studio
- Soul / Agent / Skill / Position are markdown
- Wire Ollama, OpenAI, Anthropic, OpenRouter (key or OAuth)

Honest limit: run / write use your user shell. No sandbox. README and SECURITY.md say this up front.

    pnpm i && pnpm dev
    # Node ≥ 22 → http://127.0.0.1:7420

https://github.com/Jakevin/guild
```

Do not post to r/ChatGPT.

---

## Discord (one channel, one message)

Pick *one* agent-builder Discord. Do not spray.

```
Open-sourced Guild: local-first bench of bots you @mention.
https://github.com/Jakevin/guild
Known: run/write are unsandboxed. Treat as a workshop. GIF in the README.
```

---

## GitHub Release `v0.1.0` (T0+1)

Tag only on the public day, after a clean clone walk.

**Title:** `v0.1.0 — local bench`

**Body**

```
First public cut. A local-first talent bench, not a team product yet.

Has
- Bench of persistent bots (default: @infra @pm @rd @design @marketing)
- Bot Studio (hire / edit Soul, Agent, Skill, Position)
- Channels + DMs; reply on @mention
- Local tools: run, read, write, list, skill
- Models you wire: OpenAI, Anthropic, xAI, Ollama, OpenRouter (key or OAuth)

Does not have
- Sandbox / approval around run and write
- Project / task board / staffing
- Codex app-server harness
- Tauri desktop app (apps/desktop is an orphan)

Security
run and write execute as you. Default cwd for run is $HOME. Read SECURITY.md before you point this at a machine you care about.

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

Shipped (this repo, v0.1.0)
- Local bench + Bot Studio
- @mention people, not a group chat that all reply
- Channel.md / DM
- Tools: run, read, write, list, skill — unsandboxed
- Data in ~/.guild (`guild.sqlite` for rooms/messages/trajectory; markdown for library)

Not shipped (design docs under docs/ are a target, not a changelog)
- Codex app-server / Harness trait
- Position → sandbox / approval
- Project, staffing, task board
- Tauri desktop, HTTP MCP

What we will not add next
- More chat-room toys (attachments, mention, retry are enough)
- Treating apps/desktop as the product UI
- Dates for the Harness cut

Useful issue types: bug (does not match README), security (see SECURITY.md), idea that is not a chat feature.
```

---

## T0 checklist (human)

1. GitHub **OWNER** is `Jakevin`. Repo name is already `guild`. This file and `.github/ISSUE_TEMPLATE/config.yml` use `Jakevin/guild`.
2. `git init` on a **clean** tree (not this working directory dumped as-is if it still has junk). MIT LICENSE on the default branch.
3. Walk: `pnpm i && pnpm test && pnpm dev` in a fresh clone.
4. Paste 60s GIF at the top of README.
5. Set About, Topics, social preview, issue templates, pin Discussion.
6. Then shout — Release, Show HN, X, r/LocalLLaMA, one Discord. Same URL. Same limits sentence.
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
