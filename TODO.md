# TODO

Features the old apps had that the Tauri app doesn't (yet). The old code is still in git history: the Python/GTK app,
`shell/` and `gnome-extension/` at `8e00fa6` (`git show 8e00fa6:magica-terminal`), the Electron port under `windows/`.

## From the Linux (Python/GTK) app

Dropped on purpose in the Tauri design (`docs/superpowers/specs/2026-11-12-cross-platform-tauri-design.md`); kept
here in case that changes.

- [ ] `attach`: put another app's window (a QEMU display, say) over a pane, with a title bar, freeze/lock and
      `attach qemu` matching. Needed the GNOME Shell extension to place the window.
- [ ] `browser [address or search]`: a web page over a pane (WebKitGTK), with an address bar, back/forward, reload,
      full-screen video in the pane and a persistent cookie store. Settings `browser_home`, `browser_search`.
- [ ] `wl-copy` shim (`shell/bin/wl-copy`).
- [ ] GNOME Shell extension (`gnome-extension/`): kept the notepad window on top under Wayland. Check whether
      always-on-top for `note` works on GNOME Wayland without it.

## From the Electron Windows port (`windows/`)

- [ ] Acrylic / Mica window background on Windows 11 (`"glass"` opacity setting, `"mica": false` to turn it off).
- [ ] A global hotkey (Ctrl+Alt+T) that opens a new window from anywhere.
- [ ] In a restored session, start a tab's shells only the first time that tab is opened.
- [ ] F12 opens the DevTools.
