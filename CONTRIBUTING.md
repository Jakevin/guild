# Contributing

## Dev

Need Node ≥ 22.19 and [pnpm](https://pnpm.io) 10.x.

```bash
pnpm i
pnpm test
pnpm dev                 # http://127.0.0.1:7420
```

`pnpm test` runs `@guild/daemon` only. Data directory is `GUILD_HOME` (default `~/.guild`). The daemon boots Cordis from `packages/daemon/cordis.yml`. Point data at a temp dir when testing:

```bash
GUILD_HOME=/tmp/guild-dev pnpm dev
```

The real UI is `packages/daemon/src/public/chat.html`, served by `guildd`. `apps/desktop` is an orphan shell — do not treat it as the product.

## Do not add chat features

Attachments, `@mention`, and retry are enough. New composer toys, extra room types, or desktop-UI catch-up are out of scope.

## Next product cut

Harness: `runAgentLoop` in `src/harness.ts` (OpenAI / Anthropic / OAuth all call it). Tools go through `ctx.tools`. Default sandbox is `full_access`. Next is still **not** Codex app-server / task board / Tauri. Target docs: `docs/2026-08-23-guild-design.md` and `docs/2026-08-23-codex-harness-addendum.md`.

## PRs

- Smallest correct change.
- Tests for the behavior you touched.
- Honest README / SECURITY.md if you change what tools can do.
