#!/bin/sh
# Installs the latest Asyar launcher release for macOS or Linux.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Xoshbin/asyar/main/install.sh | sh
#
# Install a specific version instead of the newest one:
#   ASYAR_VERSION=0.1.1-38 curl -fsSL https://raw.githubusercontent.com/Xoshbin/asyar/main/install.sh | sh
#
# Windows: use `winget install Xoshbin.Asyar` (once a stable release ships) or
# grab the MSI directly from https://github.com/Xoshbin/asyar/releases.
set -eu

REPO="Xoshbin/asyar"
INSTALL_DIR="${ASYAR_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${ASYAR_VERSION:-${1:-}}"

log() { printf '%s\n' "$*"; }
err() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Darwin) platform=macos ;;
  Linux) platform=linux ;;
  MINGW* | MSYS* | CYGWIN*)
    err "Windows isn't supported by this script. Use 'winget install Xoshbin.Asyar' (once a stable release ships) or download the MSI from https://github.com/${REPO}/releases."
    ;;
  *)
    err "Unsupported OS: $os"
    ;;
esac

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/asyar-install.XXXXXX")
MOUNTED=0
mount_point="$TMP_DIR/mnt"
linux_app_tmp=""
linux_helper_tmp=""

cleanup() {
  if [ "$MOUNTED" = "1" ]; then
    hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true
  fi
  [ -z "$linux_app_tmp" ] || rm -f "$linux_app_tmp"
  [ -z "$linux_helper_tmp" ] || rm -f "$linux_helper_tmp"
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

if [ -n "$VERSION" ]; then
  release_json=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/tags/v${VERSION}") ||
    err "release v${VERSION} not found"
else
  # GitHub's /releases/latest 404s here: every Asyar release so far is a
  # numeric pre-release (hyphenated tag), which /releases/latest excludes.
  # per_page=1 on the plain list endpoint gives the newest release instead.
  release_json=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=1") ||
    err "failed to query GitHub releases"
fi

find_asset_url() {
  # $1 must include the trailing quote so e.g. "_aarch64.AppImage\"" doesn't
  # also match the sibling "_aarch64.AppImage.sig" asset.
  printf '%s' "$release_json" |
    grep -o '"browser_download_url": *"[^"]*"' |
    grep -- "$1" |
    head -n1 |
    sed -E 's/.*"(https:[^"]+)".*/\1/'
}

case "$platform" in
  macos)
    case "$arch" in
      arm64) asset_url=$(find_asset_url '_aarch64\.dmg"') ;;
      x86_64) asset_url=$(find_asset_url '_x64\.dmg"') ;;
      *) err "Unsupported macOS architecture: $arch" ;;
    esac
    ;;
  linux)
    case "$arch" in
      aarch64)
        asset_url=$(find_asset_url '_aarch64\.AppImage"')
        helper_url=$(find_asset_url 'asyar-summon_aarch64"')
        ;;
      x86_64)
        asset_url=$(find_asset_url '_amd64\.AppImage"')
        helper_url=$(find_asset_url 'asyar-summon_amd64"')
        ;;
      *) err "Unsupported Linux architecture: $arch" ;;
    esac
    ;;
esac

[ -n "$asset_url" ] || err "Could not find a release asset for ${platform}/${arch}"
if [ "$platform" = "linux" ]; then
  [ -n "$helper_url" ] || err "Could not find the summon helper for Linux/${arch}"
fi

asset_file=$(printf '%s' "$asset_url" | sed 's#.*/##')
version=$(printf '%s' "$asset_file" | sed -E 's/^asyar_([^_]+)_.*/\1/')

log "Installing Asyar ${version} for ${platform}/${arch}..."

case "$platform" in
  macos)
    if [ -d /Applications/asyar.app ]; then
      current=$(defaults read /Applications/asyar.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo "unknown")
      log "Found an existing install (version ${current}) — it will be replaced. Asyar's own updater keeps it current after this; re-run this script any time to reinstall from scratch."
    fi

    dmg_path="$TMP_DIR/$asset_file"
    curl -fsSL -o "$dmg_path" "$asset_url"

    mkdir -p "$mount_point"
    hdiutil attach "$dmg_path" -nobrowse -quiet -mountpoint "$mount_point"
    MOUNTED=1

    app_path=$(find "$mount_point" -maxdepth 1 -name '*.app' | head -n1)
    [ -n "$app_path" ] || err "No .app bundle found in the downloaded disk image"

    rm -rf /Applications/asyar.app
    cp -R "$app_path" /Applications/

    hdiutil detach "$mount_point" -quiet
    MOUNTED=0

    log "Installed to /Applications/asyar.app"
    log "Launch it from Spotlight or Applications, then set your hotkey in Asyar's preferences."
    ;;
  linux)
    target="$INSTALL_DIR/asyar"
    helper_target="$INSTALL_DIR/asyar-summon"
    [ ! -d "$target" ] || err "Installation target is a directory: ${target}"
    [ ! -d "$helper_target" ] || err "Summon helper target is a directory: ${helper_target}"
    if [ -e "$target" ]; then
      log "Found an existing install at ${target} — it will be replaced."
    fi
    if [ -e "$helper_target" ]; then
      log "Found an existing summon helper at ${helper_target} — it will be replaced."
    fi

    mkdir -p "$INSTALL_DIR"
    linux_app_tmp=$(mktemp "$INSTALL_DIR/.asyar.XXXXXX")
    linux_helper_tmp=$(mktemp "$INSTALL_DIR/.asyar-summon.XXXXXX")

    curl -fsSL -o "$linux_app_tmp" "$asset_url"
    curl -fsSL -o "$linux_helper_tmp" "$helper_url"
    [ -s "$linux_app_tmp" ] || err "Downloaded AppImage is empty"
    [ -s "$linux_helper_tmp" ] || err "Downloaded summon helper is empty"
    chmod 0755 "$linux_app_tmp" "$linux_helper_tmp"

    mv -f "$linux_app_tmp" "$target"
    linux_app_tmp=""
    mv -f "$linux_helper_tmp" "$helper_target"
    linux_helper_tmp=""

    log "Installed Asyar to ${target}"
    log "Installed summon helper to ${helper_target}"
    case ":$PATH:" in
      *":$INSTALL_DIR:"*) ;;
      *)
        log "NOTE: ${INSTALL_DIR} isn't on your PATH. Add this to your shell profile:"
        log "  export PATH=\"${INSTALL_DIR}:\$PATH\""
        ;;
    esac
    log "Run it with: asyar"
    log "Use asyar-summon for a lightweight Linux global shortcut."
    ;;
esac
