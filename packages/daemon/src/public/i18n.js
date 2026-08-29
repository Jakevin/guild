/** Guild UI strings. Default follows the browser; packs are zh-Hant and en. */
var I18N_ROWS = [
  ["title.chat", "Guild — 大廳", "Guild — Hall"],
  ["title.library", "Guild — 技能庫", "Guild — Skills"],
  ["title.subagents", "Guild — 子代理", "Guild — Subagents"],
  ["title.subagentsAdd", "Guild — 新增子代理", "Guild — Add subagent"],
  ["title.mcp", "Guild — MCP", "Guild — MCP"],
  ["title.mcpAdd", "Guild — 連接 MCP", "Guild — Add MCP"],
  ["title.settings", "Guild — 模型", "Guild — Models"],
  ["title.studio", "Guild — 編制", "Guild — Roster"],
  ["title.skillsAdd", "Guild — 追加技能", "Guild — Add skill"],
  ["nav.chat", "大廳", "Hall"],
  ["nav.studio", "編制", "Roster"],
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
  ["channels", "委託", "Channels"],
  ["dms", "密談", "Whispers"],
  ["newChannel", "新委託", "New channel"],
  ["newChannelName", "委託名稱", "Channel name"],
  ["create", "建立", "Create"],
  ["delete", "刪除", "Delete"],
  ["deleteFailed", "刪除失敗", "Couldn't delete"],
  ["msg.deleteConfirm", "刪除這則訊息？", "Delete this message?"],
  ["channel.delete", "刪除委託", "Delete channel"],
  ["channel.deleteConfirm", "刪除 #{name}？紀錄和委託書會一併刪掉。", "Delete #{name}? The log and Channel.md go with it."],
  ["channel.keepGeneral", "#general 不能刪。", "Can't delete #general."],
  ["channel.nameRequired", "委託要有名稱", "Channel needs a name"],
  ["bot.delete", "請這名冒險者離席", "Drop this adventurer"],
  ["bot.deleteConfirm", "讓 @{handle} 離席？密談與記憶會一併刪掉。", "Drop @{handle}? Their whispers and memory go with them."],
  ["members", "編制", "Roster"],
  ["members.in", "在這個據點", "In this hall"],
  ["members.out", "不在這個據點", "Not in this hall"],
  ["members.empty", "還沒有冒險者。", "No adventurers yet."],
  ["members.allIn", "編制裡的冒險者都在這個據點了。", "Everyone on the roster is already in this hall."],
  ["members.kick", "移出", "Remove"],
  ["members.add", "加入", "Add"],
  ["members.addDisabled", "滿席", "Full"],
  ["members.cap", "{used}/{max}", "{used}/{max}"],
  ["members.full", "這個據點最多 {max} 席。先移出一位，或改 @ 現有編制。", "This hall is full (max {max} seats). Remove someone, or @ a bot already here."],
  ["invite.title", "拉冒險者進據點", "Add adventurers"],
  ["invite.body", "先重用編制裡的人。一個據點最多 6 席，用 @handle 叫他們。", "Reuse the roster first. A hall holds 6 seats; @handle them here."],
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
  ["live.stop", "停止", "Stop"],
  ["live.steer", "插入這輪", "Insert into turn"],
  ["steer.queue", "排隊", "Queue"],
  ["steer.insert", "插入引導", "Steer"],
  ["steer.remove", "取消排隊", "Remove from queue"],
  ["steer.tag", "已插入這輪", "Inserted into this turn"],
  ["steer.waiting", "排隊中，這輪結束後送出", "Queued. Sends when this turn finishes."],
  ["steer.done", "已插入這輪，做完這步就會接著看", "Inserted. It will pick this up after the current step."],
  ["steer.live", "引導", "Steer"],
  ["busy", "忙碌中", "Busy"],
  ["unread", "未讀", "Unread"],
  ["noMessages", "還沒有紀錄。寫一句話開始。據點裡記得 @handle。", "No log yet. Say something. In a hall, @handle an adventurer."],
  ["dm", "密談", "Whisper"],
  ["justNow", "剛剛", "Just now"],
  ["minutesAgo", "{n} 分鐘前", "{n} min ago"],
  ["today", "今天", "Today"],
  ["yesterday", "昨天", "Yesterday"],
  ["noActivity", "尚無紀錄", "No log"],
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
  ["model.settings", "狀態欄", "Status"],
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
  ["attach.drop", "放到這裡", "Drop files here"],
  ["attach.files", "檔案", "Files"],
  ["attach.dirs", "資料夾", "Folders"],
  ["attach.skills", "技能", "Skills"],
  ["attach.agents", "子代理", "Subagents"],
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
  ["trace.live", "進行中", "in progress"],
  ["trace.loading", "讀取中…", "Loading…"],
  ["html.preview", "預覽", "Preview"],
  ["html.code", "原始碼", "Code"],
  ["html.expand", "放大預覽", "Expand preview"],
  ["html.zoom", "HTML 預覽", "HTML preview"],
  ["fence.toInput", "加入輸入框", "Insert into composer"],
  ["channel.md", "委託書", "Channel.md"],
  ["channel.mdHelp", "這個據點的委託書。用 @handle 叫冒險者時會讀到。密談沒有委託書。", "Brief for this hall. Adventurers see it when you @ them. Whispers have no Channel.md."],
  ["memory.bot", "MEMORY.md", "MEMORY.md"],
  ["memory.botHelp", "這名冒險者學會的站立筆記。有用的回合後會自動更新。", "Standing notes this adventurer has learned. Auto-updated after useful turns."],
  ["memory.channel", "據點 MEMORY.md", "Hall MEMORY.md"],
  ["memory.channelHelp", "這個據點共享的站立筆記。有用的回合後會自動更新。人寫的委託書優先。", "Shared notes for this hall. Auto-updated. The written Channel.md wins if they conflict."],
  ["bot.message", "密談", "Whisper"],
  ["bot.settings", "狀態欄", "Status"],
  ["notInChannel", "不在這個據點", "Not in this hall"],
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
  ["attach.agentBody", "請 spawn 子代理 `{name}`。", "Spawn subagent `{name}`."],
  ["attach.preview", "預覽 {name}", "Preview {name}"],
  ["attach.imageBody", "使用者附上圖片 `{name}`（{type}, {size} bytes）。以 {token} 引用。", "User attached image `{name}` ({type}, {size} bytes). Refer to it as {token}."],
  ["attach.uploadNoPath", "使用者上傳了檔案 `{name}`（{type}, {size} bytes）。瀏覽器沒有本機路徑，請改用「檔案」從磁碟選，或請我用 list/read 找。", "User uploaded `{name}` ({type}, {size} bytes). The browser has no host path — pick it from Files, or list/read for it."],
  ["attach.tooBig", "檔案 `{name}` 太大，沒有嵌進對話。請用「檔案」選本機路徑讓我 read。", "`{name}` is too large to embed. Pick it from Files so I can read the path."],
  ["attach.uploadText", "上傳檔案 `{name}`：", "Uploaded `{name}`:"],
  ["attach.noChannelMd", "這個據點還沒有委託書。請先在據點 icon 寫一份。", "This hall has no Channel.md yet. Write one from the hall icon."],
  ["attach.botRulesTitle", "@{handle} 規則", "@{handle} rules"],
  ["attach.noPersona", "這名冒險者還沒有人設。", "This adventurer has no persona yet."],
  ["slash.editMd", "編輯委託書", "Edit Channel.md"],
  ["slash.editMdHint", "委託說明", "Channel brief"],
  ["slash.rules", "附上規則", "Attach rules"],
  ["slash.rulesHint", "委託書 / 人設", "Channel.md / persona"],
  ["slash.git", "附上 Git", "Attach Git"],
  ["slash.here", "叫所有人", "Ping everyone"],
  ["slash.hereHint", "通知這個據點上的所有冒險者。通常是錯的：出活仍點名一人。", "Notify every adventurer in this hall. Usually wrong: call one @handle."],
  ["slash.library", "開工坊", "Open workshop"],
  ["slash.sec.skill", "技能", "Skills"],
  ["slash.sec.agent", "子代理", "Subagents"],
  ["slash.sec.cmd", "指令", "Commands"],
  ["slash.loading", "讀取技能與子代理…", "Loading skills and subagents…"],
  ["slash.empty", "沒有符合的技能或子代理。", "No matching skills or subagents."],
  ["mention.channel", "@所有人", "@everyone"],
  ["mention.channelHint", "通知這個據點上的所有冒險者。通常是錯的：出活仍點名一人。", "Notify every adventurer in this hall. Usually wrong: call one @handle."],
  ["mention.here", "@這裡", "@here"],
  ["mention.hereHint", "通知這個據點上的每個冒險者。通常是錯的：出活仍點名一人。", "Notify every adventurer here. Usually wrong: call one @handle."],
  ["library.eyebrow", "共用工具箱", "Shared toolbox"],
  ["library.title", "技能庫", "Skills"],
  ["library.lede", "公會自己的技能，加上本機 Claude、Codex、Pi、Grok、Cursor 留下的 SKILL.md。安裝走 <a href=\"/skills/add\">追加技能</a>；編制裡可以直接勾本機 CLI 技能。", "Guild skills plus SKILL.md left on this machine by Claude, Codex, Pi, Grok, and Cursor. Install via <a href=\"/skills/add\">Add skill</a>; staff them from the roster."],
  ["library.install", "安裝新技能", "Install skill"],
  ["library.add", "追加技能", "Add skill"],
  ["library.all", "全部", "All"],
  ["library.host", "本機技能，尚未裝進公會", "On disk, not staffed in the guild"],
  ["library.unused", "還沒有冒險者勾選", "No adventurer selected this yet"],
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
  ["mcp.lede", "連接器，不是技能。Skill 是說明書；MCP 是工具伺服器。本機 Codex / Claude / Cursor 的 MCP 會直接進對話，不必匯入。", "Connectors, not skills. Skills are instructions; MCP is a tool server. Codex / Claude / Cursor MCP configs on this machine are live in chat — no import step."],
  ["mcp.install", "連接伺服器", "Add server"],
  ["mcp.count", "{n} 個 MCP · 點卡片看啟動指令", "{n} MCP servers · click a card for the launch command"],
  ["mcp.emptyHtml", "還沒有 MCP。到 <a href=\"/mcp/add\">連接伺服器</a>，或在本機 Codex / Claude / Cursor 配好。", "No MCP yet. Add one from <a href=\"/mcp/add\">Add server</a>, or configure Codex / Claude / Cursor on this machine."],
  ["mcp.host", "本機 CLI，對話可直接用", "On disk; available in chat as-is"],
  ["mcp.guildHint", "已寫進公會。這個據點裡的冒險者都能用這些 tools。", "Saved in the guild. Adventurers in this hall can call these tools."],
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
  ["mcpAdd.hostTitle", "本機已發現", "Already on this machine"],
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
  ["settings.saveKey", "儲存", "Save"],
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
  ["settings.localeHint", "寫進這個瀏覽器。大廳、編制、工坊、模型共用。", "Saved in this browser. Shared by Hall, Roster, Workshop, and Models."],
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
  ["studio.hire", "招募冒險者", "Recruit an adventurer"],
  ["studio.hireLede", "寫好 Soul / Agent / Position，勾技能（含本機 Codex、Grok 等 CLI），請他入座。", "Write Soul / Agent / Position, staff skills (including local Codex, Grok, and other CLI skills), then seat them."],
  ["studio.oneLiner", "一句話", "One-liner"],
  ["studio.oneLinerPh", "這名冒險者在編制裡做什麼", "What this adventurer does on the roster"],
  ["studio.soulHint", "性格、聲音、邊界。", "Voice, character, boundaries."],
  ["studio.desc", "描述", "Prompt"],
  ["studio.soulPh", "謹慎、少廢話的資深工程師", "A careful senior engineer who talks little"],
  ["studio.genMd", "用 AI 生成 Markdown", "Generate markdown"],
  ["studio.agentHint", "怎麼做事的 SOP。", "How they work."],
  ["studio.agentPh", "先寫測試，再改最小程式", "Tests first, then the smallest change"],
  ["studio.posHint", "職位職責與完成定義。", "Role and definition of done."],
  ["studio.posPh", "這個專案的 Engineer", "Engineer on this project"],
  ["studio.botSkills", "這名冒險者的技能（含本機 CLI）", "This adventurer's skills (including local CLI)"],
  ["studio.botSkillsHint", "公會技能庫，加上本機 Claude、Codex、Pi、Grok、Cursor、DSH 的 SKILL.md。勾或取消會立刻存檔，拷進公會再配給這名冒險者。沒有的可到 <a href=\"/skills/add\">追加技能</a> 安裝，不影響其他人。", "The guild library plus SKILL.md on disk from Claude, Codex, Pi, Grok, Cursor, and DSH. Checks save immediately and copy a host skill into the guild for this adventurer. Missing ones go through <a href=\"/skills/add\">Add skill</a>."],
  ["studio.searchSkills", "搜尋技能庫", "Search skills"],
  ["studio.pickSkills", "用 AI 挑選", "Pick with AI"],
  ["studio.picking", "挑選中…", "Picking…"],
  ["studio.needMdForPick", "先寫 Soul / Agent / Position", "Write Soul / Agent / Position first"],
  ["studio.pickNone", "沒有對上的技能", "No matching skills"],
  ["studio.pickedDone", "已勾選 {n} 項", "Checked {n}"],
  ["studio.nonePicked", "尚未勾選", "None selected"],
  ["studio.more", "查看更多", "Show more"],
  ["studio.seat", "請他入座", "Seat them"],
  ["studio.editEyebrow", "Edit", "Edit"],
  ["studio.editTitle", "改這名冒險者的設定", "Edit this adventurer"],
  ["studio.editLede", "每個 Markdown 自己儲存。技能勾了或取消會立刻生效。", "Each markdown block saves on its own. Skill checks save immediately."],
  ["studio.saveMd", "儲存 {file}", "Save {file}"],
  ["studio.savedMd", "已儲存 {file}", "Saved {file}"],
  ["studio.saveIdentity", "儲存名字", "Save name"],
  ["studio.savedIdentity", "已儲存名字", "Name saved"],
  ["studio.skillsSaved", "技能已儲存", "Skills saved"],
  ["studio.needSkill", "至少要留一項技能", "Keep at least one skill"],
  ["studio.editDocTitle", "Guild — 設定冒險者", "Guild — Edit adventurer"],
  ["studio.picked", "這名冒險者勾了 {n} 項 · 公會 {guild} · 本機 CLI {host}", "This adventurer has {n} selected · {guild} guild · {host} local CLI"],
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
  ["studio.generatedSaved", "已生成並儲存 {file}", "Generated and saved {file}"],
  ["studio.generatedSavedLocal", "已生成並儲存 {file}（本地稿）", "Generated and saved {file} (local draft)"],
  ["studio.savedHtml", "已儲存 @{handle} — 到 <a href=\"{href}\">大廳</a> 找他。", "Saved @{handle} — find them in the <a href=\"{href}\">hall</a>."],
  ["studio.seatedHtml", "已入座 @{handle} — 到 <a href=\"{href}\">大廳</a> 找他。", "Seated @{handle} — find them in the <a href=\"{href}\">hall</a>."],
  ["studio.editToast", "設定改好了。", "Saved."],
  ["studio.hireToast", "新冒險者入席。", "New adventurer seated."],
  ["studio.keeper", "掌櫃", "Keep"],
  ["studio.keeperLine", "進來坐。點裡面的人可以密談或改設定。", "Come in. Tap someone to whisper or edit."],
  ["studio.vacant", "空位", "Vacant"],
  ["studio.vacantLine", "空座位。要招冒險者進來嗎？", "Empty seat. Recruit someone?"],
  ["studio.hireChip", "招募", "Hire"],
  ["studio.drink", "……今晚在這兒喝酒。", "…drinking here tonight."],
  ["studio.notFound", "找不到這名冒險者", "Adventurer not found"],
  ["studio.editing", "正在編輯 @{handle} · 勾選只屬於這名冒險者", "Editing @{handle} · skills are only for this adventurer"],
  ["skillsAdd.eyebrow", "Skills", "Skills"],
  ["skillsAdd.title", "追加技能", "Add skill"],
  ["skillsAdd.lede", "這裡才是安裝入口。裝進技能庫之後，再到編制點每名冒險者，各自勾選要用的技能。", "This is the install door. After it is in the library, staff each adventurer from the roster."],
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
  ["skillsAdd.recentHint", "完整清單在 <a href=\"/library\">技能庫</a>。要讓冒險者帶上，到 <a href=\"/studio\">編制</a> 點那個人勾選。", "Full list is in <a href=\"/library\">Skills</a>. Staff an adventurer from the <a href=\"/studio\">roster</a>."],
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
  scope.querySelectorAll("[data-i18n-drop]").forEach(function (el) {
    el.setAttribute("data-drop-hint", t(el.getAttribute("data-i18n-drop")));
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
