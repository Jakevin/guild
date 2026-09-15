# Computer use

Guild bots drive macOS GUI apps through a native `computer` tool. Not a skill.

- Helper: `packages/daemon/native/guildmac/main.swift` (Guild-owned; not vendored).
- Grant: first call pauses the live row (允許 / 不允許). Allow writes `GUILD_HOME/computer.json`. Deny is this turn only.
- Chrome/Safari/Edge/Arc stay on `browser`. `computer` refuses those windows.
- Writes refuse when the window is off the current Space or the user is at the keyboard.
- Default `op` / click / type post events to the target pid (no focus steal). `focus=true` borrows the front app and flashes a capture-invisible HUD.
- `ax` / `see` return `look=L4` and a folded AX tree (interactive controls first). Search with `query` + `look`; expand with `ref` + `look`. Full dump stays in guildd (last 8 looks).
- `axset` / `press` require that `look` and `eN`. Helper re-walks and matches `{role, pos, title}` — stale index fails closed (`Call ax again`).
- `axset` re-reads the value (`outcome=worked|didnt`). `press` is `AXPress` (`outcome=unknown`).
- `op` is still window-local coordinates (not look-bound). Chrome/Safari/Edge/Arc stay on `browser`.
