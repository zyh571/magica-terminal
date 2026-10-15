# Magica Terminal

A small GTK3 + VTE terminal where every pane belongs to a Puella Magi Madoka Magica character.
Her HELLO! GOOD SMILE figure stands in the bottom-right corner, and the prompt, cursor and selection use her colour.

## Install

```sh
./install.sh            # links ~/.local/bin/magica-terminal, the launcher and the bash integration
./install.sh --default  # …and makes it the default terminal
```

Everything is linked back to this folder, so edits here show up in new windows. It needs `python3-gi`,
`gir1.2-vte-2.91` (VTE 0.78+) and `notify-send`.

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
