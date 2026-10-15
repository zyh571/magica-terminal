# Magica Terminal for Windows

A port of the GTK app to Electron: [xterm.js](https://xtermjs.org) draws the terminals and node-pty runs the shells
through ConPTY. The figures, colours, keys, reactions, `pair` / `magica` layouts and session restore match the Linux
version. Figures come from `../figures`.

## Install

Needs Node.js 20 or newer.

```powershell
cd windows
npm install
npm install-scripts approve node-pty   # if npm says node-pty's install scripts weren't run; then `npm rebuild node-pty`
npm start                              # run it
npm run shortcut                       # Start Menu entry with Ctrl+Alt+T (also lets it show notifications)
```

The shortcut runs this folder through Electron, so edits here show up in new windows. Ctrl+Alt+T opens a new window
from anywhere (`HOTKEY` in `main.js`; re-run `npm run shortcut` after changing it).

## Shell

Panes run PowerShell 7 (`pwsh`) if it's installed, otherwise Windows PowerShell. Set `MAGICA_SHELL` to use something
else (without the shell integration). `shell/magica.ps1` is dot-sourced after your `$PROFILE`. It does what
`shell/magica.bash` does: the `madoka@magica` prompt, the character commands, and reporting command start/end
(OSC 666) and the current folder (OSC 9;9) to the terminal.

- `madoka`, `homura`, `sayaka`, `mami`, `kyoko` switch the pane's character. `pair` and `magica` lay out the tab.
- `kyubey` opens an elevated shell as Kyubey through Windows' own `sudo`. Turn it on in Settings > System > Advanced >
  Enable sudo, and set it to **Inline** so it runs inside the pane.

## Differences from the Linux version

- Settings are the constants at the top of `renderer.js`; those wrapped in `setting()` can be overridden in
  `%APPDATA%\magica-terminal\settings.json` by their lower-case names. The shell, config folder and window live in `main.js`.
- Config and session are in `%APPDATA%\magica-terminal\`.
- Ctrl+click opens URLs, OSC 8 links and Windows paths (`C:\…`, `~\…`) that exist.
- Ctrl+C in PowerShell ends a native program with `STATUS_CONTROL_C_EXIT`, which doesn't count as a failure (like 130
  on Linux).
- In a restored session, a tab's shells start the first time you open the tab.
- F12 opens the DevTools.
