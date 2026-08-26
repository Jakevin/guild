# Guild — AI Bot 人材庫與專案團隊

| Field | Value |
|---|---|
| Status | Draft (kernel: Codex, 2026-08-23) |
| Date | 2026-08-23 |
| Repo | `bot` |
| Kernel | [openai/codex](https://github.com/openai/codex) **app-server** as execution harness, not a fork |
| Product | Guild owns roster, library, staffing, board, project memory |
| Audience | Implementers of the first vertical slice |
| Related | [`2026-08-23-codex-harness-addendum.md`](./2026-08-23-codex-harness-addendum.md) |

---

## Overview

Guild is a **local-first desktop app** for staffing a persistent **talent pool of bots** onto **projects**. Each bot is a person-shaped agent: it selects a Soul, an Agent template, Skills, and a Position. Each bot has private memory. Each project has its own skills, conventions, and memory. Work moves through a **staffed team + task board + structured handoff**, not a single shared chat with one agent, and not an ephemeral CrewAI-style crew that evaporates after a run.

OpenAI's Codex harness (Apache-2.0, Rust) is the per-bot execution kernel: agent loop, tools, sandbox, approvals, threads, compaction, skills, and a two-phase memory pipeline. Guild does **not** vendor `codex-rs`. It talks to a pinned `codex app-server` over JSON-RPC (Thread / Turn / Item) and isolates each bot with its own `CODEX_HOME`.

This matches OpenAI's own split ([Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)): the application owns the interface, business rules, and consent; the harness owns the loop and sandboxed execution. Their example — a task board that starts a scoped implementation when a card moves to ready — is Guild.

```text
Human
  │
  ▼
Guild App (Tauri 2)  ──WS/HTTP──►  guildd (Node 22)
                                      │
                                      ├─ Roster / Library / Projects / Tasks
                                      ├─ Project memory (SQLite + sqlite-vec + FTS5)
                                      ├─ Guild MCP (handoff, task_*, memory_search)
                                      └─ Supervisor
                                            │  one app-server process per running bot
                                            ▼
                                      codex app-server
                                      CODEX_HOME = ~/.guild/bots/{id}/codex-home/
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                         Project FS     Codex tools    Host OS
                         (cwd)          + Guild MCP    (sandbox + approval)
```

A `Harness` trait exists so a second backend (Pi SDK) can be added later for non-OpenAI models. v1 implements Codex only.

---

## Background & Motivation

### What Codex is — and is not

Codex is an **open agent harness**, not a team product.

| Codex primitive | Behavior today | Guild problem / use |
|---|---|---|
| One ChatGPT-shaped agent | One identity, one `~/.codex` | Cannot staff a bench of specialists |
| `CODEX_HOME` | Global skills, AGENTS.md, memories | **Isolation lever**: one home per bot |
| Custom agents (`~/.codex/agents/*.toml`) | Ephemeral spawn recipes for a parent thread | Position-shaped workers *inside* a task, not employees |
| Subagent | Child of one turn; **skipped by the memory pipeline** | Never a Guild Bot |
| Guardian review | First-class thread *source* (2026-08-23) | Reviewer position |
| Collaboration mode | Plan vs Default (mutate or not) | Lead planning, not a team |
| `agent-identity` crate | Cryptographic ChatGPT runtime (ed25519 / JWT) | Ignore in v1; not a Soul |
| Memories | Two-phase extract → consolidate under `CODEX_HOME/memories/` | Bot-private if home is per-bot |
| app-server | Thread / Turn / Item, approvals, sandbox | Embed surface for the desktop |
| Sandbox | `read_only` / `workspace_write` / `full_access` | Map from Position + project trust |

Pi remains the better *multi-provider* minimal loop (30+ providers, `ResourceLoader`). We evaluated it first, then switched the kernel after Codex published the harness as a platform and shipped Guardian-vs-subagent, memory consolidation, and typed content fragments. See the addendum.

### What existing "multi-agent" products miss

| Product | Model | Gap |
|---|---|---|
| ChatGPT / Claude Projects | One assistant, shared project files | No talent, no positions, no parallel staffed work |
| OpenClaw | Persistent personal agent + `SOUL.md` | One workspace identity, not a bench |
| CrewAI / AutoGen | Ephemeral crew for a task | No durable people, no per-bot memory |
| Codex custom agents | Spawn configs under one parent | No bench, no private career, no project company |
| LangGraph | Workflow graph | Orchestration without HR |
| Cursor / Claude Code / Pi CLI | One coding agent in a repo | One body, shared skills |

Guild's unit of value is **the employee**, not the chat thread and not the subagent.

---

## Goals & Non-Goals

### Goals (v1)

1. Persistent **talent pool**: create / edit / bench / retire bots.
2. First-class **library**: Soul, Agent template, Skill, Position — bots *select*, they do not own a private fork by default.
3. **Project** as a company: workspace path, project `AGENTS.md`, project skills, project memory, staffed members.
4. **Staffing**: assign bot × position × (optional skill overrides) onto a project.
5. **Task board** as the work engine; chat is a view, not the source of truth.
6. Each bot has private memory (Codex pipeline in that bot's `CODEX_HOME`); each project has shared memory (Guild); retrieval is scoped.
7. Web interaction via Codex browser tools if available, else Playwright. OS via Codex sandbox + approval.
8. Local-first, single user, macOS first. Offline except LLM/embeddings.

### Non-Goals (v1)

- Multi-user SaaS, team accounts, billing.
- Fully autonomous "agents debate until done" swarms.
- Vendoring `codex-rs` or forking Pi.
- Treating Codex subagents as the talent pool.
- Full computer-use (mouse/keyboard on arbitrary GUI apps) as a v1 requirement.
- Mobile clients.
- Marketplace / cloud skill registry.
- Shipping a second harness (Pi) in v1 — the trait exists, the adapter does not.

---

## Product Model

### Four library objects a bot selects

These are **files on disk** (git-friendly, Agent Skills compatible) plus a SQLite index.

| Object | File | Question it answers | Changes how often |
|---|---|---|---|
| **Soul** | `SOUL.md` | Who are you? Voice, values, taste, boundaries. | Rarely |
| **Agent** | `AGENTS.md` | How do you work? SOP, tool habits, quality bar. | Occasionally |
| **Skill** | `SKILL.md` (+ scripts) | What can you do on demand? Agent Skills spec. | Per capability |
| **Position** | `POSITION.md` | What is your job *on this project*? Duties, DoD, reporting line, sandbox, approval. | Per staffing |

A fifth file exists but is not "selected": **`IDENTITY.md`** (name, avatar, one-liner). Stored on the bot row, not in the shared library.

Pinning: default is **live reference** to the library object. A bot (or a project assignment) may **pin a content hash** or **fork** a private copy into `bots/{id}/overrides/`.

### Bot (talent)

```text
Bot
  identity         name, handle, avatar, one-liner
  soul             → library Soul (required)
  agent            → library Agent template (required)
  skills[]         → library Skills (ordered, capped)
  default_position → library Position
  model            optional; else project/Codex default
  status           bench | staffed | running | retired
  codex_home       ~/.guild/bots/{id}/codex-home/   (generated)
  memory           Codex memories/ under that home + Guild archival index
```

Two bots on the same project are two app-server processes (or two threads only if per-thread `CODEX_HOME` is proven). They never share a skill catalog or a memory store.

### Project

```text
Project
  workspace       absolute path (cwd every staffed bot receives)
  AGENTS.md       project conventions (injected as a content-kind fragment)
  skills[]        project-only skills, unioned into that bot's home for the run
  memory          shared Guild project memory
  members[]       { bot_id, position_id, skill_overrides[], model_override? }
  board           tasks
  trust           host | sandbox
```

### Position → Codex policy

Position turns a personality into a job. Same Soul can be Engineer on A and Reviewer on B.

| Position | Sandbox | Approval | Thread source | Notes |
|---|---|---|---|---|
| Lead | `read_only` | on writes via Guild MCP only | normal | `task_*` / `handoff` through Guild MCP; no workspace mutate |
| Engineer | `workspace_write` | confirm outside workspace | normal | default implementer |
| Reviewer | `read_only` | n/a | `guardian_review` | sees artifacts + diff, not implementer MEMORY.md |
| Researcher | `read_only` | confirm network | normal | browser + search |
| Operator | `workspace_write` | confirm network / deploy | normal | |
| Designer | `workspace_write` | confirm | normal | |
| QA | `workspace_write` | confirm | normal | tests may write |

Position also sets: definition of done, who they hand off to, `max_parallel_tasks` (default 1), whether they may spawn **Codex subagents** for read-heavy splits inside their own task (default off except Engineer/QA).

### Work engine: tasks, not group chat

1. Human (or Lead) creates a project, staffs bots, writes a goal.
2. Lead decomposes into tasks (`inbox → doing → review → done`).
3. Each task has **one assignee bot**. Optional `reviewer_bot_id`.
4. Start → supervisor materializes that bot's `CODEX_HOME`, starts app-server, `thread/start` + `turn/start`.
5. Bot works under Codex sandbox. Guild MCP tools update the board (`task_update`, `handoff`).
6. Reviewer bot starts a `guardian_review` thread scoped to the diff.
7. Handoffs are typed records.

**War room** is a secondary event stream (`task.moved`, `handoff`, `ask`, `blocker`, `note`). Bots post only via tools. Free-form multi-bot debate is opt-in, default off.

Codex subagents may run *inside* one assignee's task for parallel read-only exploration. They are not staffed, not remembered, not on the bench.

---

## How Guild uses Codex (do not vendor)

### Isolation contract

For a run `(bot, project, task)`:

| Codex knob | Guild value |
|---|---|
| Process | One `codex app-server` per **running** bot (hard isolation of `CODEX_HOME`). Revisit if per-thread home lands in stable API. |
| `CODEX_HOME` | `~/.guild/bots/{bot_id}/codex-home/` — never the user's `~/.codex` |
| `cwd` | `project.workspace` |
| `auth.json` | Symlink to `~/.guild/codex-auth/auth.json` (one ChatGPT/API login for the human) |
| `AGENTS.md` in home | Copy/symlink of selected Agent template |
| `config.toml` `skills.config` | Allowlist = bot.skills ∪ project.skills ∪ position.suggested |
| `memories` feature | **on** for this home (bot-private). Subagent children stay off (Codex already skips them). |
| Sandbox / approval | From Position ∩ project trust |
| `thread/start` extras | `cwd`; experimental `projectId` if stable; prompt fragments with **content kinds** |
| Fragments | IDENTITY, SOUL, POSITION, project AGENTS.md, Guild kernel, project core-memory excerpt |
| Thread source | `guardian_review` iff Position is Reviewer |
| MCP | Guild server (board + project memory) + optional project MCP if `trust=host` |
| Model | Bot override → project default → Codex logged-in default |

Factory test (must not regress): two bots with disjoint skills; assert each app-server skill index does not contain the other's skills; assert bot B cannot read bot A's `memories/`.

### Prompt composition (content kinds)

Injected as typed fragments (Codex 2026-08-23: user input and extension fragments require content kinds), not one concatenated soup:

```text
1. Guild kernel          staffed role, handoff protocol, MCP tools
2. IDENTITY.md           bot
3. SOUL.md               library — never truncated without a UI warning
4. Agent AGENTS.md       how this person works (also on disk in CODEX_HOME)
5. POSITION.md           this assignment + sandbox expectations
6. Project AGENTS.md     how this company works
7. Project MEMORY.md     budgeted tail (Guild-owned)
8. Bot memories          Codex injects from this home automatically
9. Skills index          Codex progressive disclosure of the allowlist
```

### Supervisor

`guildd` is a Node 22 process (Guild domain). Codex is a **sidecar binary**.

- Pin Codex CLI version in `package.json` / Tauri sidecar (exact version, like Pi pins npm).
- `maxConcurrentBots` default 3; extra tasks queue on `runs`.
- On start: materialize home → spawn `codex app-server --listen stdio://` (or unix socket) → `initialize` as client `guild` → `thread/start` / `thread/resume`.
- Stream `item/*` and `turn/*` over WS `run.{id}`.
- Map Codex approval requests to the desktop modal.
- On abort: `turn/interrupt`; on archive: shut down descendants (Codex already does this when archiving thread trees).
- On settle: persist thread id on `runs`; do **not** invent a second session JSONL format.

Do not embed `codex-rs` as a crate in v1. Consume the released CLI + `codex app-server generate-ts` schema.

### Guild MCP (application-owned tools)

Codex should not learn our board by prompt-only. Expose:

| Tool | Who |
|---|---|
| `task_update` | assignee |
| `handoff` | assignee |
| `ask_teammate` | assignee |
| `board_list` | Lead |
| `memory_search` | all; scoped bot-self + current project |
| `memory_write` | all; project scope writes Guild store; bot-core prefers Codex memories |

### Harness trait (v1 Codex only)

```ts
interface Harness {
  startRun(ctx: RunContext): Promise<RunHandle>;
}
// RunContext: { bot, project, position, task, fragments, sandbox, approval }
// RunHandle: { events: AsyncIterable<GuildEvent>, interrupt(), dispose() }
```

`CodexHarness` is the v1 implementation. `PiHarness` is a later adapter, not scheduled.

---

## Tech Stack (committed)

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Agent kernel | **Pinned `codex` CLI + app-server JSON-RPC** | Sandbox, approvals, threads, memory, Guardian; designed to be embedded | Vendor `codex-rs`; fork Pi; LangGraph; CrewAI |
| Second harness | Trait only | Pi is the multi-provider escape hatch | Shipping two kernels in v1 |
| Daemon | **TypeScript, Node ≥ 22** (`guildd`) | Roster/board/SQLite/WS iterate faster than rewriting in Rust | Python; all-Rust guildd in v1 |
| Codex sidecar | Official binary (macOS arm64 first) | Don't compile 100 crates ourselves | Building `codex-rs` from source in CI for v1 |
| Desktop | **Tauri 2** + system webview | Native shell, keychain, fits `RustPrj` | Electron; pure web |
| UI | **React 19 + Vite + Tailwind v4 + shadcn/ui** | Streaming run view, board | Next.js SSR |
| IPC | `127.0.0.1` HTTP + WebSocket + nonce | Dev without Tauri | Tauri-invoke-only; gRPC |
| DB | **SQLite WAL** + Drizzle | Local-first | Postgres; Turso rewrite |
| Vectors / keyword | **sqlite-vec + FTS5** | Project archival hybrid search | Qdrant; Mem0 |
| Bot memory | **Codex memories under per-bot `CODEX_HOME`** | They already extract + consolidate `MEMORY.md` | Homegrown settle extractor for bot-core |
| Project memory | Guild files + sqlite-vec | Codex store is per-home, not per-project | One global `~/.codex/memories` |
| Embeddings | OpenAI `text-embedding-3-small` (same login); Ollama fallback | Don't block v1 | Always-local-only |
| Browser | Codex browser if present; else **Playwright a11y** as Guild MCP | Don't duplicate if harness ships it | Browser Use; Stagehand as default |
| OS | Codex sandbox + approval | We no longer build `beforeToolCall` as v1 | nut.js / Computer Use in v1 |
| Extra jail | `trust=sandbox` still may wrap the sidecar in Docker later | Untrusted repos | Always-VM |
| Jobs | SQLite `runs` + supervisor | One user | Redis |
| Auth | ChatGPT login / API key in `~/.guild/codex-auth` | One human identity, many bots | Per-bot OpenAI accounts |
| Packaging | Tauri + Node sidecar + Codex sidecar | Two sidecars, both pinned | "Install Node and Codex yourself" |
| Monorepo | **pnpm workspaces** | Guild is TS; Codex is a binary | Cargo workspace as primary |
| Lint/test | Biome + Vitest; `cargo test` for Tauri | | |

### Why still a TS daemon if the kernel is Rust

Codex *is* the Rust agent loop. Rewriting Guild's HR/board in Rust before we have a staffed team ships nothing. SQLite schema is language-agnostic. If `guildd` becomes a bottleneck, replace it without migrating data.

### Why not Electron

Same as before: privilege surface, `RustPrj`, UI is not VS Code. Dev loop: Vite `:5173` → `guildd` `:7420`.

---

## Repository layout

```text
bot/
  apps/
    desktop/                 # Tauri 2 + React
      src-tauri/
      src/
  packages/
    protocol/                # Zod: REST + WS + GuildEvent (Codex items mapped)
    domain/                  # compose fragments, staffing, position→sandbox
    db/                      # Drizzle
    memory/                  # project archival (vec + FTS); bot-core is Codex
    codex-host/              # spawn app-server, CODEX_HOME materializer, JSON-RPC
    mcp-guild/               # Guild MCP server
    daemon/                  # HTTP/WS + supervisor
    fixtures/                # default library
  docs/
  pnpm-workspace.yaml
```

Data on disk:

```text
~/.guild/
  config.json
  codex-auth/                # human login; auth.json symlinked into each bot home
  guild.db
  library/
    souls/<id>/SOUL.md
    agents/<id>/AGENTS.md
    skills/<id>/SKILL.md
    positions/<id>/POSITION.md
  bots/<bot_id>/
    IDENTITY.md
    overrides/
    codex-home/              # CODEX_HOME for this bot only
      AGENTS.md              # materialized Agent template
      config.toml            # skills allowlist, memories on, model
      auth.json → ../../codex-auth/auth.json
      memories/              # Codex pipeline (private)
      agents/                # optional spawn recipes (not the Bot itself)
  projects/<project_id>/
    AGENTS.md
    memory/MEMORY.md
    skills/
  profiles/<project_id>/chromium/
```

User project workspace stays at `~/code/foo`. Guild never copies the repo.

---

## Data Model

SQLite is the index. Markdown files are the documents. Codex owns thread persistence inside each `CODEX_HOME`; we store the thread id.

```sql
souls (id TEXT PK, slug, name, path, hash, created_at, updated_at)
agent_templates (id, slug, name, path, hash, ...)
skills (id, slug, name, description, path, source, hash, ...)
positions (
  id, slug, name, path,
  sandbox TEXT CHECK (sandbox IN ('read_only','workspace_write','full_access')),
  approval_json,
  thread_source TEXT,          -- 'normal' | 'guardian_review'
  suggested_skill_ids_json,
  max_parallel_tasks INTEGER DEFAULT 1,
  allow_subagents INTEGER DEFAULT 0
)

bots (
  id, handle UNIQUE, name, avatar_path, one_liner,
  soul_id NOT NULL REFERENCES souls(id),
  agent_template_id NOT NULL REFERENCES agent_templates(id),
  default_position_id REFERENCES positions(id),
  model_provider, model_id, thinking_level,
  status TEXT CHECK (status IN ('bench','staffed','running','retired')),
  created_at, updated_at
)
bot_skills (bot_id, skill_id, ordinal, PRIMARY KEY (bot_id, skill_id))

projects (
  id, name, workspace_path, trust TEXT CHECK (trust IN ('host','sandbox')),
  default_model_provider, default_model_id,
  status TEXT CHECK (status IN ('active','archived')),
  created_at
)
project_skills (project_id, skill_id, PRIMARY KEY (project_id, skill_id))
project_members (
  project_id, bot_id,
  position_id NOT NULL,
  skill_overrides_json,
  model_override_json,
  PRIMARY KEY (project_id, bot_id)
)

tasks (
  id, project_id, title, body,
  status TEXT CHECK (status IN ('inbox','doing','review','done','blocked')),
  assignee_bot_id, reviewer_bot_id,
  parent_id,
  artifact_paths_json,
  created_at, updated_at
)

runs (
  id, task_id, bot_id,
  thread_id TEXT,              -- Codex thread id
  state TEXT CHECK (state IN ('queued','running','settled','failed','aborted')),
  started_at, settled_at, error
)

memories (
  id TEXT PK,
  scope TEXT CHECK (scope IN ('bot','project','user')),
  scope_id TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('semantic','episodic','procedural')),
  text TEXT NOT NULL,
  source_run_id, source_path,
  created_at
);
-- mem_vec (sqlite-vec), mem_fts (FTS5) as in the original schema

events (
  id, project_id, task_id, actor_type, actor_id,
  kind TEXT, payload_json, created_at
)
```

---

## Memory

| Tier | Store | Who writes | Who reads |
|---|---|---|---|
| **Bot core** | Codex `CODEX_HOME/memories/` (`MEMORY.md` after Phase 2) | Codex Phase 1/2 (enabled per bot home) | Codex injects on session start |
| **Project core** | `projects/{id}/memory/MEMORY.md` | Guild `memory_write` + human | Injected as a fragment every turn |
| **Episodic** | Codex thread (app-server) | Codex | Run view; `thread/resume` |
| **Archival** | Guild `memories` + sqlite-vec + FTS5 | `memory_write` + optional import from Phase-1 slugs | `memory_search` MCP |

Scoping: a bot may search `scope=bot/self`, `scope=project/current`, later `scope=user`. Never another bot's `codex-home/memories/`. Reviewer threads do not mount the implementer's home.

Core project writes still default to a **review tray** in the UI. Bot-core follows Codex's own generate/use flags in that home's `config.toml` (`memories.generate_memories`, `memories.use_memories`).

We do not run Mem0 / Letta / Graphiti. Codex already did the "filesystem MEMORY.md" work for the bot; Guild only adds project-scoped hybrid search.

---

## Team protocol

Staffing, handoff JSON, `ask_teammate` defaults, and Lead semantics are unchanged from the first draft.

Start path:

1. Assert membership + position + bot not retired.
2. Insert `runs` queued; wait for a worker slot.
3. Materialize `CODEX_HOME` (AGENTS.md, skills allowlist, memories on, auth symlink).
4. Spawn app-server; `initialize` (`clientInfo.name = "guild"`).
5. `thread/start` or `thread/resume`; `turn/start` with fragments + task body + recent handoffs + `memory_search` hits (k=6).
6. Stream items to `run.{id}`; approvals to the modal.
7. On `turn/completed` / interrupt: update `runs`.

Parallelism: one assignee per task. Two bots on one git repo: v1 documents "don't collide"; v1.1 uses Codex's **git worktree** env per running bot. Advisory `file_locks` in SQLite remain as a belt.

---

## Web & OS

**Web:** Prefer Codex's own browser if the pinned CLI exposes it. Otherwise Guild MCP Playwright (`browser_open` / `snapshot` / `act`), one Chromium profile per *project*.

**OS:** Codex sandbox + approval. Position maps to preset. Confirm modal = app-server approval requests, not a custom `beforeToolCall`.

`trust=sandbox` (later PR): run the **sidecar** in Docker with workspace + that bot's `codex-home/memories` mounted; auth stays on the host. LLM traffic uses the host login. v1 ships `trust=host` + Codex sandbox first.

Later: computer-use / osascript as a Skill, not builtins.

---

## API surface

REST + WS on `127.0.0.1`, bearer = nonce. UI never talks to Codex directly.

```text
CRUD        /library/*  /bots  /projects  /tasks
POST        /tasks/:id/start | /pause | /abort | /handoff
GET/POST    /memory
WS          /ws
  → subscribe run.{id} | project.{id}
  ← mapped GuildEvent (text delta, tool, turn completed, approval)
  ↔ approval.respond
```

---

## UI surfaces

1. Bench — talent cards.
2. Bot Studio — Soul / Agent / Skills / Position; peek that bot's Codex `MEMORY.md`.
3. Library — markdown CRUD; import `SKILL.md`.
4. Projects — workspace picker, staffing matrix.
5. Project Room — board + war room + transcript (Codex items).
6. Run view — streaming + approval modal.
7. Memory — project core + archival search; bot core as read-only files.

Visual language: studio / consultancy, not a chat app that hides the org chart.

---

## Security & Privacy

Threat model: local malware and prompt injection, not multi-tenant attackers.

| Risk | Mitigation |
|---|---|
| Prompt injection from the web | a11y snapshots; eval gated; untrusted wrapper on external tool text |
| Untrusted repo AGENTS.md / skills | project trust; `trust=sandbox` ignores project MCP |
| Shared global skills | never use `~/.codex` or `~/.pi`; per-bot home + allowlist |
| Cross-bot memory | separate homes; reviewer doesn't mount implementer home |
| Secrets in shell | Codex approval + sandbox; keys in `codex-auth` + OS keychain |
| Daemon on LAN | 127.0.0.1 + 0600 nonce |
| Supply chain | Pin Codex CLI + npm deps; review upgrades; don't vendor `codex-rs` |
| OpenAI gravity | Harness trait; v1 accepts ChatGPT/API/Bedrock/Ollama that Codex already speaks |

---

## Observability

- `runs` row + Codex thread id (usage comes from `turn/completed`).
- `pino` JSON to `~/.guild/logs/`.
- UI footer: tokens/cost per bot and per project.
- No Guild telemetry. Disable Codex install telemetry if a flag exists.

Targets: board p95 < 50ms; `memory_search` p95 < 200ms at 100k chunks; Guild overhead to first event < 100ms after app-server is warm; 3 concurrent bots on an M-series Mac.

---

## Key Decisions

1. **Embed Codex app-server, do not vendor `codex-rs`.** The expensive harness (sandbox, approvals, threads, memory, Guardian) is already open. Pin the CLI.
2. **Per-bot `CODEX_HOME` is the isolation mechanism.** Replaces Pi `ResourceLoader`. Never scan `~/.codex`.
3. **Talent + staffing + tasks, not group chat and not Codex subagents.** Subagents are intra-task workers; Bots are employees.
4. **Soul / Agent / Skill / Position are a library, referenced live.** Materialized into the home at run start.
5. **Position maps to sandbox + approval + thread source.** Reviewer = `guardian_review` + `read_only`.
6. **Guild MCP owns the board.** Handoff and task updates are tools, not prose.
7. **Split memory: Codex for bot-core, Guild for project + archival search.**
8. **TypeScript `guildd` + Tauri + Codex sidecar.** Don't rewrite the product layer in Rust for v1.
9. **SQLite + sqlite-vec + FTS5 as the only Guild database.**
10. **One assignee per task.** Parallelism is across tasks; optional read-only subagents inside a task.
11. **`Harness` trait, Codex-only implementation in v1.** Pi is the documented multi-provider backend, not a dual-ship.
12. **Typed content-kind fragments** for Soul / Position / project agents (aligned with 2026-08-23 Codex protocol).
13. **Project Chromium profile, not per-bot.**
14. **One human login, many bots** via auth symlink.

---

## Alternatives Considered

### A. Pi SDK as kernel (original draft)

Best multi-provider story and a clean `ResourceLoader`. We would have rebuilt sandbox, approvals, memory consolidation, and an app protocol. **Rejected after Codex opened the harness as a platform.** Trait kept.

### B. Vendor / fork `codex-rs`

Maximum control, merge hell against a 100-crate weekly alpha. **Rejected.**

### C. Treat custom agents TOML as the talent pool

Fastest "multi-agent" demo. No private memory (subagents skipped), no bench, no project company. **Rejected as the product.** TOML files may still be generated as *spawn recipes* for intra-task workers.

### D. Electron monolith

Simpler packaging. Worse privilege story. **Rejected.**

### E. All-Rust guildd in Tauri

Attractive long-term. Slows v1 HR/board. Schema allows a later swap. **Deferred.**

### F. Postgres + Qdrant + Mem0

Kills local-first. **Rejected.**

---

## Rollout

1. Skeleton: pnpm, `guildd` /health, Tauri empty bench.
2. Library + Bot Studio (no LLM).
3. **Codex host:** materialize home, one bot, one task, stream items; disjoint-skills fixture.
4. Bot-core memories on; project archival + MCP `memory_*`.
5. Staffing + board + handoff (Guild MCP).
6. Approval modal + Position sandbox matrix.
7. Browser (Codex or Playwright).
8. Optional Docker `trust=sandbox`.
9. Onboarding, cost footer, dump/restore.

---

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Codex CLI / experimental app-server moves weekly | High | Pin exact version; generate schema from that binary; fixture suite |
| `CODEX_HOME` is process-global (needs one process per bot) | Med | That's the v1 process model; extra RAM; cap concurrency at 3 |
| OpenAI model gravity | Med | Harness trait; Codex already has Ollama/Bedrock |
| Subagent file conflicts | High | Default `allow_subagents=0`; one assignee; later worktrees |
| Memory poisoning | Med | Project core review tray; bot-core uses Codex generate flags |
| Two sidecars to codesign (Node + Codex) | Med | Document Gatekeeper; nest binaries |
| Token cost of teams | High | No auto-answer; no debate; one assignee; skill cap |

---

## Open Questions

Defaults in brackets if you say nothing.

1. **Product name.** [Guild]
2. **First vertical slice.** [Local git coding project] vs life-ops / browser-only.
3. **Onboarding auth.** [ChatGPT login via Codex] vs API key only.
4. **Project core auto-write.** [Off, review tray]
5. **Import `~/.codex` / `~/.pi` / `~/.agents/skills` on first launch?** [Ask, don't auto-absorb]
6. **Intra-task Codex subagents for Engineer?** [Off until we see collisions]

---

## PR Plan

Each PR is independently reviewable. `pnpm test` / `cargo test` green.

### PR 1 — Monorepo skeleton

- **Title:** `chore: pnpm workspaces, daemon hello, Tauri shell`
- **Files:** `pnpm-workspace.yaml`, `packages/daemon`, `packages/protocol`, `apps/desktop`
- **Depends on:** —
- **Changes:** Empty bench; `/health`; Tauri spawns `guildd` in dev.

### PR 2 — Database and domain types

- **Title:** `feat(db): drizzle schema for library, bots, projects, tasks, memory`
- **Files:** `packages/db`, `packages/domain`, `packages/protocol`
- **Depends on:** PR 1
- **Changes:** Migrations including `sandbox`, `thread_source`, `thread_id` on runs.

### PR 3 — Library + Bot Studio UI

- **Title:** `feat(ui): library CRUD and bot studio`
- **Files:** `apps/desktop/src`, daemon routes, `packages/fixtures`
- **Depends on:** PR 2
- **Changes:** Create a bot; pick soul/agent/skills/position; files under `~/.guild`.

### PR 4 — Codex host, single-agent run

- **Title:** `feat(codex-host): per-bot CODEX_HOME and one-task app-server`
- **Files:** `packages/codex-host`, daemon supervisor, Run view
- **Depends on:** PR 3
- **Changes:** Pin Codex CLI; materialize home; `thread/start` + stream items; **never `~/.codex`**. Fixture: two bots, disjoint skill indexes. Map approval requests even if the modal is a stub.

### PR 5 — Memory

- **Title:** `feat(memory): Codex bot-core + Guild project archival`
- **Files:** `packages/memory`, `packages/mcp-guild`, Memory UI
- **Depends on:** PR 4
- **Changes:** Enable Codex memories in bot home; project `MEMORY.md` fragment; `memory_search` / `memory_write` MCP; review tray for project core.

### PR 6 — Staffing, board, handoff

- **Title:** `feat(team): project members, kanban, typed handoff`
- **Files:** daemon, Project Room, MCP `task_update` / `handoff` / `ask_teammate`
- **Depends on:** PR 4 (PR 5 preferred)
- **Changes:** Two bots on one project; handoff moves work; war-room events.

### PR 7 — Position sandbox + approval modal

- **Title:** `feat(security): position→sandbox matrix and approval UI`
- **Files:** `codex-host`, desktop modal, `events` audit
- **Depends on:** PR 4
- **Changes:** Reviewer = `read_only` + `guardian_review`; Engineer = `workspace_write`; human confirm.

### PR 8 — Browser

- **Title:** `feat(browser): project-scoped web tools`
- **Files:** MCP or Codex browser adapter
- **Depends on:** PR 7
- **Changes:** One Chromium profile per project; idle shutdown.

### PR 9 — Optional Docker trust

- **Title:** `feat(sandbox): Docker-backed trust=sandbox sidecar`
- **Files:** supervisor, Tauri/docker checks
- **Depends on:** PR 7
- **Changes:** Untrusted projects wrap app-server; auth stays on host.

### PR 10 — Polish

- **Title:** `feat: cost footer, dump/restore, first-run onboarding`
- **Depends on:** PR 6–8
- **Changes:** ChatGPT login via Codex; dump `~/.guild`; project cost rollup.

---

## References

- Codex repo: https://github.com/openai/codex
- Codex as a platform: https://developers.openai.com/blog/codex-as-a-platform
- App-server: https://learn.chatgpt.com/docs/app-server (Thread / Turn / Item)
- Codex SDK: https://learn.chatgpt.com/docs/codex-sdk
- Subagents (ephemeral, not Bots): https://learn.chatgpt.com/codex/agent-configuration/subagents
- Memories: https://learn.chatgpt.com/codex/customization/memories
- Guardian vs subagent: https://github.com/openai/codex/pull/40221
- Pi (alternate harness): https://github.com/earendil-works/pi
- OpenClaw `SOUL.md` split: https://docs.openclaw.ai/concepts/soul
- Agent Skills: https://agentskills.io
- sqlite-vec: https://github.com/asg017/sqlite-vec
