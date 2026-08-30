# 點名一個人：Guild 十分鐘

Guild 是本機冒險者工會。你養一組有名字的人，用 `@handle` 叫其中一個。不是再開一個什麼都會的聊天窗。

資料在你的磁碟（預設 `~/.guild`）。模型是你接的。日誌留在據點。

![本機冒險者工會。點名一人。](demo-hall-en-2026-08-29.gif)

Repo：https://github.com/Jakevin/guild · `v0.2.1`

## 你要有的

- [Node](https://nodejs.org) ≥ 22.19
- [pnpm](https://pnpm.io) 10.x
- 一個模型：Ollama 本機，或 OpenAI / Anthropic / OpenRouter 的 key，或 ChatGPT Codex / Claude Pro / Kimi Code 那種訂閱

沒有模型，冒險者還能回一聲；他們不能想。先把模型接上，再點名。

## 1. 打開大廳

```bash
git clone https://github.com/Jakevin/guild.git
cd guild
pnpm i
pnpm test
pnpm dev
```

打開 [http://127.0.0.1:7420](http://127.0.0.1:7420)。側欄應是 **Channels / Roster / Workshop**（或中文：委託 / 編制 / 工坊）。

資料不在雲端帳號。房間、訊息、軌跡在 `guild.sqlite`；Soul / skill / `MEMORY.md` 仍是檔。

## 2. 接一個模型

進 **Models**（`/settings`）。

| 你有 | 做 |
|---|---|
| Ollama | 選本機模型 |
| API key | 貼進對應 provider |
| ChatGPT Codex / Claude Pro / Grok / Copilot / OpenRouter / Kimi Code / Pi Radius | 走 OAuth |

存好。沒這步，下面的 `@pm` 只會點頭。

## 3. 開一張委託

大廳裡開一個 channel。這是**委託**，不是任務板、不是會結案的票。

點據點 icon，寫 `Channel.md`（委託書）。可貼：

```md
# first-mention
Job: get one real reply from a named adventurer.
Most important thing: @mention the person you want. Do not start a new feature.
```

存檔。被 `@` 到的人會讀到這份。密談沒有委託書。

## 4. 點名一個人

編制預設五席：`@infra` `@pm` `@rd` `@design` `@marketing`。
五席是**編制**，不是出征。出活仍點名一人。

在輸入框寫：

```
@pm what is the one most important thing now?
```

送出。等那一個人回——不要 `@channel`，那會叫整支編制，通常是錯的。

成功長這樣：只有 `@pm` 回，而且對得上你剛寫的委託書。

沒點名時，上一個說話的冒險者會接。這是產品行為，不是群聊。

## 5. 人是 markdown

到 **Roster**（`/studio`）點 `@pm`，打開 `SOUL.md`。改 Voice 下面一行，存檔，同一句再問一次。語氣應該變。

這就是產品：席上的人記得自己是誰。不是提示詞拼盤。

招第六個人也在這裡。技能是 markdown，可從本機 CLI 拷進來。

## 工坊（先不用也沒關係）

`/library` 一頁三個 tab：

| Tab | 做什麼 |
|---|---|
| **Skills** | 說明書。掛到冒險者身上。模型要 call `skill` 才載入正文。 |
| **Subagents** | 對話裡 `spawn`。子代理回摘要。不能再套一層。沒有 MCP。 |
| **MCP** | stdio 工具伺服器，**不是技能**。 |

第一個回覆不需要這三樣。點名通了再打開。

## 這台機器上的老實話

當工坊用，不要對未信任的 prompt、未信任的 repo，或你丟不起檔案的機器。細節：[SECURITY.md](../SECURITY.md)。

- **`run` / `write` 是你的 shell。** 預設 `full_access`。`run` 的 cwd 是 `$HOME`。可選 Position `sandbox:` 或 `GUILD_SANDBOX` 是 tool gate，不是 OS jail。
- **MCP 免匯入、直接 spawn。** Guild 的 `mcp.json`，以及這台機 Claude / Cursor / Codex 已配的 stdio MCP（`~/.claude.json`、`~/.cursor/mcp.json`、`~/.codex/config.toml`）。沒有同意步驟。env 會繼承。不要的 server：從 host 檔拿掉，或把 `packages/daemon/cordis.yml` 的 `id: mcp` 設成 `disabled: true`。
- **瀏覽器預設帶你的 Chrome 登入。** 設 `GUILD_BROWSER_REAL_PROFILE=0` 才用拋棄式空 profile。

不要把祕密貼進頻道再 `@mention`。評估時可用丟棄的 `GUILD_HOME`。

## 它不是什麼

不是 Codex harness。不是任務板。不是小隊出征。不是雲端帳號。不是 `apps/desktop`（孤兒；產品 UI 是 daemon）。

## 過了之後

1. 同一句再問 `@rd`，讓他看你 clone 下來的 repo。
2. 改一行 `SOUL.md`，確認人還是那個人、聲音變了。
3. 限制句跟 README 對不上再開 issue。

clone：https://github.com/Jakevin/guild

```
pnpm i && pnpm test && pnpm dev
```
