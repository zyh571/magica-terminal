# Magica Terminal: macOS and Windows check

Built and tested on Ubuntu only, so please go through this list once on each OS. Mark anything that's off and
note what you saw. Then one round of fixes follows.

## Install

**macOS:** `xcode-select --install` (if asked), Rust (`curl https://sh.rustup.rs -sSf | sh`) and Node
(`brew install node`). Then, in the checkout:

```sh
./install.sh
```

The first launch: right-click `~/Applications/Magica Terminal.app` → Open (it's unsigned).

**Windows 11:** in PowerShell:

```powershell
winget install Rustlang.Rustup OpenJS.NodeJS.LTS
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
.\install.ps1
```

If SmartScreen complains, choose More info → Run anyway. Start it from the Start Menu ("Magica Terminal") or as
`magica-terminal`.

## The checks (each OS)

Keys below are written as macOS / Windows.

### Window and panes
- [ ] The window opens with a prompt `madoka@magica:~$` (`>` on Windows) in pink, a pink dot and `madoka@magica` in the title bar
- [ ] macOS: the red/yellow/green buttons sit at the top left, over the title bar; Windows: – □ ✕ at the top right work
- [ ] The title bar drags the window; the folder in it follows `cd`
- [ ] Cmd+D / Ctrl+Shift+O splits right, Cmd+Shift+D / Ctrl+Shift+E splits down; the new pane is the next character
- [ ] Cmd+Option+Arrows / Ctrl+Alt+Arrows move between panes; the focused pane is lightly tinted in her colour
- [ ] Dragging the line between two panes resizes them
- [ ] Cmd+W / Ctrl+Shift+W closes a pane; `exit` in the last one closes the window
- [ ] Cmd+T / Ctrl+Shift+T opens a tab in the same folder; Cmd+Shift+[ ] / Ctrl+PageUp/Down and Cmd+1…9 / Ctrl+1…9 switch tabs
- [ ] Cmd+Shift+R / Ctrl+Shift+R (or double-clicking a tab) renames the tab: Enter keeps it, Esc cancels, an empty name goes back to hers; with one named tab the tab bar stays visible; the name comes back with the session
- [ ] Cmd+C / Ctrl+Shift+C copies the selection; Cmd+V / Ctrl+Shift+V pastes
- [ ] Ctrl+C in a running `ping` stops it (it goes to the program, also on macOS)
- [ ] macOS: Option+B / Option+F move by word in the shell (Option acts as Meta)
- [ ] Cmd+Plus / Minus / 0 (Ctrl+Shift+Plus / Minus / 0) change the font size in every pane
- [ ] Cmd+F / Ctrl+Shift+F searches: Enter goes to older matches, Shift+Enter to newer ones, Esc closes
- [ ] Cmd+click / Ctrl+click on `https://example.com` opens the browser; on an existing file path opens it
- [ ] The font is Maple Mono (rounded), bold works, emoji and CJK (`echo 魔法少女 🎀`) line up

### Characters and theme
- [ ] `homura`, `sayaka`, `mami`, `kyoko`, `madoka` switch the pane: prompt colour, cursor, figure, title dot
- [ ] Old prompt lines keep their character's colour after a switch
- [ ] Cmd+Shift+L / Ctrl+Shift+L flips light/dark; it's remembered at the next launch
- [ ] In Claude Code with `/theme` → Auto (match terminal), the light/dark flip is followed
- [ ] `pair` lays out Madoka | Homura; `magica` all five (in a new tab if the current one is split)

### Her figure
- [ ] She stands bottom-right, translucent, behind the text, at a sensible size when the window is small or maximised
- [ ] `true` → a small jump; `false` → a red squash and tint; Ctrl+C on `sleep 5` → no squash
- [ ] `sleep 11` in one pane, then click another pane: when it ends, she hops three times; with the window unfocused, a notification appears
- [ ] After ~15 s idle she bobs or breathes now and then

### Commands
- [ ] `crush` opens Magica Crush: swap gems by click and by drag, specials appear, A toggles autoplay, Esc goes back; the best score survives a restart
- [ ] `magica-terminal --crush` in a pane opens the game there; from outside (a plain terminal / Run box) it opens a new window with it
- [ ] `note` opens the notepad: text saves as you type, `<head>Title<head>` makes a header listed on the left (click jumps), `*word*` is bold, tags show only where the cursor is, Cmd+Z / Ctrl+Z undoes, Esc goes back
- [ ] While the notepad is open, the window stays above other windows
- [ ] `note buy milk` adds a line without opening it (`noted`)
- [ ] `space` shows the current folder's sizes filling in; click a folder to go in, Backspace to go up (past the start too), double-click a file to open it, C cds the shell there, Esc goes back
- [ ] `kyubey`: macOS asks for your password and gives a root shell as Kyubey (white/grey prompt with `#`); Windows uses `sudo` (enable it in Settings → System → For developers) or `gsudo`, else says it needs one; `exit` brings her back
- [ ] A folder with a `.env` (`A=1`): `cd` into it asks `load .env here?`; `y` loads it (`echo $A` / `$env:A`), leaving unloads it, the answer is remembered

### Session
- [ ] Two tabs, one split, a `homura` pane, some output; close the window and reopen: the same tabs, splits, characters, folders and text come back above a faint "restored" line
- [ ] With Claude Code running in a pane when you close: reopening resumes that conversation
- [ ] With `vim` open when you close: its last screen comes back as text
- [ ] A second window opened while one is running starts fresh (no restore)

### Settings
- [ ] `settings.json` in `~/Library/Application Support/magica-terminal/` (macOS) or `%APPDATA%\magica-terminal\` (Windows) with `{"figure_opacity": 0.8}` makes her more solid in new windows

## Known limits

- GNOME on Wayland may not keep the notepad window on top (no extension any more).
- Windows: the shell is PowerShell (pwsh if installed); cmd.exe and WSL shells start plainly without integration.
- macOS: bash integration needs bash 4+ (Homebrew's); the stock zsh is fully supported.
- Compile checks for macOS and Windows were run from Linux where possible; see `docs/superpowers/plans/os-check-notes.md` if present.

## Windows: first run (2026-11-13, Windows 11, no pwsh 7, so Windows PowerShell 5.1)

Done:
- `cargo test --workspace`: 38 pass (3 tests fixed: they hard-coded `/` separators and a `/tmp` folder).
- `npm test`: 114 pass. PowerShell's integration tests now run under Windows PowerShell when pwsh 7 is missing (as the
  app does), with Windows-safe fixtures (`cmd /c exit 1` for a failing command, a `.cmd` fake agent, `;` in PATH,
  the env vars Windows programs need). Before, they all skipped, so the shell the app really uses was untested.
- `npx tauri build --no-bundle`: `target\release\magica-dev.exe` (13.8 MB) starts, opens "Magica Terminal" in
  WebView2 and starts `powershell.exe` under ConPTY, dot-sourcing `shell\magica.ps1` (checked that the `\?\` path loads).

To do / decide:
- [ ] The checks above, by hand (only start-up was checked: no keys, panes, figures, notepad or session).
- [ ] Install pwsh 7 and run `npm test` again; only 5.1 was tested.
- [ ] Installers: `tauri build` with bundling (MSI / NSIS) and `install.ps1` weren't run.
- [ ] Decide: bash/zsh integration tests are skipped on Windows. Git Bash as a pane shell would send MSYS paths
      (`/c/Users/...`, `/tmp/...`) in OSC 7 and `space`, which `parseOsc7` doesn't convert. Support it (convert MSYS
      paths, or `cygpath -m` in `magica.bash`), or keep it out like cmd.exe and WSL.
- [ ] The frontend bundle is 855 kB (Vite warns above 500 kB); code-split if start-up is slow.

## Windows: second run (2026-11-18, Windows 11 build 26300, Windows PowerShell 5.1)

Checked by hand (driven with real key events and screenshots): splits, Ctrl+Alt+Arrows, divider drag, Ctrl+Shift+W,
tabs and Ctrl+PageUp, font size, search, light/dark, every character, `pair` / `magica`, a failing command's squash,
Ctrl+C on `ping` / `Start-Sleep` (no squash), CJK and emoji widths, `crush`, `space`, `note` (always on top, Esc,
`note buy milk`), `.env` load / unload, window corners, the bottom row at several sizes.

Fixed in this round:
- `magica` / `pair`: new panes could hang with no prompt and no typing. ConPTY asks for the cursor position as a
  shell starts and waits; the answer was dropped if it came before the pane knew its pty id. Now held until then.
- Lines doubled after a resize (font size, window): xterm now knows it's on ConPTY (`windowsPty`).
- Black boxes behind dim / italic / underlined text (Claude Code's start): xterm's WebGL renderer painted them opaque
  in the background colour (patched in `vite.config.ts`); reverse video was black text for the same reason.
- Light mode: darker text and colours (≥ 6.5:1), and an opaque terminal so text isn't hairline-thin (her figure is
  multiplied over it instead).
- The last row ran into the bottom padding (the fit addon counted the padding as room).
- Corners: 8px on Windows to match the border Windows 11 draws.
- Notepad: an empty side strip without headers; Windows' white scrollbar. Title bar: `~\…` paths shown as `…\~`.

Then also checked: the jump on success, idle bobs, three hops after `Start-Sleep 11` in an unwatched pane, the
notification, copy / paste, Ctrl+click on a URL and a file path, – □ ✕, dragging the title bar, Ctrl+1…9,
`--crush` / `--note` / `-e` from outside and `--crush` inside a pane, a `settings.json` override. Fixed:
- Notifications from the installed app never appeared: Windows drops them unless a Start Menu shortcut carries the
  app's id, so `install.ps1` now sets it on its shortcut. (Run from `target\release` they show as PowerShell's.)
- `magica-terminal --crush` / `--note` typed in a pane did nothing: the release exe has no console, so it now
  attaches to the pane's to send the escape sequence.
- Windows paths (`C:\…`, `~\…`) weren't Ctrl+clickable.
- After clicking – □ or a tab, keys went to that button (Enter toggled maximise) instead of the terminal.
- Maximised windows kept their rounded corners.
- The terminal's scrollbar is gone (it showed on focus, over her).
- With `figure_opacity` above `active_figure_opacity`, the active pane's figure was the fainter one.

Not checked: session restore and a second window starting fresh (they depend on no other Magica Terminal being
open, and one was), `kyubey` (needs an admin prompt). Known: a path wrapped onto the next line isn't clickable.
