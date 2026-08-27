# Guild

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md)

**ローカルの人材ベンチ。@handle で人を呼ぶ。何でも屋のチャット窓は、もういらない。**

Local-first. Your files. Your models.

![Staff a local bench. @mention one.](docs/demo.gif)

## クイックスタート

[Node](https://nodejs.org) ≥ 22.19 と [pnpm](https://pnpm.io) 10.x が必要です。

```bash
pnpm i
pnpm test
pnpm dev
```

[http://127.0.0.1:7420](http://127.0.0.1:7420) を開く。

1. **モデル**（`/settings`）— プロバイダかサブスクを繋ぐ。モデルが無いと、bot は返事だけできる。考えることはできない。
2. チャンネルを開く。部屋に仕事があるなら `Channel.md` を書く。
3. `@pm` で範囲を切る。`@rd` にコードを見てもらう。@ されたとき（または返信したとき）だけ返す。`@channel` は全員に飛ぶ——大抵まちがい。

データは `GUILD_HOME`（既定 `~/.guild`）。クラウドアカウントではない。

## これは何か

- **単位は人：** Soul / Agent / Skill / Position。`@handle` で呼ぶ。
- 既定の五席：`@infra` `@pm` `@rd` `@design` `@marketing`。
- Bot Studio（`/studio`）で雇う。スキルは markdown。ローカル CLI からコピーできる。
- モデルは自分で繋ぐ：OpenAI、Anthropic、xAI、Ollama、OpenRouter — API key または OAuth（ChatGPT Codex、Claude Pro/Max、Grok、Copilot、OpenRouter）。

## これは何かではない

- Codex ハーネスではない
- プロジェクト / タスクボードではない
- クラウドアカウントではない
- ツールはサンドボックスされていない
- `apps/desktop` ではない（孤児。製品 UI は daemon）

## いまの限界

**`run` と `write` はあなたとして、あなたのシェルで、サンドボックスなしで実行される。** `run` の既定 cwd は `$HOME`。`write` はプロセスが書ける任意のパスに書ける。破壊的なコマンドはいくつか拒否される。それは防護ではない。ワークショップとして扱うこと。詳細：[SECURITY.md](./SECURITY.md)。

まだ無いもの：Tauri アプリ、SQLite、staffing、approvals、bot ごとの `CODEX_HOME`。`docs/` の設計文書は後の形——changelog ではない。

## ライセンス

[MIT](./LICENSE)
