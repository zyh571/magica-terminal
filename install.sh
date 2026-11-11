#!/usr/bin/env bash
# Install Magica Terminal from this checkout. Everything is linked, not copied, so edits here take effect
# in new windows straight away. Re-running it is safe.
#   ./install.sh            link the app, launcher and shell integration
#   ./install.sh --default  also make it the default terminal (Ubuntu's xdg-terminal-exec)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HOME/.local/bin/magica-terminal"
APPS="$HOME/.local/share/applications"

mkdir -p "$(dirname "$BIN")" "$APPS" "$HOME/.config/magica-terminal"
ln -sfn "$DIR/magica-terminal" "$BIN"
sed "s|@BIN@|$BIN|" "$DIR/magica-terminal.desktop" > "$APPS/magica-terminal.desktop"
update-desktop-database "$APPS" 2>/dev/null || true
echo "linked $BIN -> $DIR/magica-terminal"

# the terminal's font, Maple Mono (SIL Open Font License), for this user; without it the app uses Ubuntu Sans Mono
FONTS="$HOME/.local/share/fonts/MapleMono"
MAPLE="https://github.com/subframe7536/maple-font/releases/download/v7.9/MapleMono-TTF.zip"
MAPLE_SHA256="3a35f8f0669bef3dded9df208cc4526a6f7573210e134816e9084a8981271d75"
if [ -z "$(fc-list "Maple Mono")" ]; then
  tmp="$(mktemp -d)"
  if curl -fsSL -o "$tmp/maple.zip" "$MAPLE" && echo "$MAPLE_SHA256  $tmp/maple.zip" | sha256sum -c --quiet; then
    mkdir -p "$FONTS" && unzip -oq "$tmp/maple.zip" -d "$FONTS" && fc-cache -f "$FONTS"
    echo "installed the Maple Mono font ($FONTS)"
  else
    echo "couldn't fetch the Maple Mono font; using Ubuntu Sans Mono"
  fi
  rm -rf "$tmp"
fi

# GNOME on Wayland won't let a window keep itself on top or place another app's window; this small GNOME Shell extension
# does both (the notepad on top, `attach`).
# GNOME Shell only finds a new extension when it starts, so on Wayland it works after you log out and back in.
EXT="magica-terminal@dev.local"
if command -v gnome-shell >/dev/null; then
  mkdir -p "$HOME/.local/share/gnome-shell/extensions"
  ln -sfn "$DIR/gnome-extension" "$HOME/.local/share/gnome-shell/extensions/$EXT"
  enabled="$(gsettings get org.gnome.shell enabled-extensions)"
  if [[ "$enabled" != *"'$EXT'"* ]]; then
    if [[ "$enabled" == *"[]"* ]]; then new="['$EXT']"; else new="${enabled%]}, '$EXT']"; fi
    gsettings set org.gnome.shell enabled-extensions "$new"
    echo "enabled the GNOME Shell extension $EXT (notepad on top, attach; log out and back in to load it)"
  fi
fi

line="[ -r\"$DIR/shell/magica.bash\" ] && . \"$DIR/shell/magica.bash\"   # Magica Terminal"
if ! grep -qF "$DIR/shell/magica.bash" "$HOME/.bashrc" 2>/dev/null; then
  printf '\n%s\n' "$line" >> "$HOME/.bashrc"
  echo "added shell integration to ~/.bashrc"
fi

if [ "${1:-}" = "--default" ]; then
  list="$HOME/.config/ubuntu-xdg-terminals.list"
  { echo magica-terminal.desktop; grep -vx magica-terminal.desktop "$list" 2>/dev/null || true; } > "$list.tmp" && mv "$list.tmp" "$list"
  echo "default terminal set ($list)"
fi

if ! sudo -n grep -q "magica kyubey" /root/.bashrc 2>/dev/null; then
  echo "optional, for the kyubey@magica root prompt:  sudo sh -c 'cat \"$DIR/shell/root-prompt.sh\" >> /root/.bashrc'"
fi
