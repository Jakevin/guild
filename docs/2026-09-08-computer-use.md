# Computer use

Guild bots drive macOS GUI apps through a native `computer` tool. Not a skill.

- Helper: `packages/daemon/native/guildmac/main.swift` (Guild-owned; not vendored).
- Grant: first call pauses the live row (允許 / 不允許). Allow writes `GUILD_HOME/computer.json`. Deny is this turn only.
- Chrome/Safari/Edge/Arc stay on `browser`. `computer` refuses those windows.
- Writes refuse when the window is off the current Space or the user is at the keyboard.
- Default `op` / click / type post events to the target pid (no focus steal). `focus=true` borrows the front app and flashes a capture-invisible HUD.
- `ax` dumps the accessibility tree (`e1`…). `axset` writes a value by ref. `see` is screenshot + AX.
