# Magica Terminal

A small GTK3 + VTE terminal where every pane belongs to a Puella Magi Madoka Magica character.
Her HELLO! GOOD SMILE figure stands in the bottom-right corner, and the prompt, cursor and selection use her colour.

## Install

```sh
./install.sh            # links ~/.local/bin/magica-terminal, the launcher and the bash integration
./install.sh --default  # …and makes it the default terminal
```

Everything is linked back to this folder, so edits here show up in new windows. It needs `python3-gi`,
`gir1.2-vte-2.91` (VTE 0.78+) and `notify-send`; `browser` also needs `gir1.2-webkit2-4.1`.

## Use

| Keys | |
|---|---|
| Ctrl+Shift+O / E | split right / down |
| Ctrl+Shift+W | close pane |
| Ctrl+Alt+Arrows | move between panes |
| Ctrl+Shift+T, Ctrl+PageUp/Down | new tab, switch tabs |
| Ctrl+1…8 / Ctrl+9 | go to tab N / last tab |
| Ctrl+Shift+C / V | copy / paste |
| Ctrl+Shift+Plus / Minus / 0 | font size |
| Ctrl+Shift+L | light / dark |
| Ctrl+Shift+F | search (Enter older, Shift+Enter newer, Esc) |
| Ctrl+click | open a link or file path |

In the shell:

- `madoka`, `homura`, `sayaka`, `mami`, `kyoko` switch the pane's character.
- `kyubey` opens a root shell as Kyubey; `exit` brings her back.
- `pair` lays out Madoka | Homura; `magica` all five (Madoka, Homura above; Sayaka, Mami, Kyoko below).
- `crush` opens Magica Crush in that pane: a pixel-art match-3 game with the five soul gems. Esc or q goes back to
  the prompt.
- `note` opens the notepad over that pane: one plain sheet in the theme and her colour. It saves as you type to
  `~/.config/magica-terminal/note.txt` (Ctrl+S saves now, Ctrl+Z / Ctrl+Shift+Z undo / redo) and Esc goes back to the
  prompt. While it's open the window stays on top of other windows, so a small window works as a sticky note. GNOME on
  Wayland doesn't let windows keep themselves on top, so `install.sh` adds a small GNOME Shell extension
  (`gnome-extension/`) that does it for her; log out and back in once to load it. `note buy milk` adds a line to it without opening it;
  `magica-terminal --note` opens a window with the notepad in its first pane.
- `browser [address or search]` opens a web page over that pane (Linux only, WebKitGTK). ✕ or Ctrl+Shift+W
  goes back to the prompt; Ctrl+L address bar, Alt+Left / Right back / forward, F5 reload. A video's full screen
  fills the pane (Esc leaves it). She stays in front, translucent. Logins and cookies are kept in `~/.local/share/magica-terminal/web`.
- `space [folder]` shows what takes up the disk there (Linux only): every item with a bar for its size, biggest
  first, filling in while it scans. Click a folder (or `..`) to go into it, double-click a file to open it;
  Backspace goes up (past where you started, too), C cds the shell into the folder on show, Esc or q goes back.
- A character turns translucent while there's text (or a coloured cell) behind her, the more of it
  (averaged over everything behind her), the more; `text_opacity` sets how far, `text_full` how much text it takes.

Magica Crush: swap neighbouring gems (click one, then the other, or drag) to line up 3 or more. Matching 4 makes a
striped gem (clears its row or column), an L / T / + makes a wrapped gem (a 3×3 blast, twice), and 5 or more makes a
Kyubey bomb (swap it with a gem to clear every gem of that colour). Swapping two specials together combines them, and
chains score more each step. Gems dropping in during a chain are a bit lucky (some copy a neighbour, a few
arrive striped), less so each step, so long chains of special clears happen but don't go on forever. It's endless, with
the best score kept in `~/.config/magica-terminal/crush.json`. Press A to let it play itself (A again, or a click, takes back
over); `"crush_autoplay": true` in the settings starts every game that way. A game autoplay has touched doesn't set a best
score.

The window draws its own title bar: a dot and `name@magica` in the focused pane's colour, and the folder her shell is
in (as the prompt shows it).

She reacts to what you run: a small jump when a command succeeds, a red squash when it fails, three hops (plus a
notification if the window isn't focused) when a long command finishes in a pane you weren't looking at, and an
occasional bob or breath while idle.

Programs that ask the terminal for its background colour or light/dark mode get the current theme's answer, and are
told when Ctrl+Shift+L switches it. In Claude Code, pick **Auto (match terminal)** in `/theme`. Its fixed `dark` theme draws
pale text that is hard to read on the light background.

Most settings (figure size, hop heights, idle timing, failure flash, font, …) can be changed in
`~/.config/magica-terminal/settings.json` (`%APPDATA%\magica-terminal\settings.json` on Windows), using the lower-case names of
the constants at the top of `magica-terminal` (or `windows/renderer.js`):

```json
{ "idle_bob": 16, "idle_every": [4, 8], "notify": false }
```

Changes apply to new windows. Unknown names and bad values are ignored with a warning.

Settings, the theme, the session, the note and Crush's best score are saved through a temporary file renamed over the
old one, so a crash mid-save never leaves a half-written file.

Closing the window saves tabs, splits, characters and folders to `~/.config/magica-terminal/session.json`; the
next launch restores them.

## Windows

`windows/` holds a Windows port (Electron + xterm.js + ConPTY, with PowerShell integration). See
[windows/README.md](windows/README.md).

## Files

- `magica-terminal`: the app (single Python file; settings are the constants at the top)
- `shell/magica.bash`: prompt, character commands and command start/end reporting, sourced from `~/.bashrc`
- `shell/root-prompt.sh`: Kyubey's root prompt, to append to `/root/.bashrc`
- `figures/`: one PNG per character
- `magica-terminal.desktop`: launcher template used by `install.sh`
