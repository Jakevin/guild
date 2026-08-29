<p align="left"><img src="docs/logo/B-g-monogram.svg" width="128" height="128" alt="Guild"></p>

# Guild

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md)

**本機冒險者工會。用 @handle 點名你要的那個人，不要再開一個什麼都會的聊天窗。**

Local-first. Your files. Your models.

![本機冒險者工會。點名一人。](docs/demo-hall-en-2026-08-29.gif)

## 打開大廳

需要 [Node](https://nodejs.org) ≥ 22.19 與 [pnpm](https://pnpm.io) 10.x。

```bash
pnpm i
pnpm test
pnpm dev
```

打開 [http://127.0.0.1:7420](http://127.0.0.1:7420)。

1. **模型**（`/settings`）— 接上 provider 或訂閱。沒有模型，冒險者還能回一聲；他們不能想。
2. 開一個頻道——一張委託。大廳有活就寫 `Channel.md`（委託書）。
3. `@pm` 收範圍，`@rd` 看程式。被 `@` 到、你回他們、或沒點名時由上一個說話的冒險者接。`@channel` 會叫整支編制——通常是錯的。

資料在 `GUILD_HOME`（預設 `~/.guild`）。房間、訊息、軌跡在 `guild.sqlite`（WAL）；Soul / skill / MEMORY.md 仍是檔案。不是雲端帳號。`guildd` 是 Cordis 4 應用；插件組合在 `packages/daemon/cordis.yml`。`GUILD_*` 環境變數仍蓋過 YAML。

## 編制

- **單位是有名字的冒險者：** Soul / Agent / Skill / Position，用 `@handle` 叫。
- 預設小隊五席——是編制，不是出征：`@infra` `@pm` `@rd` `@design` `@marketing`。出活仍點名一人。
- 在 Bot Studio（`/studio`）招人。技能是 markdown；可從本機 CLI 拷進來。
- 模型自己接：OpenAI、Anthropic、xAI、Ollama、OpenRouter — API key 或 OAuth（ChatGPT Codex、Claude Pro/Max、Grok、Copilot、OpenRouter）。

## 工坊

打開 `/library`。一頁三個 tab。

| Tab | 是什麼 |
|---|---|
| **技能** | Markdown 說明書。掛到冒險者身上。模型要 call `skill` 才會載入正文。 |
| **子代理** | 對話裡 call `spawn`。子代理回一份摘要。不能再套一層。沒有 MCP 工具。 |
| **MCP** | stdio 工具伺服器，**不是技能**。不要放進技能庫。 |

### MCP

1. 工坊 → MCP → [連接伺服器](http://127.0.0.1:7420/mcp/add) 寫進 `{GUILD_HOME}/mcp.json`。
2. Name + command + args。沒有 URL 欄。HTTP MCP 沒接。
3. 這台機器上 Claude / Cursor / Codex 已配的 stdio MCP **免匯入、直接 spawn**（`~/.claude.json`、`~/.cursor/mcp.json`、`~/.codex/config.toml`）。`mcp.json` 裡同名的列贏，host 那份略過。
4. 活著之後，據點裡**每個**冒險者都能 call 這些工具。名字長得像 `mcp__server__tool`。

不要讓某個 host server 進 Guild：從 host 設定拿掉，或把 `packages/daemon/cordis.yml` 的 `id: mcp` 設成 `disabled: true`（Guild MCP 整包關掉，含 `mcp.json`）。

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
- 不是任務板——沒有專案 / 任務看板
- 不是小隊出征——點名一個冒險者，不是一隊人馬
- 不是雲端帳號
- 不是 OS jail（可選 Position / `GUILD_SANDBOX` tool gate）
- 不是 `apps/desktop`（孤兒；產品 UI 是 daemon）

## 現況限制

**預設：`run` 與 `write` 以你的身分、在你的 shell 執行（`GUILD_SANDBOX` 未設 = `full_access`，除非該 bot 的 POSITION.md 有 `sandbox:`）。** `run` 的預設 cwd 是 `$HOME`（`workspace_write` 用 `GUILD_WORKSPACE` 或本 checkout）。這是 tool gate，不是 Codex isolation。細節：[SECURITY.md](./SECURITY.md)。

**MCP 會以你的身分 spawn 本機 process** — Guild 的 `mcp.json` **以及** 本機 Claude / Cursor / Codex 設定，沒有匯入、沒有同意步驟。env 會繼承，再疊上該 server 的 `env`。殺傷半徑比 skill 大。把這當工作坊。細節：[SECURITY.md](./SECURITY.md)。

**瀏覽器預設沒登入。** `browser` 開的是拋棄式 Chrome profile。設 `GUILD_BROWSER_REAL_PROFILE=1` 才會把你**正在用的** Chrome profile（`last_used`）快照到 `~/.guild/browser-profile/chrome`（對齊 Hermes 原始碼：sqlite backup，不開你正在跑的那個）。細節：[SECURITY.md](./SECURITY.md)。

也還沒做：Tauri app、staffing、approvals、每 bot 一份 `CODEX_HOME`、HTTP MCP。`docs/` 裡的設計文件是之後的形狀——不是 changelog。

## 授權

[MIT](./LICENSE)
