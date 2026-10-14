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

line="[ -r \"$DIR/shell/magica.bash\" ] && . \"$DIR/shell/magica.bash\"   # Magica Terminal"
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
