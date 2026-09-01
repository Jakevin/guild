# Contributing

## Dev

Need Node ≥ 22.19 and [pnpm](https://pnpm.io) 10.x.

```bash
pnpm i
pnpm test
pnpm dev                 # http://127.0.0.1:7420
```

`pnpm test` runs the daemon package (`@kevin5251984/guild`) only. Data directory is `GUILD_HOME` (default `~/.guild`). The daemon boots Cordis from `packages/daemon/cordis.yml`. Point data at a temp dir when testing:

```bash
GUILD_HOME=/tmp/guild-dev pnpm dev
```

`pnpm build` (`pnpm -r build`) runs each package's `build`. The daemon's is `node --check bin/guildd.mjs`: npm ships TypeScript source loaded by `tsx`, so `tsc` is not a publish gate (Cordis 4 `Service` / `.ts` import extensions fail typecheck). `apps/desktop` is an orphan Vite shell — do not treat it as the product.

The real UI is `packages/daemon/src/public/chat.html`, served by `guildd`.

## Do not add chat features

Attachments, `@mention`, and retry are enough. New composer toys, extra room types, or desktop-UI catch-up are out of scope.

## Next product cut

Harness: `runAgentLoop` in `src/harness.ts` (OpenAI / Anthropic / OAuth all call it). Tools go through `ctx.tools`. Default sandbox is `full_access` unless POSITION.md has `sandbox:` or `GUILD_SANDBOX` is set. Next is still **not** Codex app-server / task board / Tauri. Target docs: `docs/2026-08-23-guild-design.md` and `docs/2026-08-23-codex-harness-addendum.md`.

## Release

npm (`@kevin5251984/guild`) and the GitHub Release are the same cut. The switch is a git tag `vX.Y.Z` that matches both `package.json` and `packages/daemon/package.json`. Do not `npm publish` or `gh release create` on your laptop.

```bash
# versions already bumped and on main
git tag v0.2.14
git push origin main v0.2.14
```

CI (`.github/workflows/release.yml`) tests, publishes the daemon package, then creates the GitHub Release. A Release existing means that version is on npm. Catch-up a tag that already has a GitHub Release: Actions → Release → Run workflow → tag `v0.2.13`.

### First time: Trusted Publisher on npmjs.com

Package → Settings → Trusted Publisher → GitHub Actions:

| Field | Value |
|---|---|
| Organization or user | `Jakevin` |
| Repository | `guild` |
| Workflow filename | `release.yml` (filename only) |
| Environment name | leave empty |
| Allowed actions | `npm publish` |

After the first CI publish succeeds, optional: Publishing access → require 2FA and disallow tokens. That blocks laptop publishes; OIDC from this workflow still works.

## PRs

- Smallest correct change.
- Tests for the behavior you touched.
- Honest README / SECURITY.md if you change what tools can do.
