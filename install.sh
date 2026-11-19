#!/usr/bin/env bash
# Build and install Magica Terminal from this checkout (Linux and macOS). Run it again after `git pull` or an edit.
#   ./install.sh            build, then put the app on your PATH and in your launcher
#   ./install.sh --default  …and make it the default terminal (Linux: Ubuntu's xdg-terminal-exec)
#   ./install.sh --yes      install whatever the build needs without asking first
# It needs nothing but this checkout: a C compiler, Rust and Node.js are installed (or updated) when missing.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi   # started as `sh install.sh` or `zsh install.sh`
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$DIR/app"
BIN_NAME="$(sed -n 's/^pub const BIN_NAME: &str = "\(.*\)";/\1/p' "$APP/core/src/paths.rs")"
OS="$(uname -s)"
ARCH="$(uname -m)"
RUST_MIN=1.90                                   # the highest rust-version among the crates in app/Cargo.lock
TOOLS="$HOME/.local/share/magica-terminal-build"   # a private Node.js, when the system's is missing or too old
PATH="$TOOLS/node/bin:$HOME/.cargo/bin:$PATH"

DEFAULT= YES=
for arg in "$@"; do
  case "$arg" in
    --default) DEFAULT=1 ;;
    -y|--yes) YES=1 ;;
    *) echo "usage: ./install.sh [--default] [--yes]" >&2; exit 2 ;;
  esac
done
if [ "$(id -u)" = 0 ] && [ -n "${SUDO_USER:-}" ]; then
  echo "Run ./install.sh without sudo: it installs for your user and asks for your password itself when it needs it." >&2
  exit 1
fi

ask() {   # ask "question" → yes unless answered n; no when there's nobody to ask (unless --yes)
  local ans
  [ -n "$YES" ] && return 0
  [ -t 0 ] || return 1
  read -r -p "$1 [Y/n] " ans || return 1
  [[ $ans != [nN]* ]]
}
as_root() {
  if [ "$(id -u)" = 0 ]; then "$@"
  elif [ -t 0 ] && command -v sudo >/dev/null; then sudo "$@"
  elif command -v sudo >/dev/null; then sudo -n "$@"   # nobody to type a password: fail rather than wait for one
  else echo "this step needs root (no sudo here): $*" >&2; return 1
  fi
}
fetch() {   # fetch URL FILE
  if command -v curl >/dev/null; then curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null; then wget -q -O "$2" "$1"
  else echo "downloading needs curl or wget" >&2; return 1
  fi
}
version_ge() {   # version_ge 1.89.0 1.90 → false
  local IFS=. i
  local -a a=($1) b=($2)
  for ((i = 0; i < 3; i++)); do
    if ((${a[i]:-0} > ${b[i]:-0})); then return 0; fi
    if ((${a[i]:-0} < ${b[i]:-0})); then return 1; fi
  done
}
cc_works() {
  local out="${TMPDIR:-/tmp}/magica-cc-test.$$" r=0
  printf 'int main(void) { return 0; }\n' | cc -x c -o "$out" - >/dev/null 2>&1 || r=1
  rm -f "$out"
  return $r
}
rust_ok() {
  local v
  v="$(rustc --version 2>/dev/null | sed -nE 's/^rustc ([0-9]+\.[0-9]+\.[0-9]+).*/\1/p')"
  [ -n "$v" ] && version_ge "$v" "$RUST_MIN" && cargo --version >/dev/null 2>&1
}
node_ok() {   # what Vite 8 accepts: 20.19+ or 22.12+
  local v
  v="$(node --version 2>/dev/null | sed -nE 's/^v([0-9]+\.[0-9]+\.[0-9]+).*/\1/p')"
  [ -n "$v" ] && npm --version >/dev/null 2>&1 || return 1
  case "$v" in
    20.*) version_ge "$v" 20.19 ;;
    21.*) return 1 ;;
    *) version_ge "$v" 22.12 ;;
  esac
}
webkit_ok() { pkg-config --exists webkit2gtk-4.1 javascriptcoregtk-4.1 libsoup-3.0 2>/dev/null; }

# --- a C compiler (macOS: Xcode's command-line tools) ---
if [ "$OS" = Darwin ]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    if ask "Building needs Xcode's command-line tools. Install them now?"; then
      xcode-select --install || true
      echo "Finish the installer that just opened; this continues by itself afterwards…"
      until xcode-select -p >/dev/null 2>&1; do sleep 5; done
    fi
  fi
  if xcode-select -p >/dev/null 2>&1 && ! cc_works; then
    cc_err="$(printf 'int main(void) { return 0; }\n' | cc -x c -o /dev/null - 2>&1 || true)"
    if [[ $cc_err == *[Ll]icense* ]]; then
      if ask "Xcode's license hasn't been accepted yet, so nothing can compile. Accept it now (asks for your password)?"; then
        as_root xcodebuild -license accept
      fi
    elif [ "$(xcode-select -p)" = /Library/Developer/CommandLineTools ] &&
      ask "Xcode's command-line tools are broken (often after a macOS update). Reinstall them now (asks for your password)?"; then
      as_root rm -rf /Library/Developer/CommandLineTools
      xcode-select --install || true
      echo "Finish the installer that just opened; this continues by itself afterwards…"
      until xcode-select -p >/dev/null 2>&1 && cc_works; do sleep 5; done
    fi
  fi
fi

# --- Linux: WebKitGTK and a C toolchain, from the distribution ---
if [ "$OS" = Linux ] && ! { webkit_ok && cc_works && { command -v curl >/dev/null || command -v wget >/dev/null; }; }; then
  if command -v apt-get >/dev/null; then
    pm=apt pkgs="libwebkit2gtk-4.1-dev build-essential pkg-config curl wget file libayatana-appindicator3-dev librsvg2-dev"
    install_cmd="sudo apt-get update && sudo apt-get install -y $pkgs"
    if compgen -G '/var/lib/apt/lists/*Packages*' >/dev/null && ! apt-cache show libwebkit2gtk-4.1-dev >/dev/null 2>&1; then
      # Ubuntu before 22.04 and Debian before 12 never had it, and Tauri 2 can't do without it
      . /etc/os-release 2>/dev/null || true
      pm= install_cmd="WebKitGTK 4.1, which ${PRETTY_NAME:-this release} doesn't have: it needs Ubuntu 22.04+ or Debian 12+"
    fi
  elif command -v dnf >/dev/null; then
    pm=dnf pkgs="webkit2gtk4.1-devel gcc gcc-c++ make pkgconf-pkg-config curl wget file libappindicator-gtk3-devel librsvg2-devel"
    install_cmd="sudo dnf install -y $pkgs"
  elif command -v pacman >/dev/null; then
    pm=pacman pkgs="webkit2gtk-4.1 base-devel curl wget file libappindicator-gtk3 librsvg"
    install_cmd="sudo pacman -S --needed --noconfirm $pkgs"
  elif command -v zypper >/dev/null; then
    pm=zypper pkgs="webkit2gtk3-devel gcc gcc-c++ make pkg-config curl wget file libappindicator3-1 librsvg-devel"
    install_cmd="sudo zypper install -y $pkgs"
  else
    pm= install_cmd="WebKitGTK 4.1 development files, a C compiler, pkg-config and curl (see https://tauri.app/start/prerequisites/)"
  fi
  if [ -n "$pm" ] && ask "Building needs WebKitGTK's development files and a C compiler. Install them now ($pm, asks for your password)?"; then
    case "$pm" in
      apt) as_root apt-get update && as_root apt-get install -y $pkgs ;;
      dnf) as_root dnf install -y $pkgs ;;
      pacman) as_root pacman -S --needed --noconfirm $pkgs ;;
      zypper) as_root zypper install -y $pkgs ;;
    esac || true
  fi
fi

# --- Rust (rustup), at least $RUST_MIN ---
if ! rust_ok; then
  if command -v rustup >/dev/null; then
    # rustup without a default toolchain, or with an old one: build with an up-to-date stable without touching the default
    echo "Rust here is missing a toolchain or older than $RUST_MIN; getting the current stable one (rustup)…"
    if rustup toolchain install stable --profile minimal; then
      export RUSTUP_TOOLCHAIN=stable
      PATH="$(dirname "$(command -v rustup)"):$PATH"
    fi
  fi
  if ! rust_ok && ask "$(if command -v cargo >/dev/null; then echo "This Rust is older than $RUST_MIN."; else echo "Rust isn't installed."; fi) Install the current one with rustup (rustup.rs, no password needed)?"; then
    tmp="$(mktemp -d)"
    fetch https://sh.rustup.rs "$tmp/rustup-init.sh"
    RUSTUP_INIT_SKIP_PATH_CHECK=yes sh "$tmp/rustup-init.sh" -y --profile minimal --default-toolchain stable
    rm -rf "$tmp"
    PATH="$HOME/.cargo/bin:$PATH"
  fi
fi

# --- Node.js 20.19+/22.12+: a private copy from nodejs.org, so no password and nothing else on the system changes ---
install_node() {
  local os arch base file tmp
  case "$OS" in Darwin) os=darwin ;; Linux) os=linux ;; *) return 1 ;; esac
  case "$ARCH" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) echo "nodejs.org has no build for $ARCH" >&2; return 1 ;;
  esac
  base="https://nodejs.org/dist/latest-v24.x"
  tmp="$(mktemp -d)"
  fetch "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt"
  file="$(awk -v s="-$os-$arch.tar.gz" 'substr($2, length($2) - length(s) + 1) == s { print $2; exit }' "$tmp/SHASUMS256.txt")"
  [ -n "$file" ] || { echo "nodejs.org has no $os-$arch build listed" >&2; rm -rf "$tmp"; return 1; }
  echo "downloading $file…"
  fetch "$base/$file" "$tmp/$file"
  if ! (cd "$tmp" && grep "  $file\$" SHASUMS256.txt |
    if command -v sha256sum >/dev/null; then sha256sum -c - >/dev/null; else shasum -a 256 -c - >/dev/null; fi); then
    echo "the Node.js download doesn't match its checksum" >&2; rm -rf "$tmp"; return 1
  fi
  rm -rf "$TOOLS/node"
  mkdir -p "$TOOLS/node"
  tar -xzf "$tmp/$file" -C "$TOOLS/node" --strip-components=1
  rm -rf "$tmp"
}
if ! node_ok; then
  if ask "$(if command -v node >/dev/null; then echo "Node.js $(node --version 2>/dev/null) is too old (needs 20.19+ or 22.12+)."; else echo "Node.js isn't installed."; fi) Download a private copy for building (nodejs.org, into ~/.local/share, no password needed)?"; then
    install_node || true
  fi
fi

missing=()
if [ "$OS" = Darwin ]; then
  cc_works || missing+=("Xcode's command-line tools: xcode-select --install")
else
  { webkit_ok && cc_works; } || missing+=("$install_cmd")
fi
rust_ok || missing+=("Rust $RUST_MIN+: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh")
node_ok || missing+=("Node.js 22.12+: https://nodejs.org")
if ((${#missing[@]})); then
  echo "Magica Terminal needs these first$([ -z "$YES" ] && echo " (or run ./install.sh --yes to install them)"):"
  printf '  %s\n' "${missing[@]}"
  exit 1
fi

# --- the build ---
cd "$APP"
# settings from the environment that would send the build elsewhere or leave out the build tools
export CARGO_TARGET_DIR="$APP/target"
unset CARGO_BUILD_TARGET NODE_ENV
npm_ci() { npm ci --no-audit --no-fund --include=dev --include=optional "$@"; }
if ! npm_ci; then
  echo "npm ci failed; trying again with a fresh npm cache…"
  npm_ci --cache "$TOOLS/npm-cache"
fi
mkdir -p "$HOME/.local/bin"
if [ "$OS" = Darwin ]; then
  npm run tauri -- build --bundles app
  app="$APP/target/release/bundle/macos/Magica Terminal.app"
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Magica Terminal.app"
  cp -R "$app" "$HOME/Applications/"
  # unsigned: sign it for this Mac only, so Apple Silicon and Gatekeeper let it start
  xattr -dr com.apple.quarantine "$HOME/Applications/Magica Terminal.app" 2>/dev/null || true
  codesign --force --deep --sign - "$HOME/Applications/Magica Terminal.app" 2>/dev/null || true
  ln -sfn "$HOME/Applications/Magica Terminal.app/Contents/MacOS/$BIN_NAME" "$HOME/.local/bin/$BIN_NAME"
  echo "installed ~/Applications/Magica Terminal.app and ~/.local/bin/$BIN_NAME"
else
  npm run tauri -- build --no-bundle
  ln -sfn "$APP/target/release/$BIN_NAME" "$HOME/.local/bin/$BIN_NAME"
  apps="$HOME/.local/share/applications"
  mkdir -p "$apps"
  cat > "$apps/$BIN_NAME.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Magica Terminal
Comment=A terminal where every pane belongs to a magical girl
Exec="$HOME/.local/bin/$BIN_NAME"
Icon=$APP/src-tauri/icons/128x128.png
Terminal=false
Categories=System;TerminalEmulator;
StartupWMClass=$BIN_NAME
X-TerminalArgExec=-e
DESKTOP
  update-desktop-database "$apps" 2>/dev/null || true
  echo "installed ~/.local/bin/$BIN_NAME and the launcher"
  if [ -n "$DEFAULT" ]; then
    list="$HOME/.config/ubuntu-xdg-terminals.list"
    mkdir -p "$HOME/.config"
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
