# Magica Terminal: one cross-platform app (Tauri)

## Intent

Magica Terminal today is a 3,500-line Python/GTK3/VTE app that only runs on Linux, plus a separate Electron port in
`windows/` that has fallen behind. The owner wants **one lightweight build, from one codebase, that behaves the same on
Linux (Ubuntu first, other distros where practical), macOS and Windows**, so the terminal stops depending on the OS.

It's a personal tool. Only the owner installs it, on their own machines, by cloning the repo and running an
install script. The Linux Python app is the reference for behaviour; `windows/` is to be ignored (it may be glanced at
for ideas, but where it differs from Linux, Linux wins).

## Decisions made with the owner

- **Stack: Rust + Tauri (v2) + xterm.js.** Use an existing terminal renderer instead of drawing one. Rust owns the
  PTYs (`portable-pty`), files, settings, session, disk scan and process inspection; the webview owns everything drawn:
  xterm.js for terminals, HTML/CSS/canvas for panes, tabs, figures, Crush, the notepad and `space`.
  A fully native Rust UI (egui_term / iced_term) was considered and rejected.
- **Dropped:** `attach`, `browser`, `wl-copy` (`shell/bin/wl-copy`) and the GNOME Shell extension. Their settings
  (`browser_home`, `browser_search`) and tests go too.
- **Shells, full integration on all three:** bash (Linux; zsh too if that's the user's shell there), zsh (macOS),
  PowerShell (Windows). `.env` loading and `kyubey` included everywhere.
- **Distribution: dev-style only.** `git clone`/`git pull`, then `./install.sh` (Linux, macOS) or `.\install.ps1`
  (Windows) builds from source on that machine. No CI, no releases, no signing, no auto-update.
- **Keyboard:** macOS uses Mac-style shortcuts; Linux and Windows keep today's Ctrl+Shift set (see Keys).

## Goals

1. Feature parity with the current Linux README minus the dropped features, on all three OSes.
2. Light: small binary (Tauri's ~10 MB order, not Electron's ~150 MB), quick start, modest memory.
3. One codebase. OS differences are confined to small, named places (shell scripts, installer, a few Rust `cfg`s), never
   a forked UI.
4. When done, it replaces both old apps in this repo.

## Non-goals

- Packaged releases, installers, code signing, auto-update, CI.
- Other shells (fish, nushell, cmd.exe) beyond starting them plainly without integration.
- Re-adding `attach`/`browser` in any form.

## Anti-goals (a failure even if it "works")

- A feature that silently behaves differently or is missing on one OS without saying so to the user.
- An Electron-weight app, or one that needs the network at runtime.
- Per-OS copies of the UI code.
- Losing the user's existing data on Linux: `~/.config/magica-terminal/` (settings.json, theme, session.json, note.txt,
  crush.json, env-trust) must keep working as-is.

## Constraints

- Tauri v2, stable Rust, Node for the front-end build. xterm.js with its fit, search, web-links, unicode11 and
  WebGL (falling back to canvas/DOM) addons, or equivalents.
- Linux renders in WebKitGTK; it must be usable there (the WebGL renderer may be unavailable; fallback must be fine).
- Config directory per OS: `~/.config/magica-terminal` (Linux, unchanged), `~/Library/Application Support/magica-terminal`
  (macOS), `%APPDATA%\magica-terminal` (Windows). Same file names and formats in each.
- Every saved file is written to a temporary file and renamed over the old one (as today). `session.json` stays
  readable only by the user (0600 on Unix; default per-user profile ACL on Windows is enough).
- No runtime network access. The Maple Mono font (SIL OFL) is bundled into the app instead of fetched by the installer
  (my call); fallback chain per OS (Ubuntu Sans Mono / Menlo / Cascadia Mono, then monospace).

## What it must do (parity spec)

The current `README.md` and the docstring and constants at the top of `magica-terminal` are the spec. Summary of what must
carry over, with cross-platform notes:

**Window and panes.** Tabs; splits (right / down) with equal sizing; move focus between panes; close pane; per-pane
character with her colour for text, cursor and selection; unfocused panes slightly desaturated / focused one tinted
(the `FOCUS_*`, `UNFOCUSED_*`, `TEXT_SATURATION`, `PATH_SATURATION` settings); custom title bar showing a dot and
`name@magica` in the focused pane's colour plus her folder; rounded bottom corners (`WINDOW_RADIUS`). On macOS the custom
title bar keeps the native traffic-light buttons (overlay title bar style), my call.

**Characters.** madoka, homura, sayaka, mami, kyoko (+ kyubey) with the colours in `CHARACTERS` / `KYUBEY` /
`KYUBEY_GREYS`. Palette slots 100–118 as today, so earlier prompt lines keep their character's colours and light/dark
recolours them (xterm.js `extendedAnsi`). The slots are fixed, so the shell scripts hard-code them and `colors.sh` is no longer written (my call).

**Figures.** `figures/<name>.png` bundled into the app. Placement and "cover" scaling (`FIG_HEIGHT`, `FIG_RIGHT`,
`FIG_BOTTOM`, full-screen reference 1920×1080), coloured bar under the focused pane's figure (`BASE_*`), translucency
(`FIGURE_OPACITY`), optional hover fade (`HOVER_OPACITY`) and text-cover fade (`TEXT_OPACITY`, `TEXT_FULL`,
`TEXT_CONTRAST`, computed from the xterm.js buffer cells under her). Reactions: small jump on success, red squash +
tint on failure (exit codes in `IGNORED_EXIT` ignored), three hops plus an OS notification for a long command in an
unwatched pane, idle bob/breath. All timing settings as today.

**Theme.** Light / dark / system, Ctrl+Shift+L (Cmd+Shift+L on Mac) toggles, remembered in `theme`. Programs querying
the background colour (OSC 10/11) get the real answer; light/dark change is reported to programs that subscribe
(DEC mode 2031 / `CSI ? 997`), so Claude Code's "Auto (match terminal)" works.

**Search, links, clipboard, font size** as in Keys below. Ctrl/Cmd+click opens URLs (`LINK_REGEXES`) and existing file
paths with the OS opener; OSC 8 hyperlinks work.

**`crush`.** Magica Crush, same rules as `CrushBoard` in `magica-terminal` (specials, combos, chain luck/fade, hints,
shuffles, autoplay with `A`, best score in `crush.json`, autoplayed games don't set a best). Pixel-art look and effects as
today, drawn on a canvas. `magica-terminal --crush`.

**`note`.** One plain sheet, `note.txt`, saved `NOTE_SAVE_AFTER` after typing and on Ctrl/Cmd+S; undo/redo;
`<head>Title<head>` headers (larger, bold, underlined) listed down the left to jump to; `*word*` bold; tags hidden unless
the cursor is on them. Window kept on top while open, using Tauri's always-on-top. Accepted limitation: GNOME on Wayland
may ignore it (the extension that worked around this is gone). `note buy milk` appends a line; `magica-terminal --note`.

**`space [folder]`.** Disk usage view: items with size bars, biggest first, filling in while Rust scans in the
background (streamed to the UI); click a folder or `..` to enter, double-click a file to open it with the OS opener;
Backspace up (beyond the start too); C cds the pane's shell there; Esc/q back. Now on all three OSes.

**`pair` / `magica` layouts** (`LAYOUTS`), opened in a new tab if the current one is already split.

**`kyubey`.** Root/admin shell in the pane as Kyubey, `exit` returns. Linux/macOS: `sudo` with the root shell getting
Kyubey's prompt without the user having to edit `/root/.bashrc` (the old `root-prompt.sh` step goes away; how is the
builder's call). Windows: Windows 11's `sudo` (inline mode) or `gsudo` if installed, starting an elevated PowerShell with
Kyubey's prompt; if neither exists she prints a short message saying so.

**`.env` loading.** Same behaviour as `shell/magica.bash`: ask once per folder (y/n remembered in `env-trust`, same
format), set `KEY=value` lines, restore every key on leaving (into a subfolder too), reload on edit, never execute the
file, same parsing rules (`export`, `'…'` literal, `"…"` with `\n \" \\`, `#` comments). Implemented in each shell's
script. The parser should behave identically across bash, zsh and PowerShell.

**Session save / restore.** On window close: tabs, splits (with ratios), characters, folders, last `HISTORY_LINES`
(2000) lines of each pane as plain text → `session.json`. Next launch restores them (old text above a faint "restored"
line, fresh prompt), unless another Magica Terminal is already running. Coding agents come back instead of their text:
Claude Code by exact session id (from `~/.claude/sessions/<pid>.json`, found by walking the pane shell's process tree,
which needs a cross-platform process lister such as the `sysinfo` crate), Codex (`codex resume --last`) and opencode
(`opencode --continue`) by folder, with the `AGENT_NOT_INTERACTIVE` exclusions. Other full-screen apps come back as a copy of
their last screen. Exiting the last shell clears the session. The existing Linux `session.json` format should still load
(or be migrated) so the first launch of the new app restores the old one.

**Settings.** `settings.json` overrides the same lower-case names as today (minus `browser_*`), same validation, unknown
names and bad values ignored with a warning. Changes apply to new windows.

**CLI.** `magica-terminal`, `--crush`, `--note` as today (inside a pane they act on that pane; elsewhere they open a
window). `magica-terminal CMD ARGS…` and `magica-terminal -e CMD ARGS…` (or `--`) run CMD in the first pane, on all three
OSes. Linux's default-terminal handlers (xdg-terminal-exec / x-terminal-emulator) depend on this, so `--default` needs it.

## Keys

| Action | Linux / Windows | macOS |
|---|---|---|
| split right / down | Ctrl+Shift+O / E | Cmd+D / Cmd+Shift+D |
| close pane (or the `space` view / notepad / game over it) | Ctrl+Shift+W | Cmd+W |
| move between panes | Ctrl+Alt+Arrows | Cmd+Option+Arrows |
| new tab | Ctrl+Shift+T | Cmd+T |
| previous / next tab | Ctrl+PageUp/Down | Cmd+Shift+[ / ] |
| tab N / last tab | Ctrl+1…8 / Ctrl+9 | Cmd+1…8 / Cmd+9 |
| copy / paste | Ctrl+Shift+C / V | Cmd+C / V |
| font size | Ctrl+Shift+Plus / Minus / 0 | Cmd+Plus / Minus / 0 |
| light / dark | Ctrl+Shift+L | Cmd+Shift+L |
| search | Ctrl+Shift+F | Cmd+F |
| open link / path | Ctrl+click | Cmd+click |
| notepad save / undo / redo | Ctrl+S / Ctrl+Z / Ctrl+Shift+Z | Cmd+S / Cmd+Z / Cmd+Shift+Z |

On macOS, Option should send Meta to the shell by default (my call), and Ctrl+key always goes to the program.

## Shell ↔ terminal protocol

Keep the existing idea: shell commands print escape sequences the terminal intercepts. My calls:

- Keep the `magica:<verb>[:arg]` commands (`set`, `layout`, `crush`, `note`, `space`) but carry them in a private OSC
  (e.g. `OSC 1337;magica:…`-style or a dedicated number) handled by an xterm.js OSC handler, rather than the window
  title. That removes the `sleep 0.1` hacks. The builder picks the OSC number.
- Command start/end reporting moves from VTE's OSC 666 to the standard **OSC 133** (`A/B/C/D;<exit>`), which zsh and
  PowerShell scripts can emit easily.
- The current folder comes from **OSC 7** emitted by the prompt, not `/proc`, since that's what works everywhere. The
  title bar's folder text still comes from the prompt.
- Each shell script (`shell/magica.bash`, `shell/magica.zsh`, `shell/magica.ps1`) does nothing outside Magica
  Terminal (gated on `MAGICA_CHAR`, set by the app when spawning the shell), and provides: prompt in her colours,
  character commands, `pair`/`magica`, `crush`, `note` (incl. append), `space`, `kyubey`, `.env`, agent resume
  (`MAGICA_RESUME`), and the reporting above.
- Default shell: `$SHELL` on Linux/macOS; on Windows `pwsh` if present, else Windows PowerShell 5.1.

## Install

- `install.sh` (Linux, macOS) / `install.ps1` (Windows): check prerequisites (Rust, Node; WebKitGTK dev packages on
  Linux, offering `sudo apt install …` on Ubuntu and printing the package names for other distros; Xcode command-line
  tools on macOS; MSVC build tools on Windows; WebView2 is assumed present on Windows 11), print exact fix commands if
  missing, build the release binary, then install:
  - Linux: binary on PATH (`~/.local/bin`), `.desktop` launcher; `--default` sets it as the default terminal as today.
  - macOS: the `.app` in `~/Applications` (or `/Applications`), and `magica-terminal` on PATH.
  - Windows: binary under `%LOCALAPPDATA%`, on PATH, Start Menu shortcut.
  - No rc-file edits (my call): the app injects its shell script itself when it starts a shell (`--rcfile` for bash, `ZDOTDIR`
    for zsh, dot-sourcing for PowerShell), after the user's own startup files. At cutover the installer removes the old
    `~/.bashrc` line.
- Re-running is safe and is how updates are applied after `git pull` or local edits.

## Testing

Port the meaningful Python tests (`tests/test_crush.py`, `test_env.py`, `test_note.py`, `test_session.py`,
`test_space.py`, `test_cover.py`) to the new code: Rust unit tests for Rust-side logic (settings, session, scan,
agent detection), front-end unit tests for Crush rules, note markup and figure cover maths, and per-shell tests for
`.env` parsing so bash, zsh and PowerShell agree. Drop `test_attach.py`, `test_browser.py`, `test_copy.py`.

**Only Linux until the end.** The builder works on Ubuntu. The owner tests macOS and Windows once, after everything is
built, not at milestones. So the plan must catch OS-specific problems early without them:
- keep OS-specific code small and behind named modules, and compile-check the Rust for the macOS and Windows targets
  (`cargo check --target …`) throughout;
- test `magica.zsh` with zsh and `magica.ps1` with PowerShell 7 (`pwsh`), both installed on the Linux machine, including
  the shared `.env` parser tests;
- prefer well-trodden crates/APIs for the risky parts (`portable-pty`'s ConPTY, `sysinfo`, Tauri's window APIs);
- write a short per-OS manual checklist (`docs/…`) for the owner's end-of-build test pass, and expect one round of fixes
  after it.

## Done means

- Every item in the parity spec works on Ubuntu (builder) and on macOS and Windows 11 (owner's end-of-build check against
  the checklist, plus the fixes it turns up).
- The new README describes the app and the per-OS install, including the known Wayland always-on-top limitation.
- Removed from the repo: the Python `magica-terminal`, `windows/`, `gnome-extension/`, `shell/bin/wl-copy`,
  `shell/root-prompt.sh`, the old tests and `__pycache__`.

## Left to the builder

Repo layout, front-end framework (or none), module structure, the notepad's editor implementation, the private OSC
number, how Kyubey's root prompt is injected, how settings reach the front end, and the order of work.

## Living alongside the old app until cutover (my calls)

Until the new app reaches parity, the Python app stays installed and remains the owner's daily terminal, untouched:

- The new app runs from the dev tree only (`cargo tauri dev` or a locally built binary). It is not installed over the old
  one, and `install.sh` isn't replaced until cutover.
- The new app has its own shell scripts (e.g. under `app/shell/`), gated on its own variable (e.g. `MAGICA_APP=tauri`
  set alongside `MAGICA_CHAR`). During development they are loaded by the app itself (e.g. via `--rcfile` / `ZDOTDIR` /
  `-NoProfile -File`), not via `~/.bashrc`. `shell/magica.bash` is left alone until cutover, then replaced.
- During development, the new app uses a separate config folder (e.g. `magica-terminal-dev`) so neither app overwrites
  the other's `session.json`, `colors.sh` or `theme`. At cutover it switches to the real folder.
- Its process name differs during development so the two apps' "another instance is running" checks don't block each
  other.
- The new app must read the old `session.json`. The old app does not need to read the new one; there is no switching back
  after cutover.
- Cutover is a single step: new installer, shell scripts and README land, and the old files are removed (see Done means).
