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

Closing the window saves tabs, splits, characters and folders to `~/.config/magica-terminal/session.json`; the
next launch restores them.

## Files

- `magica-terminal`: the app (single Python file; settings are the constants at the top)
- `shell/magica.bash`: prompt, character commands and command start/end reporting, sourced from `~/.bashrc`
- `shell/root-prompt.sh`: Kyubey's root prompt, to append to `/root/.bashrc`
- `figures/`: one PNG per character
- `magica-terminal.desktop`: launcher template used by `install.sh`
