#!/usr/bin/env bash
# Build and install Magica Terminal from this checkout (Linux and macOS). Run it again after `git pull` or an edit.
#   ./install.sh            build, then put the app on your PATH and in your launcher
#   ./install.sh --default  …and make it the default terminal (Linux: Ubuntu's xdg-terminal-exec)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_NAME="$(sed -n 's/^pub const BIN_NAME: &str = "\(.*\)";/\1/p' "$DIR/core/src/paths.rs")"
OS="$(uname -s)"
PATH="$HOME/.cargo/bin:$PATH"

missing=()
command -v cargo >/dev/null || missing+=("Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh")
command -v npm >/dev/null || missing+=("Node.js 20+: https://nodejs.org (or your package manager)")
if [ "$OS" = Linux ] && ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  pkgs="libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev"
  if command -v apt-get >/dev/null; then
    if [ -t 0 ]; then
      read -r -p "Tauri needs WebKitGTK's development files. Install them now (sudo apt install …)? [y/N] " ans
      if [[ $ans == [yY]* ]]; then sudo apt-get install -y $pkgs; fi
    fi
    pkg-config --exists webkit2gtk-4.1 2>/dev/null || missing+=("sudo apt install $pkgs")
  elif command -v dnf >/dev/null; then
    missing+=("sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel libxdo-devel && sudo dnf group install c-development")
  elif command -v pacman >/dev/null; then
    missing+=("sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool")
  else
    missing+=("WebKitGTK 4.1 development files, a C toolchain, OpenSSL, librsvg (see https://tauri.app/start/prerequisites/)")
  fi
fi
if [ "$OS" = Darwin ] && ! xcode-select -p >/dev/null 2>&1; then
  missing+=("xcode-select --install")
fi
if ((${#missing[@]})); then
  echo "Magica Terminal needs these first:"
  printf '  %s\n' "${missing[@]}"
  exit 1
fi

cd "$DIR"
npm ci --no-audit --no-fund
mkdir -p "$HOME/.local/bin"
if [ "$OS" = Darwin ]; then
  npx tauri build --bundles app
  app="$DIR/target/release/bundle/macos/Magica Terminal.app"
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Magica Terminal.app"
  cp -R "$app" "$HOME/Applications/"
  ln -sfn "$HOME/Applications/Magica Terminal.app/Contents/MacOS/$BIN_NAME" "$HOME/.local/bin/$BIN_NAME"
  echo "installed ~/Applications/Magica Terminal.app and ~/.local/bin/$BIN_NAME"
else
  npx tauri build --no-bundle
  ln -sfn "$DIR/target/release/$BIN_NAME" "$HOME/.local/bin/$BIN_NAME"
  apps="$HOME/.local/share/applications"
  mkdir -p "$apps"
  cat > "$apps/$BIN_NAME.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Magica Terminal
Comment=A terminal where every pane belongs to a magical girl
Exec=$HOME/.local/bin/$BIN_NAME
Icon=$DIR/src-tauri/icons/128x128.png
Terminal=false
Categories=System;TerminalEmulator;
StartupWMClass=$BIN_NAME
X-TerminalArgExec=-e
DESKTOP
  update-desktop-database "$apps" 2>/dev/null || true
  echo "installed ~/.local/bin/$BIN_NAME and the launcher"
  if [ "${1:-}" = "--default" ]; then
    list="$HOME/.config/ubuntu-xdg-terminals.list"
    { echo "$BIN_NAME.desktop"; grep -vx "$BIN_NAME.desktop" "$list" 2>/dev/null || true; } > "$list.tmp" && mv "$list.tmp" "$list"
    echo "default terminal set ($list)"
  fi
fi
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "(add ~/.local/bin to your PATH to run $BIN_NAME from a shell)" ;; esac
