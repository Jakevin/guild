# Addendum — Codex open harness vs Guild kernel

| Field | Value |
|---|---|
| Date | 2026-08-23 |
| Parent | `docs/2026-08-23-guild-design.md` |
| Trigger | OpenAI “Codex as a platform” (2026-08-19) + today’s `openai/codex` commits |
| Status | **Accepted** — merged into the parent spec |

This does **not** replace Guild’s product (talent pool, Soul/Agent/Skill/Position, project staffing). It revises **which agent loop we embed**.

---

## What shipped

OpenAI’s framing ([Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)):

> Your application owns product context, business rules, and tools; Codex app-server provides the agent loop and sandboxed execution.

They even name Guild’s shape: *a task board where moving an issue into ready starts a scoped implementation workflow.*

Integration layers:

| Layer | Use |
|---|---|
| `codex exec` | one-shot / CI |
| `@openai/codex-sdk` / `openai-codex` | start/resume threads in app code |
| `codex app-server` | persistent threads, streamed items, approval handshake, JSON-RPC |

Repo: Apache-2.0, Rust, 100+ crates, latest pre: `0.150.0-alpha.7` (2026-08-22). Pushed again today.

### Today’s commits that matter to Guild

| Commit / PR | Why it matters |
|---|---|
| [#40221](https://github.com/openai/codex/pull/40221) Guardian review threads ≠ `subagent` | Reviewer is a first-class thread *source*, not a generic child |
| Memory consolidation identified as its own request type | Memory pipeline is a product, not a prompt trick |
| Thread-tree archive shuts down resumed descendants | Multi-thread lifecycle is real |
| Content kinds on user input, contextual fragments, extension prompt fragments | We can inject Soul/Position as typed fragments, not soup |
| Unfinished root turn suspension | Long-running tasks can pause instead of die |

---

## Codex already has (we were going to build on PI)

| Capability | Codex | PI |
|---|---|---|
| Sandbox presets | `read_only` / `workspace_write` / `full_access` | none (run as user) |
| Approval policy | built into app-server | none |
| Memory | 2-phase: rollout extract → consolidate `MEMORY.md` under `CODEX_HOME/memories/` | session JSONL only |
| Subagents | custom agents as TOML (`name`, `description`, `developer_instructions`, model, sandbox, skills) | “build it yourself” |
| Reviewer | Guardian thread source (today) | n/a |
| App protocol | Thread / Turn / Item JSON-RPC | SDK events + experimental pi-server |
| Git worktrees | documented first-class env | warned against concurrent sessions |
| Hooks | SessionStart / PreToolUse / PostToolUse | extensions |
| Skills | `skills.config` per custom agent | ResourceLoader override |

---

## What Codex is **not**

Do not confuse their nouns with Guild’s.

| Codex noun | Actual meaning | Guild equivalent |
|---|---|---|
| `agent-identity` | Cryptographic ChatGPT runtime (ed25519, JWT, bill of materials). Not a persona. | — (ignore for v1) |
| Subagent / custom agent | **Ephemeral child of one parent thread.** No bench, no private career, skipped by the memory pipeline. | Position-shaped *spawn recipe*, not a Bot |
| Collaboration mode | Plan vs Default (mutate vs not) | Lead’s planning phase, not a team |
| `~/.codex/memories/` | **One global store per CODEX_HOME** | Must be per-bot (and project memory still ours) |
| `~/.codex/agents/*.toml` | Spawn configs, inherit parent skills unless overridden | Library Position + Skill selection, but not identity |

Subagents inherit sandbox from the parent. They do **not** get their own long-term memory. Guild Bots must.

---

## Revised kernel recommendation

**Keep Guild as the product. Switch the execution kernel from PI SDK → Codex app-server.**

Reason: sandbox, approvals, memory consolidation, thread protocol, and reviewer-vs-worker are the expensive parts of a harness. OpenAI just open-sourced them in Rust, which matches `RustPrj/bot`. PI remains the better *multi-provider* loop; Codex is the better *product platform*.

Isolation trick (replaces PI `GuildResourceLoader` as the primary mechanism):

```text
Bot run:
  CODEX_HOME = ~/.guild/bots/{bot_id}/codex-home/
    AGENTS.md          ← Agent template
    memories/          ← that bot’s Codex memory pipeline (private)
    agents/*.toml      ← optional spawn recipes for this bot
    config.toml        ← skills.config allowlist, sandbox default
  cwd          = project.workspace
  extra fragments (content kinds) = SOUL.md + POSITION.md + project AGENTS.md
  sandbox      = position.allowed  (read_only for Reviewer, workspace_write for Engineer)
  approval     = position / project trust
  thread source = guardian_review if Position=Reviewer, else normal
```

Project memory stays Guild-owned (SQLite + `projects/{id}/memory/MEMORY.md`). Codex’s pipeline is **bot-private** because `CODEX_HOME` is per bot. Subagent sessions still skip Codex memory — that is correct: only staffed Bots persist.

### What Guild still owns

- Roster, library (Soul / Agent / Skill / Position), staffing matrix
- Task board, typed handoff, war room
- Per-project memory + hybrid archival search
- Binding: which skills appear in that bot’s `CODEX_HOME`
- Playwright / OS extra tools if Codex browser isn’t enough
- Multi-provider later (optional PI or Ollama backend). v1 can be ChatGPT/Codex + Bedrock/Ollama that Codex already has.

### What we stop building

- Custom `beforeToolCall` jail as v1 (use Codex sandbox + approval)
- Homegrown compaction/session tree (use Thread/Turn/Item)
- Homegrown settle→MEMORY.md extractor (use their Phase 1/2, scoped by CODEX_HOME)
- In-process Node `guildd` embedding PI — daemon becomes a thin supervisor of `codex app-server` (one process, many threads **or** one process per bot if we need hard `CODEX_HOME` isolation)

Process model: **one `codex app-server` per bot** if `CODEX_HOME` is process-global; confirm before coding. If app-server allows per-thread home, one process is enough.

---

## Risks of the switch

| Risk | Mitigation |
|---|---|
| OpenAI model gravity | v1 accept it; keep a `Harness` trait so PI can be a second backend |
| 100+ crates / weekly alpha (`0.150.0-alpha.*`) | Depend on released CLI + generated app-server schema, do not vendor `codex-rs` |
| Experimental API (`experimentalApi`) | Stick to stable Thread/Turn/Item; treat `projectId` / historyMode as optional |
| Subagent file conflicts | Still one assignee per Guild task; Codex subagents only for read-heavy split inside that task |
| Global skill leak if we forget CODEX_HOME | Factory test: two bots, assert skill index disjoint |

---

## PR plan delta

Replace original PR 4 (Pi host) with:

**PR 4′ — Codex host:** spawn/connect app-server, `thread/start` with cwd + sandbox + prompt fragments, stream items to UI, permission modal = Codex approval requests.

Memory PR 5 becomes: wire Codex memories under per-bot `CODEX_HOME` + keep Guild project memory as a second store.

Staffing PR 6 unchanged (product). Permission PR 7 shrinks to “map Position → sandbox/approval”. Sandbox PR 9 mostly disappears.
