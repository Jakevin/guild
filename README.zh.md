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

資料在 `GUILD_HOME`（預設 `~/.guild`）。不是雲端帳號。

## 它是什麼

- **單位是人：** Soul / Agent / Skill / Position，用 `@handle` 叫。
- 預設五席：`@infra` `@pm` `@rd` `@design` `@marketing`。
- 在 Bot Studio（`/studio`）雇人。技能是 markdown；可從本機 CLI 拷進來。
- 模型自己接：OpenAI、Anthropic、xAI、Ollama、OpenRouter — API key 或 OAuth（ChatGPT Codex、Claude Pro/Max、Grok、Copilot、OpenRouter）。

## 它不是什麼

- 不是 Codex harness
- 不是專案 / 任務看板
- 不是雲端帳號
- 工具沒有沙盒
- 不是 `apps/desktop`（孤兒；產品 UI 是 daemon）

## 現況限制

**`run` 與 `write` 以你的身分、在你的 shell 執行，沒有沙盒。** `run` 的預設 cwd 是 `$HOME`。`write` 能寫行程式能寫的任何路徑。少數破壞性指令會被拒絕；那不是防護。把這當工作坊。細節：[SECURITY.md](./SECURITY.md)。

也還沒做：Tauri app、SQLite、staffing、approvals、每 bot 一份 `CODEX_HOME`。`docs/` 裡的設計文件是之後的形狀——不是 changelog。

## 授權

[MIT](./LICENSE)
