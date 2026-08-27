/** Guild UI strings. Default follows the browser; packs are zh-Hant and en. */
var I18N_ROWS = [
  ["title.chat", "Guild — 訊息", "Guild — Chat"],
  ["title.library", "Guild — 技能庫", "Guild — Skills"],
  ["title.subagents", "Guild — 子代理", "Guild — Subagents"],
  ["title.subagentsAdd", "Guild — 新增子代理", "Guild — Add subagent"],
  ["title.mcp", "Guild — MCP", "Guild — MCP"],
  ["title.mcpAdd", "Guild — 連接 MCP", "Guild — Add MCP"],
  ["title.settings", "Guild — 模型", "Guild — Models"],
  ["title.studio", "Guild — 酒吧", "Guild — Bar"],
  ["title.skillsAdd", "Guild — 追加技能", "Guild — Add skill"],
  ["nav.chat", "訊息", "Chat"],
  ["nav.studio", "酒吧", "Bar"],
  ["nav.library", "工坊", "Workshop"],
  ["nav.subagents", "子代理", "Subagents"],
  ["nav.mcp", "MCP", "MCP"],
  ["library.sub.skills", "技能", "Skills"],
  ["nav.settings", "模型", "Models"],
  ["settings.sub.main", "主模型", "Default"],
  ["settings.sub.subs", "訂閱", "Subscriptions"],
  ["settings.sub.keys", "API Key", "API Key"],
  ["search", "搜尋", "Search"],
  ["search.skills", "搜尋技能", "Search skills"],
  ["search.subagents", "搜尋子代理", "Search subagents"],
  ["search.mcp", "搜尋 MCP", "Search MCP"],
  ["search.models", "搜尋全部模型", "Search all models"],
  ["search.traj", "搜尋 system / tool / 結果", "Search system / tool / result"],
  ["channels", "頻道", "Channels"],
  ["dms", "私訊", "Direct"],
  ["newChannel", "新頻道", "New channel"],
  ["newChannelName", "新頻道名稱", "Channel name"],
  ["create", "建立", "Create"],
  ["delete", "刪除", "Delete"],
  ["deleteFailed", "刪除失敗", "Couldn't delete"],
  ["channel.delete", "刪除頻道", "Delete channel"],
  ["channel.deleteConfirm", "刪除 #{name}？訊息和 Channel.md 會一併刪掉。", "Delete #{name}? Messages and Channel.md go with it."],
  ["channel.keepGeneral", "#general 不能刪。", "Can't delete #general."],
  ["bot.delete", "刪除這個人", "Delete this person"],
  ["bot.deleteConfirm", "刪除 @{handle}？私訊與記憶會一併刪掉。", "Delete @{handle}? Their DM and memory go with them."],
  ["members", "成員", "Members"],
  ["members.in", "在頻道裡", "In this channel"],
  ["members.out", "不在頻道中", "Not in channel"],
  ["members.empty", "還沒有人。", "No one here yet."],
  ["members.allIn", "酒吧裡的人都在這個頻道。", "Everyone from the bar is already in."],
  ["members.kick", "移出", "Remove"],
  ["members.add", "加入", "Add"],
  ["invite.title", "拉 bot 進頻道", "Invite a bot"],
  ["invite.body", "勾選要進來的人。頻道裡用 @handle 叫他們回話。", "Pick who to add. @handle them in the channel to get a reply."],
  ["invite.save", "加入", "Add"],
  ["assign.title", "要誰做？", "Who should do this?"],
  ["assign.hint", "這則提到好幾個人。選一個去跑。", "Several people are named here. Pick one to run."],
  ["cancel", "取消", "Cancel"],
  ["save", "儲存", "Save"],
  ["saveFailed", "儲存失敗", "Couldn't save"],
  ["close", "關閉", "Close"],
  ["copy", "複製", "Copy"],
  ["copied", "已複製", "Copied"],
  ["edit", "編輯", "Edit"],
  ["reply", "回覆", "Reply"],
  ["retry", "重問", "Retry"],
  ["stats", "統計", "Stats"],
  ["stats.title", "回應統計", "Response statistics"],
  ["stats.tokens", "Token", "Tokens"],
  ["stats.time", "時間", "Time"],
  ["stats.model", "模型", "Model"],
  ["stats.rounds", "模型回合", "Agent rounds"],
  ["stats.cost", "費用", "Cost"],
  ["stats.estimated", "估算", "Estimated"],
  ["stats.inOut", "輸入 {in} · 輸出 {out}", "in {in} · out {out}"],
  ["askAgain", "重新詢問", "Ask again"],
  ["send", "送出", "Send"],
  ["stop", "停止", "Stop"],
  ["steer.hint", "Enter 排隊 · {mod}↩ 插入這輪", "Enter to queue · {mod}↩ to steer this turn"],
  ["steer.queue", "排隊", "Queue"],
  ["steer.insert", "插入引導", "Steer"],
  ["steer.remove", "取消排隊", "Remove from queue"],
  ["steer.tag", "已插入這輪", "Inserted into this turn"],
  ["steer.done", "已插入這輪，做完這步就會接著看", "Inserted. It will pick this up after the current step."],
  ["steer.live", "引導", "Steer"],
  ["busy", "忙碌中", "Busy"],
  ["unread", "未讀", "Unread"],
  ["noMessages", "還沒有訊息。寫一句話開始。頻道裡記得 @handle。", "No messages yet. Say something. In a channel, @handle a bot."],
  ["dm", "私訊", "DM"],
  ["justNow", "剛剛", "Just now"],
  ["minutesAgo", "{n} 分鐘前", "{n} min ago"],
  ["today", "今天", "Today"],
  ["yesterday", "昨天", "Yesterday"],
  ["noActivity", "尚無訊息", "No messages"],
  ["local", "本地", "Local"],
  ["you", "你", "You"],
  ["emptyParen", "(空)", "(empty)"],
  ["reason.min", "最低", "Min"],
  ["reason.low", "低", "Low"],
  ["reason.mid", "中", "Mid"],
  ["reason.high", "高", "High"],
  ["speed.normal", "標準", "Standard"],
  ["speed.fast", "快速", "Fast"],
  ["model", "模型", "Model"],
  ["reasoning", "推理強度", "Reasoning"],
  ["speed", "速度", "Speed"],
  ["advanced", "進階", "Advanced"],
  ["model.settings", "模型設定", "Model settings"],
  ["switchModel", "切換模型", "Switch model"],
  ["modelSwitchFailed", "切換模型失敗", "Couldn't switch model"],
  ["recent", "最近使用", "Recently used"],
  ["allModels", "全部模型", "All models"],
  ["searchResults", "搜尋結果", "Results"],
  ["noModels", "沒有模型。到進階連接訂閱或填 API key。", "No models. Connect a subscription or add an API key in Advanced."],
  ["askAnything", "Ask anything", "Ask anything"],
  ["askName", "Ask {name}", "Ask {name}"],
  ["add", "加入", "Add"],
  ["attach.upload", "上傳檔案", "Upload file"],
  ["attach.files", "檔案", "Files"],
  ["attach.dirs", "資料夾", "Folders"],
  ["attach.skills", "技能", "Skills"],
  ["attach.conv", "對話", "Chats"],
  ["attach.git", "Git", "Git"],
  ["attach.rules", "規則", "Rules"],
  ["attach.term", "終端", "Terminal"],
  ["attach.tree", "工作區", "Workspace"],
  ["attach.slash", "指令", "Commands"],
  ["insert", "插入 {name}", "Insert {name}"],
  ["remove", "移除", "Remove"],
  ["cancelReply", "取消回覆", "Cancel reply"],
  ["replying", "回覆…", "Replying…"],
  ["trace", "Trajectory", "Trajectory"],
  ["trace.steps", "步驟", "Steps"],
  ["trace.long", "長輸出", "Long output"],
  ["trace.pick", "選一筆事件。", "Select an event."],
  ["trace.empty", "沒有事件。送一則訊息後會開始記錄。", "No events yet. Send a message to start the log."],
  ["trace.log", "append-only log", "append-only log"],
  ["trace.derived", "由訊息還原", "rebuilt from messages"],
  ["trace.loading", "讀取中…", "Loading…"],
  ["html.preview", "預覽", "Preview"],
  ["html.code", "原始碼", "Code"],
  ["html.expand", "放大預覽", "Expand preview"],
  ["html.zoom", "HTML 預覽", "HTML preview"],
  ["fence.toInput", "加入輸入框", "Insert into composer"],
  ["channel.md", "Channel.md", "Channel.md"],
  ["channel.mdHelp", "這個頻道的工作說明。用 @handle 叫 bot 時會讀到這份筆記。私訊沒有 Channel.md。", "Operating notes for this channel. Bots see this when you @ them. DMs have no Channel.md."],
  ["memory.bot", "MEMORY.md", "MEMORY.md"],
  ["memory.botHelp", "這個 bot 學會的站立筆記。有用的回合後會自動更新。", "Standing notes this bot has learned. Auto-updated after useful turns."],
  ["memory.channel", "Channel MEMORY.md", "Channel MEMORY.md"],
  ["memory.channelHelp", "這個頻道共享的站立筆記。有用的回合後會自動更新。人寫的 Channel.md 優先。", "Shared standing notes for this channel. Auto-updated. User-written Channel.md wins if they conflict."],
  ["bot.message", "訊息", "Message"],
  ["bot.settings", "設定", "Settings"],
  ["notInChannel", "不在頻道中", "Not in channel"],
  ["deepDiving", "Deep diving...", "Deep diving..."],
  ["think", "Think", "Think"],
  ["skill", "Skill", "Skill"],
  ["bash", "Bash", "Bash"],
  ["read", "Read", "Read"],
  ["write", "Write", "Write"],
  ["list", "List", "List"],
  ["imageGen", "生圖", "Image"],
  ["spawn", "子代理", "Subagent"],
  ["attach.empty", "沒有可加入的項目。", "Nothing to add."],
  ["attach.parent", "↑ 上一層", "↑ Parent folder"],
  ["attach.addTree", "加入這個工作區地圖", "Attach this workspace map"],
  ["attach.addDir", "加入這個資料夾", "Attach this folder"],
  ["attach.truncated", "（已截斷）", " (truncated)"],
  ["attach.run", "請用 run 在本機執行：`{cmd}`", "Run this on the host: `{cmd}`"],
  ["attach.listDir", "請用 list 看這個資料夾：`{path}`", "List this folder: `{path}`"],
  ["attach.readFile", "請用 read 看這個檔案：`{path}`（{err}）", "Read this file: `{path}` ({err})"],
  ["attach.fileBody", "檔案 `{path}`{trunc}：", "File `{path}`{trunc}:"],
  ["attach.treeBody", "工作區地圖：", "Workspace map:"],
  ["attach.gitBody", "Git 狀態：", "Git status:"],
  ["attach.convBody", "對話摘錄 {title}：", "Chat excerpt {title}:"],
  ["attach.skillBody", "請使用 skill `{name}`。", "Use skill `{name}`."],
  ["attach.imageBody", "使用者附上圖片 `{name}`（{type}, {size} bytes）。以 {token} 引用。", "User attached image `{name}` ({type}, {size} bytes). Refer to it as {token}."],
  ["attach.uploadNoPath", "使用者上傳了檔案 `{name}`（{type}, {size} bytes）。瀏覽器沒有本機路徑，請改用「檔案」從磁碟選，或請我用 list/read 找。", "User uploaded `{name}` ({type}, {size} bytes). The browser has no host path — pick it from Files, or list/read for it."],
  ["attach.tooBig", "檔案 `{name}` 太大，沒有嵌進對話。請用「檔案」選本機路徑讓我 read。", "`{name}` is too large to embed. Pick it from Files so I can read the path."],
  ["attach.uploadText", "上傳檔案 `{name}`：", "Uploaded `{name}`:"],
  ["attach.noChannelMd", "這個頻道還沒有 Channel.md。請先在頻道 icon 寫一份。", "This channel has no Channel.md yet. Write one from the channel icon."],
  ["attach.botRulesTitle", "@{handle} 規則", "@{handle} rules"],
  ["attach.noPersona", "這個 bot 還沒有人設。", "This bot has no persona yet."],
  ["slash.editMd", "編輯 Channel.md", "Edit Channel.md"],
  ["slash.editMdHint", "頻道筆記", "Channel notes"],
  ["slash.rules", "附上規則", "Attach rules"],
  ["slash.rulesHint", "Channel.md / 人設", "Channel.md / persona"],
  ["slash.git", "附上 Git", "Attach Git"],
  ["slash.here", "插入 @channel", "Insert @channel"],
  ["slash.hereHint", "叫全頻道", "Ping the channel"],
  ["slash.library", "開工坊", "Open workshop"],
  ["mention.channel", "@頻道", "@channel"],
  ["mention.channelHint", "通知此頻道中的所有人。", "Notify everyone in this channel."],
  ["mention.here", "@這裡", "@here"],
  ["mention.hereHint", "通知此頻道中的每個成員。", "Notify every member here."],
  ["library.eyebrow", "共用工具箱", "Shared toolbox"],
  ["library.title", "技能庫", "Skills"],
  ["library.lede", "Guild 自己的技能，加上本機 Claude、Codex、Pi、Grok、Cursor 留下的 SKILL.md。安裝走 <a href=\"/skills/add\">追加技能</a>；酒吧可以直接勾本機 CLI 技能。", "Guild skills plus SKILL.md left on this machine by Claude, Codex, Pi, Grok, and Cursor. Install via <a href=\"/skills/add\">Add skill</a>; the bar can staff those CLI skills directly."],
  ["library.install", "安裝新技能", "Install skill"],
  ["library.add", "追加技能", "Add skill"],
  ["library.all", "全部", "All"],
  ["library.host", "本機技能，尚未裝進 Guild", "On disk, not staffed in Guild"],
  ["library.unused", "還沒有人勾選", "No bot selected this yet"],
  ["library.catalog", "系統預裝", "Bundled"],
  ["library.user", "自行安裝", "Installed"],
  ["library.found", "找到 {n} 項 · 共 {total} 項", "{n} matches · {total} total"],
  ["library.count", "{n} 項（含本機工具）· 點卡片可看 SKILL.md", "{n} skills (including local tools) · click a card for SKILL.md"],
  ["library.emptyHtml", "沒有符合的技能。到 <a href=\"/skills/add\">追加技能</a> 安裝。", "No matching skills. Install one from <a href=\"/skills/add\">Add skill</a>."],
  ["subagents.title", "子代理庫", "Subagents"],
  ["subagents.lede", "Guild 內建 explorer / worker / reviewer，加上本機 Codex、Grok、Claude 留下的 agent 檔。對話裡用 spawn 叫它們；自己建的走 <a href=\"/subagents/add\">新增子代理</a>。", "Bundled explorer / worker / reviewer, plus Codex, Grok, and Claude agent files on this machine. Chat calls them with spawn; create your own from <a href=\"/subagents/add\">Add subagent</a>."],
  ["subagents.install", "新增子代理", "Add subagent"],
  ["subagents.host", "本機 CLI 定義，spawn 可直接用", "On disk; spawn can use it as-is"],
  ["subagents.spawnHint", "對話裡 spawn 這個名字", "Spawn this name from chat"],
  ["subagents.count", "{n} 個子代理 · 點卡片看 TOML / 指令", "{n} subagents · click a card for TOML / instructions"],
  ["subagents.emptyHtml", "沒有符合的子代理。到 <a href=\"/subagents/add\">新增子代理</a>，或把 TOML 放到 ~/.codex/agents/。", "No matching subagents. Create one from <a href=\"/subagents/add\">Add subagent</a>, or drop TOML in ~/.codex/agents/."],
  ["subagentsAdd.title", "新增子代理", "Add subagent"],
  ["subagentsAdd.lede", "寫成 Codex 相容的 TOML（name / description / developer_instructions）。存進 Guild 之後，對話裡 spawn 那個名字即可。也可把檔案放到 ~/.codex/agents/ 給 Codex 用。", "Write Codex-compatible TOML (name / description / developer_instructions). After it is in Guild, spawn that name from chat. You can also copy the file to ~/.codex/agents/ for Codex."],
  ["subagentsAdd.tabPaste", "貼上 TOML", "Paste TOML"],
  ["subagentsAdd.aiTitle", "描述角色，請 AI 生成 TOML", "Describe the role, then generate TOML"],
  ["subagentsAdd.what", "這個子代理要做什麼？", "What should this subagent do?"],
  ["subagentsAdd.whatPh", "唯讀搜尋 auth 流程，回絕對路徑", "Read-only search for the auth flow; return absolute paths"],
  ["subagentsAdd.gen", "用 AI 生成 SUBAGENT.toml", "Generate SUBAGENT.toml"],
  ["subagentsAdd.pasteTitle", "貼上現成的 Codex / Grok agent", "Paste a Codex / Grok agent"],
  ["subagentsAdd.pasteHint", "TOML（Codex ~/.codex/agents）或 Markdown frontmatter（Grok / Claude agents）。", "TOML from ~/.codex/agents, or Markdown frontmatter from Grok / Claude agents."],
  ["subagentsAdd.save", "加入子代理庫", "Add to library"],
  ["subagentsAdd.saved", "已加入 {name}", "Added {name}"],
  ["mcp.title", "MCP", "MCP"],
  ["mcp.lede", "連接器，不是技能。Skill 是說明書；MCP 是工具伺服器。連上之後，對話裡的 bot 可以直接 call 這些 tools。本機 Codex / Claude / Cursor 的 MCP 會列出來，匯入後才會進 Guild。", "Connectors, not skills. Skills are instructions; MCP is a tool server. After it is connected, bots can call those tools. Codex / Claude / Cursor MCP configs on this machine show up here; import them into Guild to use them."],
  ["mcp.install", "連接伺服器", "Add server"],
  ["mcp.count", "{n} 個 MCP · 點卡片看啟動指令", "{n} MCP servers · click a card for the launch command"],
  ["mcp.emptyHtml", "還沒有 MCP。到 <a href=\"/mcp/add\">連接伺服器</a>，或從本機 Codex / Claude 匯入。", "No MCP yet. Add one from <a href=\"/mcp/add\">Add server</a>, or import from Codex / Claude on this machine."],
  ["mcp.host", "本機 CLI 設定，匯入後對話才會用", "On disk; import into Guild before chat can use it"],
  ["mcp.guildHint", "已連接。對話裡的 bot 都能用這些 tools。", "Connected. Bots in chat can call these tools."],
  ["mcp.import", "匯入 Guild", "Import to Guild"],
  ["mcp.delete", "移除", "Remove"],
  ["mcpAdd.title", "連接 MCP", "Add MCP"],
  ["mcpAdd.lede", "stdio 伺服器（command + args），跟 Codex config.toml / Claude MCP JSON 同一套。這不是技能，不要寫進技能庫。", "stdio servers (command + args), same shape as Codex config.toml / Claude MCP JSON. This is not a skill. Do not put it in the skills library."],
  ["mcpAdd.name", "名稱", "Name"],
  ["mcpAdd.command", "命令", "Command"],
  ["mcpAdd.args", "參數（空白分隔）", "Args (space-separated)"],
  ["mcpAdd.env", "環境變數 KEY=value，一行一個", "Env KEY=value, one per line"],
  ["mcpAdd.save", "連接", "Connect"],
  ["mcpAdd.saved", "已連接 {name}", "Connected {name}"],
  ["mcpAdd.imported", "已匯入 {name}", "Imported {name}"],
  ["mcpAdd.needName", "名稱和命令都要有", "Name and command are both required"],
  ["mcpAdd.hostTitle", "從本機 CLI 匯入", "Import from a local CLI"],
  ["mcpAdd.noHost", "這台機器上還沒掃到 Codex / Claude / Cursor 的 MCP。", "No Codex / Claude / Cursor MCP configs found on this machine."],
  ["library.local", "本機", "Host"],
  ["settings.eyebrow", "Hermes-style", "Hermes-style"],
  ["settings.title", "模型", "Models"],
  ["settings.lede", "訂閱帳號走 OAuth。API key 可同時掛多家供應商，寫入 ~/.guild/models.json。", "Log in with a subscription. API keys can cover several providers and are written to ~/.guild/models.json."],
  ["settings.accounts", "連接帳號", "Accounts"],
  ["settings.accountsHint", "用訂閱登入，不必複製金鑰。瀏覽器完成授權後會自動刷新 token。", "Subscription login, no key paste. Tokens refresh after the browser handshake."],
  ["settings.connect", "連接", "Connect"],
  ["settings.logout", "登出", "Log out"],
  ["settings.connected", "已連接", "Connected"],
  ["settings.pending", "登入中", "Signing in"],
  ["settings.keys", "API 金鑰供應商", "API key providers"],
  ["settings.keysHint", "點名稱切換供應商。要加新的，點「＋ 新增」。金鑰可用 $ENV 或直接貼上。", "Tap a name to switch. Tap “+ Add” for a new provider. Keys can be $ENV or pasted."],
  ["settings.noProviders", "還沒有供應商。點「＋ 新增」選一家模板。", "No providers yet. Tap “+ Add” and pick a template."],
  ["settings.addProvider", "新增供應商", "Add provider"],
  ["settings.addChip", "＋ 新增", "+ Add"],
  ["settings.pickTemplate", "選一家模板，會帶好 endpoint 與環境變數名稱。", "Pick a template. Endpoint and env var name come filled in."],
  ["settings.saveKey", "儲存 {name} 金鑰", "Save {name} key"],
  ["settings.saveKeyHint", "只寫入這家供應商的 ID、endpoint 與金鑰", "Writes this provider's id, endpoint, and key"],
  ["settings.main", "主模型", "Default model"],
  ["settings.mainHint", "新對話預設用這個。下面每一列會寫出實際在跑的模型。", "New chats use this. Each row below shows the model that actually runs."],
  ["settings.provider", "供應商", "Provider"],
  ["settings.apply", "套用", "Apply"],
  ["settings.aux", "輔助模型", "Auxiliary models"],
  ["settings.auxHint", "Vision、Web extract、Compression 等每一列都寫出實際模型。跟主模型時仍顯示名稱，不是空白。", "Each row — Vision, web extract, compression, and the rest — shows the model in use. Inherited rows still name the default."],
  ["settings.auxReset", "全部改回主模型", "Reset all to default"],
  ["settings.useMain", "改回跟主模型", "Follow default"],
  ["settings.change", "更改", "Change"],
  ["settings.task", "用途", "Task"],
  ["settings.using", "目前使用", "In use"],
  ["settings.inherited", "跟主模型", "Follows default"],
  ["settings.override", "自訂", "Override"],
  ["settings.noDefault", "尚未設定主模型", "No default model"],
  ["settings.currentMain", "目前主模型：{name}", "Default: {name}"],
  ["settings.delete", "刪除", "Delete"],
  ["settings.locale", "介面語言", "Language"],
  ["settings.localeHint", "寫進這個瀏覽器。訊息、酒吧、工坊、模型共用。", "Saved in this browser. Shared by Chat, Bar, Workshop, and Models."],
  ["settings.oauthCode", "在瀏覽器開啟授權頁，輸入代碼：", "Open the auth page and enter this code:"],
  ["settings.oauthBrowser", "在瀏覽器完成授權。若 popup 被擋，用下面的連結。", "Finish in the browser. If the popup is blocked, use the link below."],
  ["settings.openAuth", "開啟授權頁", "Open auth page"],
  ["settings.pasteHint", "若瀏覽器在別台機器，貼上導向網址或 code", "If the browser is on another machine, paste the redirect URL or code"],
  ["settings.finishLogin", "完成登入", "Finish login"],
  ["settings.custom", "自訂 endpoint", "Custom endpoint"],
  ["settings.notLoggedIn", "（未登入）", " (signed out)"],
  ["settings.filled", "已填", "Set"],
  ["settings.emptyKey", "未填", "Empty"],
  ["settings.displayName", "顯示名稱", "Display name"],
  ["settings.addModel", "＋ 模型", "+ model"],
  ["settings.thisProvider", "這個供應商", "this provider"],
  ["settings.notReady", "這個供應商還沒登入或沒有 API key", "This provider is not signed in and has no API key"],
  ["settings.applied", "已套用 {name}", "Applied {name}"],
  ["settings.appliedDefault", "預設", "default"],
  ["settings.auxChange", "更改輔助模型", "Change auxiliary model"],
  ["settings.auxChangeName", "更改 {name}", "Change {name}"],
  ["settings.connectFirst", "先連接這個供應商", "Connect this provider first"],
  ["settings.waitingAuth", "授權後這個頁面會自動偵測", "This page watches for the handshake"],
  ["settings.connectedId", "已連接 {id}", "Connected {id}"],
  ["settings.savedKeyFlash", "已儲存 {name} 金鑰", "Saved {name} key"],
  ["settings.autoMain", "跟主模型", "auto · use main model"],
  ["settings.name", "名稱", "Name"],
  ["studio.enter", "進酒館", "Enter the inn"],
  ["studio.streetAlt", "Guild 酒館門口", "Guild inn door"],
  ["studio.leave", "出門", "Leave"],
  ["studio.inn", "酒館", "Inn"],
  ["studio.streetLine", "夜晚的酒館還開著。點那扇門進去。", "The inn is still open. Tap the door."],
  ["studio.tonight", "今晚", "Tonight"],
  ["studio.hire", "招募新人", "Hire someone"],
  ["studio.hireLede", "寫好 Soul / Agent / Position，勾技能（含本機 Codex、Grok 等 CLI），請他入座。", "Write Soul / Agent / Position, staff skills (including local Codex, Grok, and other CLI skills), then seat them."],
  ["studio.oneLiner", "一句話", "One-liner"],
  ["studio.oneLinerPh", "這個 bot 在團隊裡做什麼", "What this bot does on the team"],
  ["studio.soulHint", "性格、聲音、邊界。", "Voice, character, boundaries."],
  ["studio.desc", "描述", "Prompt"],
  ["studio.soulPh", "謹慎、少廢話的資深工程師", "A careful senior engineer who talks little"],
  ["studio.genMd", "用 AI 生成 Markdown", "Generate markdown"],
  ["studio.agentHint", "怎麼做事的 SOP。", "How they work."],
  ["studio.agentPh", "先寫測試，再改最小程式", "Tests first, then the smallest change"],
  ["studio.posHint", "職位職責與完成定義。", "Role and definition of done."],
  ["studio.posPh", "這個專案的 Engineer", "Engineer on this project"],
  ["studio.botSkills", "這個 bot 的技能（含本機 CLI）", "This bot's skills (including local CLI)"],
  ["studio.botSkillsHint", "Guild 技能庫，加上本機 Claude、Codex、Pi、Grok、Cursor、DSH 的 SKILL.md。勾或取消會立刻存檔，拷進 Guild 再配給這個人。沒有的可到 <a href=\"/skills/add\">追加技能</a> 安裝，不影響其他人。", "The Guild library plus SKILL.md on disk from Claude, Codex, Pi, Grok, Cursor, and DSH. Checks save immediately and copy a host skill into Guild for this person. Missing ones go through <a href=\"/skills/add\">Add skill</a>."],
  ["studio.searchSkills", "搜尋技能庫", "Search skills"],
  ["studio.nonePicked", "尚未勾選", "None selected"],
  ["studio.more", "查看更多", "Show more"],
  ["studio.seat", "請他入座", "Seat them"],
  ["studio.editEyebrow", "Edit", "Edit"],
  ["studio.editTitle", "改這個人的設定", "Edit this person"],
  ["studio.editLede", "每個 Markdown 自己儲存。技能勾了或取消會立刻生效。", "Each markdown block saves on its own. Skill checks save immediately."],
  ["studio.saveMd", "儲存 {file}", "Save {file}"],
  ["studio.savedMd", "已儲存 {file}", "Saved {file}"],
  ["studio.saveIdentity", "儲存名字", "Save name"],
  ["studio.savedIdentity", "已儲存名字", "Name saved"],
  ["studio.skillsSaved", "技能已儲存", "Skills saved"],
  ["studio.needSkill", "至少要留一項技能", "Keep at least one skill"],
  ["studio.editDocTitle", "Guild — 設定 bot", "Guild — Edit bot"],
  ["studio.picked", "這個 bot 勾了 {n} 項 · Guild {guild} · 本機 CLI {host}", "This bot has {n} selected · {guild} Guild · {host} local CLI"],
  ["studio.pickedChip", "已勾選", "Selected"],
  ["studio.hostFail", "本機 CLI 技能讀取失敗，先顯示 Guild 技能庫。", "Could not read local CLI skills; showing the Guild library only."],
  ["studio.skillLoading", "讀取 SKILL.md…", "Loading SKILL.md…"],
  ["studio.checkSkill", "勾選 {name}", "Select {name}"],
  ["studio.emptyLib", "還沒列出技能。Guild 會掃本機 Claude / Codex / Grok 的 SKILL.md；沒有的話先到追加技能安裝。", "No skills listed. Guild scans Claude / Codex / Grok SKILL.md on this machine; otherwise install one first."],
  ["studio.noMatch", "沒有符合的技能。", "No matching skills."],
  ["studio.moreN", "查看其餘 {n} 項", "Show {n} more"],
  ["studio.needPrompt", "先寫一句 {kind} 描述", "Write a {kind} prompt first"],
  ["studio.generating", "生成中…", "Generating…"],
  ["studio.generated", "{kind} Markdown 已生成（模型）", "{kind} markdown generated (model)"],
  ["studio.generatedLocal", "{kind} Markdown 已生成（本地稿）", "{kind} markdown generated (local draft)"],
  ["studio.savedHtml", "已儲存 @{handle} — 到 <a href=\"{href}\">訊息</a> 找他。", "Saved @{handle} — find them in <a href=\"{href}\">Chat</a>."],
  ["studio.seatedHtml", "已入座 @{handle} — 到 <a href=\"{href}\">訊息</a> 找他。", "Seated @{handle} — find them in <a href=\"{href}\">Chat</a>."],
  ["studio.editToast", "設定改好了。還要喝一杯嗎？", "Saved. Another round?"],
  ["studio.hireToast", "新來的。今晚第一杯我請。", "New hire. First round is on me."],
  ["studio.keeper", "掌櫃", "Keep"],
  ["studio.keeperLine", "進來坐。點裡面的人可以聊天或改設定。", "Come in. Tap someone to chat or edit."],
  ["studio.vacant", "空位", "Vacant"],
  ["studio.vacantLine", "空座位。要招人進來嗎？", "Empty stool. Hire someone?"],
  ["studio.hireChip", "招募", "Hire"],
  ["studio.drink", "……今晚在這兒喝酒。", "…drinking here tonight."],
  ["studio.notFound", "找不到這個 bot", "Bot not found"],
  ["studio.editing", "正在編輯 @{handle} · 勾選只屬於這個人", "Editing @{handle} · skills are only for this person"],
  ["skillsAdd.eyebrow", "Skills", "Skills"],
  ["skillsAdd.title", "追加技能", "Add skill"],
  ["skillsAdd.lede", "這裡才是安裝入口。裝進技能庫之後，再到酒吧點每個人，各自勾選要用的技能。", "This is the install door. After it is in the library, staff each bot from the bar."],
  ["skillsAdd.tabAi", "AI 生成", "AI generate"],
  ["skillsAdd.tabUrl", "網址下載", "From URL"],
  ["skillsAdd.tabGh", "GitHub repo", "GitHub repo"],
  ["skillsAdd.aiTitle", "自行輸入，請 AI 生成", "Describe it, then generate"],
  ["skillsAdd.what", "這項技能要做什麼？", "What should this skill do?"],
  ["skillsAdd.whatPh", "審查 PR 的安全風險，並寫成可執行的修法", "Review a PR for security risk and write a fix"],
  ["skillsAdd.gen", "用 AI 生成 SKILL.md", "Generate SKILL.md"],
  ["skillsAdd.name", "名稱", "Name"],
  ["skillsAdd.save", "加入技能庫", "Add to library"],
  ["skillsAdd.urlTitle", "從網上下載", "Download from the web"],
  ["skillsAdd.urlHint", "貼 SKILL.md 的直接連結（raw 檔或 GitHub blob）。", "Paste a direct SKILL.md link (raw file or GitHub blob)."],
  ["skillsAdd.urlImport", "下載並加入", "Download and add"],
  ["skillsAdd.ghTitle", "載入 GitHub repo", "Load a GitHub repo"],
  ["skillsAdd.ghHint", "掃描 repo 內所有 SKILL.md。例：owner/repo 或完整 GitHub 網址。", "Scan every SKILL.md in the repo. Example: owner/repo or a GitHub URL."],
  ["skillsAdd.ghImport", "掃描並加入", "Scan and add"],
  ["skillsAdd.recent", "剛裝進技能庫的會出現在下面", "Newly installed skills show up below"],
  ["skillsAdd.recentHint", "完整清單在 <a href=\"/library\">技能庫</a>。要讓某人帶上，到 <a href=\"/studio\">酒吧</a> 點那個人勾選。", "Full list is in <a href=\"/library\">Skills</a>. Staff someone from the <a href=\"/studio\">bar</a>."],
  ["skillsAdd.needDesc", "先寫技能描述", "Write a skill prompt first"],
  ["skillsAdd.generated", "已生成（模型）", "Generated (model)"],
  ["skillsAdd.generatedLocal", "已生成（本地稿），可再改", "Generated (local draft), editable"],
  ["skillsAdd.needName", "名稱與 SKILL.md 都要有", "Name and SKILL.md are both required"],
  ["skillsAdd.added", "已加入技能庫：{name}", "Added to library: {name}"],
  ["skillsAdd.imported", "已加入 {n} 項：{names}", "Added {n}: {names}"],
  ["skillsAdd.needUrl", "貼上 SKILL.md 網址", "Paste a SKILL.md URL"],
  ["skillsAdd.empty", "還沒有技能。用上面三種方式安裝。", "No skills yet. Use one of the three install paths."],
  ["skillsAdd.catalog", "系統", "Bundled"],
  ["skillsAdd.needRepo", "填 owner/repo 或 GitHub 網址", "Fill owner/repo or a GitHub URL"],
  ["tag.development", "開發", "Dev"],
  ["tag.design", "設計", "Design"],
  ["tag.code-review", "Code Review", "Code Review"],
  ["tag.testing", "測試", "Test"],
  ["tag.browser", "瀏覽器", "Browser"],
  ["tag.research", "研究", "Research"],
  ["tag.git", "Git", "Git"],
  ["tag.security", "安全", "Security"],
  ["tag.document", "文件", "Docs"],
  ["tag.api", "API", "API"],
  ["tag.product", "產品", "Product"],
  ["tag.communication", "溝通", "Comms"],
  ["tag.data-analysis", "數據", "Data"],
  ["tag.qa", "QA", "QA"],
  ["tag.claude", "Claude", "Claude"],
  ["tag.codex", "Codex", "Codex"],
  ["tag.pi", "Pi", "Pi"],
  ["tag.grok", "Grok", "Grok"],
  ["tag.cursor", "Cursor", "Cursor"],
  ["tag.dsh", "DSH", "DSH"],
  ["tag.guild", "Guild", "Guild"],
  ["tag.explore", "探索", "Explore"],
  ["tag.implement", "實作", "Implement"],
  ["tag.review", "審查", "Review"],
  ["tag.read-only", "唯讀", "Read-only"],
  ["lang.zh", "中", "中"],
  ["lang.en", "EN", "EN"],
  ["sidebar.resize", "拖曳調整寬度", "Drag to resize"],
];

var I18N = { "zh-Hant": {}, en: {} };
I18N_ROWS.forEach(function (row) {
  I18N["zh-Hant"][row[0]] = row[1];
  I18N.en[row[0]] = row[2];
});

var currentLocale = "";

function guildLocale() {
  if (currentLocale && I18N[currentLocale]) return currentLocale;
  try {
    var saved = localStorage.getItem("guild-locale");
    if (saved && I18N[saved]) {
      currentLocale = saved;
      return saved;
    }
  } catch (err) {
    /* ignore */
  }
  var nav = String(
    (typeof navigator !== "undefined" && (navigator.language || navigator.userLanguage)) ||
      "",
  ).toLowerCase();
  currentLocale = nav.indexOf("zh") === 0 ? "zh-Hant" : "en";
  return currentLocale;
}

function t(key, vars) {
  var locale = guildLocale();
  var dict = I18N[locale] || I18N["zh-Hant"];
  var text = (dict && dict[key]) || (I18N["zh-Hant"] && I18N["zh-Hant"][key]) || key;
  if (vars) {
    Object.keys(vars).forEach(function (name) {
      text = String(text).split("{" + name + "}").join(String(vars[name]));
    });
  }
  return text;
}

function tagLabel(tag) {
  var key = "tag." + tag;
  var locale = guildLocale();
  var dict = I18N[locale] || I18N["zh-Hant"];
  if (dict && dict[key]) return dict[key];
  if (I18N["zh-Hant"] && I18N["zh-Hant"][key]) return I18N["zh-Hant"][key];
  return tag;
}

function applyI18n(root) {
  var scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope || !scope.querySelectorAll) return;
  var locale = guildLocale();
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = locale === "en" ? "en" : "zh-Hant";
    var page = document.body && document.body.getAttribute("data-i18n-page");
    if (page) document.title = t("title." + page);
  }
  scope.querySelectorAll("[data-i18n]").forEach(function (el) {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  scope.querySelectorAll("[data-i18n-html]").forEach(function (el) {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  scope.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
  scope.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  scope.querySelectorAll("[data-locale]").forEach(function (el) {
    el.classList.toggle("on", el.getAttribute("data-locale") === locale);
  });
}

function setGuildLocale(locale) {
  if (!I18N[locale]) return;
  currentLocale = locale;
  try {
    localStorage.setItem("guild-locale", locale);
  } catch (err) {
    /* ignore */
  }
  applyI18n();
  if (typeof window !== "undefined" && typeof Event === "function") {
    window.dispatchEvent(new Event("guild-locale"));
  }
}

function bindLocaleSwitch(root) {
  var scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope || !scope.addEventListener) return;
  scope.addEventListener("click", function (event) {
    var btn = event.target.closest("[data-locale]");
    if (!btn) return;
    event.preventDefault();
    setGuildLocale(btn.getAttribute("data-locale"));
  });
}

var SIDEBAR_MIN = 200;
var SIDEBAR_DEFAULT = 292;
var SIDEBAR_KEY = "guild-sidebar-w";

function sidebarMax() {
  var vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  return Math.min(560, Math.max(SIDEBAR_MIN, Math.floor(vw * 0.55)));
}

function sidebarWidth() {
  try {
    var n = Number(localStorage.getItem(SIDEBAR_KEY));
    if (n >= SIDEBAR_MIN && n <= 800) return Math.min(n, sidebarMax());
  } catch (err) {
    /* ignore */
  }
  return SIDEBAR_DEFAULT;
}

function applySidebarWidth(px) {
  var max = sidebarMax();
  var w = Math.round(Math.min(max, Math.max(SIDEBAR_MIN, Number(px) || SIDEBAR_DEFAULT)));
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.style.setProperty("--sidebar-w", w + "px");
  }
  return w;
}

function bindSidebarResize() {
  if (typeof document === "undefined") return;
  applySidebarWidth(sidebarWidth());
  var handle = document.querySelector(".sidebar-resizer");
  if (!handle) return;
  var dragging = false;
  function onMove(ev) {
    if (!dragging) return;
    applySidebarWidth(ev.clientX);
  }
  function onUp(ev) {
    if (!dragging) return;
    dragging = false;
    if (document.body) document.body.classList.remove("resizing-sidebar");
    try {
      localStorage.setItem(SIDEBAR_KEY, String(applySidebarWidth(ev.clientX)));
    } catch (err) {
      /* ignore */
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }
  handle.addEventListener("pointerdown", function (ev) {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    dragging = true;
    if (document.body) document.body.classList.add("resizing-sidebar");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
  handle.addEventListener("dblclick", function () {
    applySidebarWidth(SIDEBAR_DEFAULT);
    try {
      localStorage.setItem(SIDEBAR_KEY, String(SIDEBAR_DEFAULT));
    } catch (err) {
      /* ignore */
    }
  });
}

if (typeof document !== "undefined") {
  applySidebarWidth(sidebarWidth());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyI18n();
      bindLocaleSwitch(document);
      bindSidebarResize();
    });
  } else {
    applyI18n();
    bindLocaleSwitch(document);
    bindSidebarResize();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    I18N,
    I18N_ROWS,
    t,
    tagLabel,
    guildLocale,
    applyI18n,
    setGuildLocale,
    applySidebarWidth,
    sidebarWidth,
  };
}
