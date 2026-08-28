# Guild daemon: Cordis 4 kernel

| Field | Value |
|---|---|
| Status | **Shipped on `7f6b62a`** (`feat: boot guildd as a Cordis 4 plugin app`). Adapter kernel, not a full rewrite of handlers. |
| Date | 2026-08-28 |
| Repo | product name remains Guild; public `https://github.com/Jakevin/guild` |
| Decision | Rewrite `guildd` internals as a Cordis 4 app. Composition is Loader + `cordis.yml` (approach C). |
| Out of scope | DeepSeek Harness (`@deepseek-ai/dsh`), Koishi / `@cordisjs/core` 3, product rename, `@cordisjs/plugin-server`, replacing pi-ai, Tauri / `apps/desktop`, HMR. Guild `src/harness.ts` is a later cut, not this kernel. |

This spec was the contract for the first kernel cut. **What landed is an adapter layer.** Do not re-implement the items in **Not in v1** below as if they were missing bugs.

### Not in v1 (do not build from this draft)

| Draft said | What shipped |
|---|---|
| `api` owns the router; handlers take `ctx` | `plugins/api.ts` only calls `ctx.server.listen()`. Routes stay in `router.ts` + `GuildStore` + `HandlerExtras` flags |
| `@mention` goes through `ctx.chat.reply` | **Live HTTP does:** `extras.turn = ctx.chat.reply` → `ctx.harness.turn`. Fallback is still `chatReply`. `generate.ts` is still imported. |
| `ctx.tools` adds MCP tools only via `ctx.get("mcp")` | **Live:** `plugins/mcp.ts` `registerPrefix("mcp__")`; `harness.turn` uses `ctx.get("mcp")` else `[]`. Direct `chatReply` still `listMcpToolRefs(dataDir)` (disk backdoor). |
| Each plugin exports schemastery `Config` | `schemastery` is a dependency; plugins export none. Bad YAML config is ignored, not `FAILED` |
| `@cordisjs/plugin-hmr` in YAML, `disabled: true` | **No HMR entry.** Do not add the package until someone needs HMR |
| `ctx.server.route()` as reversible effects | One `http.createServer` listener. Unload `api` does not unmount routes; dispose the root fiber to close HTTP |
| OAuth / memory disabled have composition tests | Router has `oauth_disabled`; **no** composition test for oauth/memory |

`Include.prototype.write` is stubbed to a no-op in `start.ts` so unload does not rewrite `cordis.yml`. That is a private patch; bumping `@cordisjs/plugin-include` must re-check it.

---

## Goal

Keep Guild as the product (bench, `@mention`, Bot Studio, Workshop). Change only how the daemon is assembled:

- Root `Context` + `@cordisjs/plugin-loader` + `@cordisjs/plugin-include`.
- Plugin tree declared in `packages/daemon/cordis.yml` with stable `id`s.
- Domain logic stays in existing modules (`store.ts`, `llm.ts`, `tools.ts`, …). New files under `packages/daemon/src/plugins/` are Cordis adapters (`Service` / `apply` / `Config` schema).
- REST paths, static HTML, `@guild/protocol`, and `GUILD_HOME` (default `~/.guild`) stay compatible.

Success: `pnpm test` and `pnpm dev` still work; `/health` still returns `{ status: "ok", ready: true, service: "guildd" }`; a user can `@pm` in a channel the same way as today; disabling `mcp` or `memory` in YAML unloads that capability without crashing the rest.

---

## Non-goals

- Do not vendor or depend on `@deepseek-ai/dsh` / `@deepseek-ai/cordis`. Use official `cordis` and `@cordisjs/*`.
- Do not rename the product, npm scope `@guild/*`, `guildd` bin, `GUILD_*` env vars, or `~/.guild`.
- Do not switch the HTTP stack to `@cordisjs/plugin-server`.
- Do not replace `@earendil-works/pi-ai`.
- Do not make HMR a required path for `pnpm dev` or tests.
- Do not turn mention / compact / usage / chat-parts / trajectory-formatting into services.
- Do not event-ify REST or the LLM tool loop (no waterfall around `llmComplete`).

---

## Dependencies (pinned)

Add to `@guild/daemon`:

| Package | Role |
|---|---|
| `cordis` `4.0.0-rc.8` | Context, Service, events, fibers |
| `@cordisjs/plugin-loader` `1.0.0-rc.5` | `ctx.loader` |
| `@cordisjs/plugin-include` `1.0.4` | Read `cordis.yml` |
| `@cordisjs/plugin-logger-console` | `ctx.logger` → stdout |
| `@cordisjs/plugin-timer` | Loaded; unused by v1 Guild plugins |
| `schemastery` | Transitive (logger-console). Guild plugins do not export `Config` |

Do not add `@cordisjs/plugin-http` (that is an HTTP *client*).

---

## Architecture

### Bootstrap

Do not use the `cordis` CLI bin. It resolves `./cordis.yml` from `process.cwd()`, which breaks `pnpm --filter` and tests.

`packages/daemon/src/cli.ts` starts the daemon and, only in this file, disposes on signal:

```ts
const started = startGuildDaemon();
started.catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function shutdown() {
  const { ctx } = await started;
  await ctx.fiber.dispose();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
```

Tests call `startGuildDaemon` / `createGuildContext` and must not register these process handlers.

`createGuildContext(env, options?)`:

- `options.configPath` defaults to `./cordis.yml` (resolved from `baseUrl`). Tests may pass a temp YAML.
- `options.patches` is forwarded to Include `config.patches` (override `disabled` / `config` by entry `id`). Default empty.

Steps:

1. `const ctx = new Context()`.
2. `ctx.baseUrl = pathToFileURL(<packages/daemon/>).href + '/'` (daemon package directory, not cwd).
3. `await ctx.plugin(Loader)`.
4. `await ctx.loader.create({ name: '@cordisjs/plugin-include', config: { path: options.configPath ?? './cordis.yml', patches: options.patches ?? [] } })`.
5. Poll until `ctx.get('server')` is defined, then `await ctx.server.whenListening()`. Combined timeout 10s → throw `guildd did not listen`.
6. Return `ctx` (HTTP is already bound).

`startGuildDaemon(env)` calls `createGuildContext`, prints the existing one-line JSON (`listening`, `host`, `port`, `service: "guildd"`, `status: "ok"`, `ready: true`, `dataDir`), returns `{ server: ctx.server.node, ctx }`. Tests that only close the port use `result.server`.

Dispose of the root fiber closes HTTP and MCP children (those registrations are plugin effects).

### Config precedence

For host, port, and data directory:

1. Environment: `GUILD_HOST`, `GUILD_PORT`, `GUILD_HOME`.
2. Else the plugin `config` in `cordis.yml`.
3. Else existing defaults: `127.0.0.1`, `7420`, `join(homedir(), ".guild")`.

`GUILD_PORT=0` remains valid (ephemeral port). Invalid port still throws `invalid GUILD_PORT: …` before listen.

### HTTP

`ctx.server` wraps the existing `node:http` server.

- `apply` creates the server, registers a request listener that dispatches the route table, then `listen`.
- `ctx.on('dispose', () => server.close())`.
- Static files stay the current `packages/daemon/src/public/` tree and the current `PAGES` map. That logic moves into the `server` plugin (or stays in `router.ts` called from it). Paths and Content-Types do not change.

### Types

One declaration file `packages/daemon/src/cordis.d.ts`:

```ts
import type { StoreService } from "./plugins/store.ts";
import type { OAuthService } from "./plugins/oauth.ts";
import type { LlmService } from "./plugins/llm.ts";
import type { ToolsService } from "./plugins/tools.ts";
import type { McpService } from "./plugins/mcp.ts";
import type { ChatService } from "./plugins/chat.ts";
import type { MemoryService } from "./plugins/memory.ts";
import type { ServerService } from "./plugins/server.ts";

declare module "cordis" {
  interface Context {
    store: StoreService;
    oauth: OAuthService;
    llm: LlmService;
    tools: ToolsService;
    mcp: McpService;
    chat: ChatService;
    memory: MemoryService;
    server: ServerService;
  }

  interface Events {
    "guild/listening"(info: {
      host: string;
      port: number;
      dataDir: string;
    }): void;
    "guild/turn-complete"(turn: {
      roomId: string;
      botId: string;
      userText: string;
      reply: string;
    }): void;
  }
}
```

No other events in v1.

---

## Services

Only replaceable or disable-able capabilities live on `ctx`. Adapters wrap existing modules; they do not rewrite algorithms.

| Key | Existing code it wraps | `inject` | Optional via `ctx.get` | YAML may `disabled: true` |
|---|---|---|---|---|
| `store` | `GuildStore` in `store.ts` | — | — | no |
| `oauth` | `oauth.ts` | `['store']` | — | yes |
| `llm` | `llm.ts` (`models.json` + `llmComplete`) | `['store']` | `oauth` | no |
| `mcp` | `mcp.ts` | `['store']` | — | yes |
| `tools` | `tools.ts` | `['store']` | `mcp` | no |
| `chat` | `generate.ts` (`chatReply`, `generateMarkdown`) | `['store','llm','tools']` | — | no |
| `memory` | `memory.ts` harvest | `['store','llm']` | — | yes |
| `server` | `server.ts` + static + route table | — | — | no |

`api` is a plugin with no service key. It `inject`s `['server','store','chat','llm']` and uses `ctx.get('oauth')`, `ctx.get('mcp')`, `ctx.get('memory')`. It is the new home of `router.ts` / `handlers.ts` wiring: handlers receive `ctx` (or destructured services) instead of only `GuildStore`.

Hard `inject` is only for services that must exist or the plugin must stay PENDING. Optional plugins (`oauth`, `mcp`, `memory`) are never listed in another plugin's `inject`.

### Service APIs (minimum)

These are the methods other plugins may call. Extra helpers can stay as module-level functions.

**`ctx.store`**

- Expose the current `GuildStore` instance (or the same public methods: `listBots`, `getBot`, `appendMessage`, `listMessages`, `dataDir`, live-turn helpers, …).
- Construction: `new GuildStore(dataDir)` with `dataDir` from config precedence.

**`ctx.oauth`**

- The current `startLogin` / `pollLogin` / `completeLogin` / `logoutOAuth` / `listSubscriptions` / `storedAccessToken`, with `dataDir` taken from `ctx.store.dataDir`.

**`ctx.llm`**

- `readModels()` / `mergeModels()` / `publicModels(env)` — current `llm.ts` catalog.
- `resolve(env, role?, prefer?)` — current `resolveLlm`.
- `complete(input)` — current `llmComplete`, but `dataDir` comes from `ctx.store`; do not make callers pass `dataDir` once the adapter exists.

**`ctx.tools`**

- `execute(name, args, toolCtx)` — current `executeTool` / `executeToolTraced`.
- When building the tool list, if `ctx.get('mcp')` is defined, include MCP tool refs; otherwise omit them.

**`ctx.mcp`**

- Current `listGuildMcp` / `listHostMcp` / `upsertGuildMcp` / `importHostMcp` / `removeGuildMcp` / `listMcpToolRefs` / `callMcpTool`.

**`ctx.chat`**

- `reply(...)` — current `chatReply`.
- `generate(kind, prompt)` — current `generateMarkdown`.
- After a successful bot reply that came from a room turn, `ctx.emit('guild/turn-complete', …)`.

**`ctx.memory`**

- `ctx.on('guild/turn-complete', …)` → current `harvestBotMemory` / `harvestChannelMemory`.
- File GET/PUT for memory remains store/API; this plugin is harvest only.

**`ctx.server`**

- `node: http.Server`
- `host: string`, `port: number` (filled after listen)
- `whenListening(): Promise<{ host: string; port: number; dataDir: string }>` — a promise created before `listen`, resolved in the listen callback. Callers must not rely on subscribing to `guild/listening` after plugins are already ACTIVE (they would miss the event). `startGuildDaemon` and tests use `whenListening()`. The event is still emitted for other plugins.
- `route(method, pathPattern, handler)` or equivalent: enough for `api` to register the current REST table as effects. Unregister on dispose.
- Request dispatch: first static `PAGES` / favicon / `/generated/`, then registered routes, then the current 404 JSON `{ error: "not_found", path }`.

Keep CORS and OPTIONS behavior from `router.ts`.

### `cordis.yml`

Path: `packages/daemon/cordis.yml`.

```yaml
- id: logger
  name: '@cordisjs/plugin-logger-console'
- id: timer
  name: '@cordisjs/plugin-timer'
- id: store
  name: './src/plugins/store.ts'
- id: oauth
  name: './src/plugins/oauth.ts'
- id: llm
  name: './src/plugins/llm.ts'
- id: tools
  name: './src/plugins/tools.ts'
- id: mcp
  name: './src/plugins/mcp.ts'
- id: memory
  name: './src/plugins/memory.ts'
- id: chat
  name: './src/plugins/chat.ts'
- id: server
  name: './src/plugins/server.ts'
- id: api
  name: './src/plugins/api.ts'
```

Every entry has a stable `id`. Loader diffs by `id`; missing ids remount on every YAML edit.

v1 plugins do **not** export a `Config` schema. Optional plugins (`oauth`, `mcp`, `memory`) stay out of hard `inject` so YAML `disabled: true` unloads them. Required vs optional is the table above.

---

## Data flow

### Boot

```text
cli → startGuildDaemon
        Context
          Loader
          Include(cordis.yml)
            store → oauth, llm, tools, mcp, memory
            llm + tools → chat
            server → api
        server.listen
        emit guild/listening
        stdout JSON line
```

Fibers start concurrently. `chat` stays PENDING until `store`, `llm`, and `tools` are ACTIVE. `api` stays PENDING until `server`, `store`, `chat`, `llm` are ACTIVE.

### `POST` a channel message that `@pm`

1. `api` route → existing `postUserMessage` logic.
2. `ctx.store.appendMessage` (user).
3. Trajectory user event written synchronously (unchanged; not an event listener).
4. Mention resolution (plain import of `mention.ts`) picks bots; `@channel` still pings everyone.
5. For each summoned bot, `ctx.chat.reply(...)`.
6. `chat` builds the system prompt the same way (`buildChatSystem`), then `ctx.llm.complete` with `ctx.tools`.
7. Tools: `run` / `write` / `skill` / `spawn` as today. MCP tools only if `ctx.get('mcp')` exists.
8. Bot reply appended on `ctx.store`. Live-turn / abort / steer stay on `GuildStore`.
9. `ctx.emit('guild/turn-complete', { roomId, botId, userText, reply })`.
10. If `memory` is loaded, it harvests. If disabled, step 9 is a no-op for listeners.

No model configured: same local ack string as `localChatReply` today. HTTP 200, not 5xx.

### Disable MCP

YAML `id: mcp` → `disabled: true` (or omit the entry). `tools` still loads. Chat has no `mcp__*` tools. Existing routes:

- `GET /mcp/servers` → `[]` (200) so Workshop still renders.
- `GET /mcp/host` → unchanged host-file listing (read-only, no Guild MCP process).
- `POST /mcp/servers`, `POST /mcp/import`, `DELETE /mcp/servers/:name` → `503` `{ error: "mcp_disabled" }`.

### Disable memory

Harvest does not run. `GET`/`PUT` bot and channel memory files still work through `store` + `api`.

### Disable oauth

- `GET /settings/oauth` → `[]` (200) so Settings still renders.
- `POST /settings/oauth/:id/login|poll|complete|logout` → `503` `{ error: "oauth_disabled" }`.
- `ctx.llm` resolves API keys and env fallbacks only.

---

## Error handling

| Failure | Behavior |
|---|---|
| Invalid `GUILD_PORT` | Throw before Context plugins (same message as today). |
| Required plugin `FAILED` (bad Config, throw in `apply`) | `startGuildDaemon` rejects; no `listening` line; process `exitCode = 1`. |
| Optional plugin `FAILED` | Log via `ctx.logger`; boot continues. |
| `store` cannot create `dataDir` | Throw; boot fails (required). |
| HTTP listen `EADDRINUSE` | Reject `startGuildDaemon` (same as today's `server.once('error')`). |
| `StoreError(status, message)` | Unchanged JSON error mapping in the router. |
| LLM / tool throw mid-turn | Unchanged: current handler catch + error message on the bot reply. Do not dispose the whole Context. |
| MCP child crash mid-call | Unchanged `mcp.ts` error; do not unload the mcp plugin. |
| Plugin unload / dispose | Reverse effects: routes gone, server closed, MCP children killed. In-flight HTTP requests may end aborted; acceptable. |

Do not add a global error event. Do not swallow required-plugin failures.

Timeout waiting for `ctx.server.whenListening()`: 10 seconds, throw `guildd did not listen`. This catches a composition that left `server` PENDING (missing inject). If `ctx.server` is missing after 10s, throw the same error.

---

## Testing

Existing daemon tests (`packages/daemon/test/*.test.ts`) stay the contract. They currently call `createGuildServer({ dataDir })`. There is no second HTTP stack that bypasses plugins. One listen helper, used by every HTTP test:

```ts
async function listen(dataDir: string, env: NodeJS.ProcessEnv = {}) {
  const ctx = await createGuildContext({
    ...process.env,
    ...env,
    GUILD_HOME: dataDir,
    GUILD_HOST: "127.0.0.1",
    GUILD_PORT: "0",
  });
  return {
    ctx,
    server: ctx.server.node,
    origin: `http://127.0.0.1:${ctx.server.port}`,
  };
}
```

`createGuildServer` is removed once tests use this helper. `listenGuildServer` may remain as a private function inside the server plugin.

Add tests (node:test, same style as `http.test.ts`):

1. **Health through loader** — `listen(tempHome())` → `GET /health` → current payload.
2. **Listening JSON** — spawn CLI with `GUILD_HOME` + `GUILD_PORT=0` (existing spawn test if any) still parses `service: "guildd"`.
3. **MCP disabled** — `createGuildContext` with Include `patches` (or a temp yml) setting `id: mcp` `disabled: true`; chat local ack still 200; `POST /mcp/servers` → 503 `mcp_disabled`; `GET /mcp/servers` → `[]`.
4. **Dispose** — after `await ctx.fiber.dispose()`, the bound port refuses connections.
5. **Required plugin missing** — composition without `store` (test-only yml) → `createGuildContext` / `startGuildDaemon` throws `guildd did not listen`, no successful `/health`.

Do not test HMR. Do not require a running LLM for the new tests.

`pnpm test` remains `pnpm --filter @guild/daemon test`. All existing cases must pass.

---

## Files

| Path | Change |
|---|---|
| `packages/daemon/package.json` | Add Cordis deps; keep bin name `guildd` |
| `packages/daemon/cordis.yml` | New composition file |
| `packages/daemon/src/cordis.d.ts` | Module augmentation |
| `packages/daemon/src/plugins/*.ts` | Adapters listed in YAML |
| `packages/daemon/src/start.ts` | Context bootstrap |
| `packages/daemon/src/cli.ts` | SIGINT/SIGTERM dispose |
| `packages/daemon/src/server.ts` | Become implementation behind `ServerService`, or merge into the plugin |
| `packages/daemon/src/router.ts` / `handlers.ts` | Take `ctx`; stop importing `GuildStore` as the only bag |
| `packages/daemon/src/index.ts` | Export `createGuildContext`; keep `startGuildDaemon` |
| `packages/daemon/test/*.test.ts` | Switch listen helper |
| Root `package.json` scripts | Unchanged (`pnpm --filter @guild/daemon …`) |
| README / CONTRIBUTING | Note: daemon is a Cordis app; config file `packages/daemon/cordis.yml`; `GUILD_*` still wins. One short paragraph, not a rewrite. |

Leave `docs/2026-08-23-guild-design.md` as the later-product target (Codex sidecar, Tauri, board). This spec does not implement that document.

---

## Compatibility checklist

Must remain true after the rewrite:

- `GET /health` body unchanged.
- Default listen `127.0.0.1:7420`.
- Data in `GUILD_HOME` / `~/.guild`: `guild.sqlite` for rooms / messages / trajectory; `bots/`, `library/`, `rooms/` markdown, `models.json`, `mcp.json`, `oauth.json` still files.
- Default five bots still seeded.
- Static routes in the current `PAGES` map still 200.
- `@mention` / `@channel` / reply-to / steer / abort live turn unchanged.
- Default `run` / `write` still unsandboxed (`GUILD_SANDBOX` unset = `full_access`) unless POSITION.md has `sandbox:`. Optional tool gate is not a kernel sandbox. SECURITY.md still accurate.
- `service: "guildd"` in health and the stdout listen line.

---

## Open choices (locked here, not later)

| Choice | Lock |
|---|---|
| Cordis package | Official `cordis@4.0.0-rc.8`, not `@deepseek-ai/cordis` |
| Composition | Loader + `packages/daemon/cordis.yml` |
| HTTP | Existing `node:http`, service key `server` |
| HMR | **Not shipped.** No YAML entry, no package |
| Optional MCP when disabled | `GET /mcp/servers` empty 200; `POST /mcp/servers`, import, DELETE → 503 `mcp_disabled`; `GET /mcp/host` stays |
| Memory when disabled | No harvest; file CRUD stays |
| Trajectory | Synchronous in the message path, not an event |
| Handlers | Tests boot the real Context; no bypass `createGuildServer`. Handlers still take `GuildStore` + extras flags |
| `startGuildDaemon` return | `{ server, ctx }` so CLI can `ctx.fiber.dispose()` |
| OAuth when disabled | `GET /settings/oauth` empty 200; mutating POSTs 503 `oauth_disabled` |
