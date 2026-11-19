#!/usr/bin/env bash
# Build and install Magica Terminal from this checkout (Linux and macOS). Run it again after `git pull` or an edit.
#   ./install.sh            build, then put the app on your PATH and in your launcher
#   ./install.sh --default  …and make it the default terminal (Linux: Ubuntu's xdg-terminal-exec)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$DIR/app"
BIN_NAME="$(sed -n 's/^pub const BIN_NAME: &str = "\(.*\)";/\1/p' "$APP/core/src/paths.rs")"
OS="$(uname -s)"
PATH="$HOME/.cargo/bin:$PATH"

ask() { [ -t 0 ] && read -r -p "$1 [Y/n] " ans && [[ $ans != [nN]* ]]; }

if [ "$OS" = Darwin ] && ! xcode-select -p >/dev/null 2>&1; then
  if ask "Building needs Xcode's command-line tools. Install them now?"; then
    xcode-select --install || true
    # Apple's installer runs in its own window; carry on once it's done
    echo "Finish the installer that just opened; this continues by itself afterwards…"
    until xcode-select -p >/dev/null 2>&1; do sleep 5; done
  else
    echo "Magica Terminal needs these first:"; echo "  xcode-select --install"
    exit 1
  fi
fi
if ! command -v cargo >/dev/null && ask "Rust isn't installed. Install it now with rustup (rustup.rs)?"; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
if ! command -v npm >/dev/null && [ "$OS" = Darwin ]; then
  if command -v brew >/dev/null; then
    if ask "Node.js isn't installed. Install it now (brew install node)?"; then brew install node; fi
  elif ask "Node.js isn't installed. Install it now with the official installer from nodejs.org (asks for your password)?"; then
    base="https://nodejs.org/dist/latest-v22.x"
    pkg="$(curl -fsSL "$base/SHASUMS256.txt" | awk '/\.pkg$/ { print $2; exit }')"
    curl -fL -o "${TMPDIR:-/tmp}/$pkg" "$base/$pkg"
    sudo installer -pkg "${TMPDIR:-/tmp}/$pkg" -target /
    rm -f "${TMPDIR:-/tmp}/$pkg"
    PATH="/usr/local/bin:$PATH"
  fi
fi

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
if ((${#missing[@]})); then
  echo "Magica Terminal needs these first:"
  printf '  %s\n' "${missing[@]}"
  exit 1
fi

cd "$APP"
npm ci --no-audit --no-fund
mkdir -p "$HOME/.local/bin"
if [ "$OS" = Darwin ]; then
  npx tauri build --bundles app
  app="$APP/target/release/bundle/macos/Magica Terminal.app"
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Magica Terminal.app"
  cp -R "$app" "$HOME/Applications/"
  ln -sfn "$HOME/Applications/Magica Terminal.app/Contents/MacOS/$BIN_NAME" "$HOME/.local/bin/$BIN_NAME"
  echo "installed ~/Applications/Magica Terminal.app and ~/.local/bin/$BIN_NAME"
else
  npx tauri build --no-bundle
  ln -sfn "$APP/target/release/$BIN_NAME" "$HOME/.local/bin/$BIN_NAME"
  apps="$HOME/.local/share/applications"
  mkdir -p "$apps"
  cat > "$apps/$BIN_NAME.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Magica Terminal
Comment=A terminal where every pane belongs to a magical girl
Exec=$HOME/.local/bin/$BIN_NAME
Icon=$APP/src-tauri/icons/128x128.png
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
# the Python app this one replaced: its ~/.bashrc line, GNOME Shell extension and the pre-release `magica-dev` names
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$rc" ] && grep -qF "$DIR/shell/magica.bash" "$rc"; then
    grep -vF "$DIR/shell/magica.bash" "$rc" > "$rc.magica-tmp" && cat "$rc.magica-tmp" > "$rc" && rm -f "$rc.magica-tmp"
    echo "removed the old shell integration line from $rc"
  fi
done
EXT="magica-terminal@dev.local"
if [ -L "$HOME/.local/share/gnome-shell/extensions/$EXT" ]; then
  rm -f "$HOME/.local/share/gnome-shell/extensions/$EXT"
  echo "removed the old GNOME Shell extension"
fi
if command -v gsettings >/dev/null && gsettings get org.gnome.shell enabled-extensions 2>/dev/null | grep -qF "'$EXT'"; then
  gsettings set org.gnome.shell enabled-extensions "$(gsettings get org.gnome.shell enabled-extensions | sed "s/, '$EXT'//; s/'$EXT', //; s/'$EXT'//")"
fi
rm -f "$HOME/.local/bin/magica-dev" "$HOME/.local/share/applications/magica-dev.desktop"

case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "(add ~/.local/bin to your PATH to run $BIN_NAME from a shell)" ;; esac
