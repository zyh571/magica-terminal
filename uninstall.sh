#!/usr/bin/env bash
# Remove Magica Terminal on Linux or macOS. Pass --purge to remove notes, settings and saved sessions too.
set -euo pipefail

BIN_NAME=magica-terminal
OS="$(uname -s)"

case "${1:-}" in
  ""|--purge) ;;
  *) echo "usage: ./uninstall.sh [--purge]" >&2; exit 2 ;;
esac

if command -v pgrep >/dev/null && pgrep -x "$BIN_NAME" >/dev/null; then
  echo "Magica Terminal is running; close its windows and run this again." >&2
  exit 1
fi

rm -f "$HOME/.local/bin/$BIN_NAME"
if [ "$OS" = Darwin ]; then
  rm -rf "$HOME/Applications/Magica Terminal.app"
  config="$HOME/Library/Application Support/$BIN_NAME"
else
  apps="$HOME/.local/share/applications"
  rm -f "$apps/$BIN_NAME.desktop"
  update-desktop-database "$apps" 2>/dev/null || true
  list="$HOME/.config/ubuntu-xdg-terminals.list"
  if [ -f "$list" ]; then
    { grep -vx "$BIN_NAME.desktop" "$list" || true; } > "$list.tmp"
    if [ -s "$list.tmp" ]; then
      mv "$list.tmp" "$list"
    else
      rm -f "$list.tmp" "$list"
    fi
  fi
  config="${XDG_CONFIG_HOME:-$HOME/.config}/$BIN_NAME"
fi

if [ "${1:-}" = "--purge" ]; then
  rm -rf "$config"
  echo "uninstalled Magica Terminal and removed its saved data"
else
  echo "uninstalled Magica Terminal (notes, settings and sessions were kept)"
fi
