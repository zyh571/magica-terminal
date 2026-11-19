# Magica Terminal

A terminal where every pane belongs to a Puella Magi Madoka Magica character. Her HELLO! GOOD SMILE figure stands in
the bottom-right corner, and the prompt, cursor and selection use her colour. It runs on Linux, macOS and Windows
(Tauri: Rust for the terminals and files, xterm.js in the system web view for the window).

## Install

It builds from source with Rust and Node.js 20+; the installers offer to install whatever's missing.

**Linux** (also needs WebKitGTK's development files; on Ubuntu the script offers to `apt install` them):

```sh
./install.sh            # builds it, links ~/.local/bin/magica-terminal and adds it to your app launcher
./install.sh --default  # …and makes it the default terminal (Ubuntu's xdg-terminal-exec)
```

**macOS:**

```sh
./install.sh   # builds Magica Terminal.app into ~/Applications and links ~/.local/bin/magica-terminal
```

It's unsigned, so if macOS won't open it the first time, right-click it and choose Open.

**Windows 11** (in PowerShell):

```powershell
.\install.ps1   # builds it into %LOCALAPPDATA%\Programs\magica-terminal, adds it to PATH and the Start Menu
```

If Rust, Node.js or the C++ build tools are missing, it offers to install them with `winget` (the build tools take a
while and ask for admin). If PowerShell won't run scripts, use `powershell -ExecutionPolicy Bypass -File .\install.ps1`.

Run the installer again after `git pull` or an edit. It also removes what the old Python version installed (its
`~/.bashrc` line and GNOME Shell extension); your notes, Crush score, settings and last session carry over.

To uninstall the app without deleting your notes, settings, or saved sessions:

```sh
./install.sh --uninstall       # Linux or macOS
```

```powershell
.\install.ps1 -Uninstall      # Windows
```

## Keys

| | Linux, Windows | macOS |
|---|---|---|
| split right / down | Ctrl+Shift+O / Ctrl+Shift+E | Cmd+D / Cmd+Shift+D |
| close pane | Ctrl+Shift+W | Cmd+W |
| move between panes | Ctrl+Alt+Arrows | Cmd+Option+Arrows |
| new tab | Ctrl+Shift+T | Cmd+T |
| previous / next tab | Ctrl+PageUp / PageDown | Cmd+Shift+[ / ] |
| tab 1…8 / last tab | Ctrl+1…8 / Ctrl+9 | Cmd+1…8 / Cmd+9 |
| rename tab (or double-click it; empty name goes back to hers) | Ctrl+Shift+R | Cmd+Shift+R |
| copy / paste | Ctrl+Shift+C / V | Cmd+C / V |
| font size | Ctrl+Shift+Plus / Minus / 0 | Cmd+Plus / Minus / 0 |
| light / dark | Ctrl+Shift+L | Cmd+Shift+L |
| search (Enter older, Shift+Enter newer, Esc) | Ctrl+Shift+F | Cmd+F |
| open a link or file path | Ctrl+click | Cmd+click |

On macOS, Ctrl+C still goes to the program and Option works as Meta (Option+B / F move by word).

## In the shell

The integration covers bash (4+), zsh and PowerShell. Other shells (cmd.exe, WSL, fish) start plainly.

- `madoka`, `homura`, `sayaka`, `mami`, `kyoko` switch the pane's character. Their witch names work too:
  `kriemhild`, `homulilly`, `oktavia`, `candeloro`, `ophelia`.
- `kyubey` opens a root shell as Kyubey (`sudo`; on Windows `sudo` or `gsudo`); `exit` brings her back.
- `pair` lays out Madoka | Homura; `magica` all five (in a new tab if the current one is split).
- `crush` opens Magica Crush, a match-3 game, in that pane. Esc or q goes back to the prompt.
- `note` opens the notepad over that pane: one plain sheet in the theme and her colour, saved as you type to
  `note.txt` in the config folder. `<head>Title<head>` makes a header (listed down the left, click to jump) and
  `*word*` makes a word bold; the tags show only while the cursor is on them. Ctrl+Z / Cmd+Z undoes. While it's open
  the window stays on top of other windows, so a small window works as a sticky note. `note buy milk` adds a line
  without opening it.
- `space [folder]` shows what takes up the disk there: every item with a bar for its size, biggest first, filling in
  while it scans. Click a folder to go in, double-click a file to open it, Backspace goes up (past where you started,
  too), C cds the shell there, Esc or q goes back.
- In a folder with a `.env`, its `KEY=value` lines are set in the shell. The first time, she asks; `y` / `n` is
  remembered per folder in `env-trust` in the config folder (delete its line to be asked again). Leaving the folder
  puts every key back as it was. The file is only read, never run.

From outside, `magica-terminal --crush` or `--note` opens a window with the game or notepad, and
`magica-terminal -e CMD…` runs a command in its first pane. Typed inside a Magica pane, `--crush` and `--note` open in
that pane.

Programs that ask the terminal for light/dark mode get the current theme's answer; in Claude Code, pick
**Auto (match terminal)** in `/theme`.

## Settings and files

The config folder is `~/.config/magica-terminal/` on Linux, `~/Library/Application Support/magica-terminal/` on macOS
and `%APPDATA%\magica-terminal\` on Windows. `settings.json` there overrides the defaults in
[`app/core/src/settings.rs`](app/core/src/settings.rs) by their lower-case names, for example:

```json
{ "font": "Maple Mono 12", "figure_opacity": 0.5, "idle_every": [4, 8], "notify": false }
```

Changes apply to new windows; unknown names and bad values are ignored with a warning. The font is Maple Mono (SIL Open
Font License), bundled with the app.

Closing the window saves the tabs (and their names), splits, characters, folders and what's in each pane (its last 2000 lines, plain
text) to `session.json`, readable only by you since that text can hold secrets. The next launch restores them, each
pane's old text above a faint "restored" line. A pane that had a coding agent running gets it back: Claude Code that
exact conversation, Codex and opencode that folder's latest session. A full-screen app open at the time (vim, say)
comes back as a copy of its last screen. A second window opened while one is running starts fresh.

Everything is saved through a temporary file renamed over the old one, so a crash mid-save never leaves a half-written
file.

## Known limits

- GNOME on Wayland doesn't let a window keep itself on top, so the notepad may not stay above other windows there.
- macOS: bash integration needs bash 4+ (Homebrew's); the stock zsh is fully supported.
- Windows: Git Bash, cmd.exe and WSL start without the integration; use PowerShell (pwsh 7 if installed).

## Development

`app/` holds it all: `core/` (Rust: terminals, shells, session, agents, disk scan, settings, command line),
`src-tauri/` (the Tauri app and its commands), `src/` (the window, in TypeScript), `shell/` (the bash, zsh and
PowerShell integration) and `public/` (figures and font).

```sh
cd app
npm ci
npm run tauri dev   # run from the source
npm test            # front end and shell integration
cargo test          # Rust
```

`docs/os-checklist.md` is the hand check for each OS.
