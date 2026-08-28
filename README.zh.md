<p align="left"><img src="docs/logo/B-g-monogram.svg" width="128" height="128" alt="Guild"></p>

# Guild

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md)

**本機人材庫。用 @handle 叫人，不要再開一個什麼都會的聊天窗。**

Local-first. Your files. Your models.

![Staff a local bench. @mention one.](docs/demo.gif)

## 快速開始

需要 [Node](https://nodejs.org) ≥ 22.19 與 [pnpm](https://pnpm.io) 10.x。

```bash
pnpm i
pnpm test
pnpm dev
```

打開 [http://127.0.0.1:7420](http://127.0.0.1:7420)。

1. **模型**（`/settings`）— 接上 provider 或訂閱。沒有模型，bot 還能回一聲；他們不能想。
2. 開一個頻道。房間有任務就寫 `Channel.md`。
3. `@pm` 收範圍，`@rd` 看程式。被 @ 到（或你回他們）才會回。`@channel` 會叫所有人——通常是錯的。

資料在 `GUILD_HOME`（預設 `~/.guild`）。房間、訊息、軌跡在 `guild.sqlite`（WAL）；Soul / skill / MEMORY.md 仍是檔案。不是雲端帳號。`guildd` 是 Cordis 4 應用；插件組合在 `packages/daemon/cordis.yml`。`GUILD_*` 環境變數仍蓋過 YAML。

## 它是什麼

- **單位是人：** Soul / Agent / Skill / Position，用 `@handle` 叫。
- 預設五席：`@infra` `@pm` `@rd` `@design` `@marketing`。
- 在 Bot Studio（`/studio`）雇人。技能是 markdown；可從本機 CLI 拷進來。
- 模型自己接：OpenAI、Anthropic、xAI、Ollama、OpenRouter — API key 或 OAuth（ChatGPT Codex、Claude Pro/Max、Grok、Copilot、OpenRouter）。

## 工坊

打開 `/library`。一頁三個 tab。

| Tab | 是什麼 |
|---|---|
| **技能** | Markdown 說明書。掛到 bot 身上。模型要 call `skill` 才會載入正文。 |
| **子代理** | 對話裡 call `spawn`。子代理回一份摘要。不能再套一層。沒有 MCP 工具。 |
| **MCP** | stdio 工具伺服器，**不是技能**。不要放進技能庫。 |

### MCP

1. 工坊 → MCP → [連接伺服器](http://127.0.0.1:7420/mcp/add)，或把本機 Codex / Claude / Cursor 的卡片匯入。
2. Name + command + args。沒有 URL 欄。HTTP MCP 沒接。
3. 連上之後，頻道裡**每個** bot 都能 call 這些工具。名字長得像 `mcp__server__tool`。

設定在 `{GUILD_HOME}/mcp.json`（預設 `~/.guild/mcp.json`）。本機檔（`~/.claude.json`、`~/.cursor/mcp.json`、`~/.codex/config.toml`）只列出來；**匯入 Guild 之後**對話才用得上。匯入是把啟動方式拷進 Guild，不會直接讀 host 檔。

```json
{
  "mcpServers": {
    "echo": { "command": "node", "args": ["echo-mcp.mjs"] }
  }
}
```

有 `url` 沒有 `command` 會被拒（`stdio MCP needs a command`）。上限：每個 server 40 個工具，合計 80。`tools/call` timeout 5 分鐘。Session 跟 `guildd` 活一樣久。

## 它不是什麼

- 不是 Codex harness
- 不是專案 / 任務看板
- 不是雲端帳號
- 工具沒有沙盒
- 不是 `apps/desktop`（孤兒；產品 UI 是 daemon）

## 現況限制

**預設：`run` 與 `write` 以你的身分、在你的 shell 執行（`GUILD_SANDBOX` 未設 = `full_access`）。** `run` 的預設 cwd 是 `$HOME`。可選 `read_only` / `workspace_write`（搭配 `GUILD_WORKSPACE`）是 tool gate，不是 Codex isolation。細節：[SECURITY.md](./SECURITY.md)。

**MCP 會以你的身分 spawn 本機 process。** env 會繼承，再疊上該 server 的 `env`。殺傷半徑比 skill 大。把這當工作坊。細節：[SECURITY.md](./SECURITY.md)。

也還沒做：Tauri app、staffing、approvals、每 bot 一份 `CODEX_HOME`、HTTP MCP。`docs/` 裡的設計文件是之後的形狀——不是 changelog。

## 授權

[MIT](./LICENSE)
