#!/usr/bin/env bash
# Asyar vs Raycast black-box performance benchmark (macOS).
#
# Measures both apps the same way, one at a time, from the outside:
#   cold start → usable, hotkey → window visible, memory footprint,
#   idle CPU, size on disk.
#
# Usage:
#   ./benchmarks/bench.sh [--yes] [--update-readme]
#       [--asyar-app PATH] [--raycast-app PATH]
#       [--asyar-hotkey SPEC] [--raycast-hotkey SPEC]
#       [--runs N] [--cpu-seconds N] [--settle-seconds N]
#
# Requires: Xcode command-line tools (swiftc) and Accessibility permission
# for your terminal (System Settings → Privacy & Security → Accessibility).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build"
TOOL="$BUILD_DIR/benchtool"
RESULTS_DIR="$SCRIPT_DIR/results"

ASYAR_APP="/Applications/asyar.app"
RAYCAST_APP="/Applications/Raycast.app"
ASYAR_HOTKEY="opt+space"    # Asyar default (Alt+Space)
RAYCAST_HOTKEY="opt+space"  # Raycast factory default (⌥Space)
RUNS=15
CPU_SECONDS=30
SETTLE_SECONDS=20
ASSUME_YES=0
UPDATE_README=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --asyar-app) ASYAR_APP="$2"; shift 2 ;;
    --raycast-app) RAYCAST_APP="$2"; shift 2 ;;
    --asyar-hotkey) ASYAR_HOTKEY="$2"; shift 2 ;;
    --raycast-hotkey) RAYCAST_HOTKEY="$2"; shift 2 ;;
    --runs) RUNS="$2"; shift 2 ;;
    --cpu-seconds) CPU_SECONDS="$2"; shift 2 ;;
    --settle-seconds) SETTLE_SECONDS="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --update-readme) UPDATE_README=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "macOS only"
[[ -d "$ASYAR_APP" ]] || die "Asyar app not found at $ASYAR_APP (pass --asyar-app)"
[[ -d "$RAYCAST_APP" ]] || die "Raycast app not found at $RAYCAST_APP (pass --raycast-app)"
command -v swiftc >/dev/null || die "swiftc not found — install Xcode command-line tools"

# A dev build of Asyar would attribute its WebKit helpers to the terminal
# and produce garbage numbers; refuse to run alongside one.
if pgrep -f 'target/(debug|release)/asyar$' >/dev/null; then
  die "a dev build of Asyar is running (target/debug or target/release) — quit it first"
fi

app_name() { basename "$1" .app; }

quit_app() {
  local app="$1" name
  name="$(app_name "$app")"
  pgrep -f "$app/Contents/MacOS" >/dev/null || return 0
  echo "  quitting $name..."
  osascript -e "quit app \"$name\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "$app/Contents/MacOS" >/dev/null || return 0
    sleep 0.5
  done
  pkill -f "$app/Contents/MacOS" || true
  sleep 1
}

if pgrep -f '/Applications/Raycast Beta.app' >/dev/null; then
  echo "note: Raycast Beta is running and will be quit (it would pollute results)."
  quit_app "/Applications/Raycast Beta.app"
fi

if [[ "$ASSUME_YES" -ne 1 ]]; then
  cat <<EOF

This benchmark will QUIT and RELAUNCH $(app_name "$ASYAR_APP") and $(app_name "$RAYCAST_APP"),
and will press their global hotkeys (~$((RUNS + 3)) times each) using synthetic
keyboard events. Do not touch mouse/keyboard while it runs (~4-5 minutes).

For fair numbers: close other heavy apps, plug in power, use a release build.

EOF
  read -r -p "Continue? [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || exit 0
fi

# Compile the measurement tool (cached until the source changes).
mkdir -p "$BUILD_DIR" "$RESULTS_DIR"
if [[ ! -x "$TOOL" || "$SCRIPT_DIR/benchtool.swift" -nt "$TOOL" ]]; then
  echo "Compiling benchtool..."
  swiftc -O "$SCRIPT_DIR/benchtool.swift" -o "$TOOL"
fi

extract() { awk -F= -v k="$2" '$1 == k { print $2 }' "$1" | tail -1; }

measure_app() {
  # writes raw benchtool output to $3 and per-metric globals via extract()
  local app="$1" hotkey="$2" log="$3" name
  name="$(app_name "$app")"
  : > "$log"

  echo "== $name =="
  quit_app "$ASYAR_APP"
  quit_app "$RAYCAST_APP"
  sleep 2

  echo "  cold start (launch → usable)..."
  "$TOOL" coldstart "$app" "$hotkey" | tee -a "$log"

  echo "  settling ${SETTLE_SECONDS}s (startup indexing etc.)..."
  sleep "$SETTLE_SECONDS"

  echo "  hotkey → window visible, $RUNS runs..."
  "$TOOL" hotkey "$app" "$hotkey" "$RUNS" | tee -a "$log"
  sleep 5

  echo "  memory footprint..."
  "$TOOL" mem "$app" | tee -a "$log"

  echo "  idle CPU over ${CPU_SECONDS}s..."
  "$TOOL" cpu "$app" "$CPU_SECONDS" | tee -a "$log"

  du -sm "$app" | awk '{ print "size_mb=" $1 }' | tee -a "$log"
  quit_app "$app"
}

ASYAR_LOG="$RESULTS_DIR/raw-asyar.txt"
RAYCAST_LOG="$RESULTS_DIR/raw-raycast.txt"

measure_app "$ASYAR_APP" "$ASYAR_HOTKEY" "$ASYAR_LOG"
measure_app "$RAYCAST_APP" "$RAYCAST_HOTKEY" "$RAYCAST_LOG"

ASYAR_VER="$(defaults read "$ASYAR_APP/Contents/Info.plist" CFBundleShortVersionString)"
RAYCAST_VER="$(defaults read "$RAYCAST_APP/Contents/Info.plist" CFBundleShortVersionString)"
CHIP="$(sysctl -n machdep.cpu.brand_string)"
RAM_GB="$(( $(sysctl -n hw.memsize) / 1073741824 ))"
MACOS_VER="$(sw_vers -productVersion)"
DATE_UTC="$(date -u +%Y-%m-%d)"

row() { # metric key unit
  printf '| %s | %s %s | %s %s |\n' \
    "$1" "$(extract "$ASYAR_LOG" "$2")" "$3" "$(extract "$RAYCAST_LOG" "$2")" "$3"
}

TABLE_FILE="$RESULTS_DIR/table.md"
{
  echo "| Metric | Asyar $ASYAR_VER | Raycast $RAYCAST_VER |"
  echo "| ------ | ---------------: | -------------------: |"
  row "Hotkey → window visible (median of $RUNS)" median_ms "ms"
  row "Hotkey → window visible (p95)" p95_ms "ms"
  row "Cold start → usable" coldstart_ms "ms"
  row "Memory footprint, idle (all processes)" total_mb "MB"
  row "CPU while idle (${CPU_SECONDS}s average)" cpu_pct "%"
  row "App size on disk" size_mb "MB"
  echo
  echo "<sub>Measured $DATE_UTC on a $CHIP (${RAM_GB} GB RAM), macOS $MACOS_VER, both apps"
  echo "as installed with default hotkeys, one at a time on a quiet machine. Black-box"
  echo "measurement: synthetic hotkey press → launcher window on screen. Reproduce with"
  echo "[\`benchmarks/bench.sh\`](benchmarks/README.md).</sub>"
} > "$TABLE_FILE"

{
  echo "# Benchmark run $DATE_UTC"
  echo
  echo "- Machine: $CHIP, ${RAM_GB} GB RAM, macOS $MACOS_VER"
  echo "- Asyar $ASYAR_VER (\`$ASYAR_APP\`), hotkey \`$ASYAR_HOTKEY\`"
  echo "- Raycast $RAYCAST_VER (\`$RAYCAST_APP\`), hotkey \`$RAYCAST_HOTKEY\`"
  echo "- $RUNS hotkey runs, ${CPU_SECONDS}s CPU window, ${SETTLE_SECONDS}s settle"
  echo
  cat "$TABLE_FILE"
  echo
  echo "## Raw output — Asyar"
  echo '```'
  cat "$ASYAR_LOG"
  echo '```'
  echo
  echo "## Raw output — Raycast"
  echo '```'
  cat "$RAYCAST_LOG"
  echo '```'
} > "$RESULTS_DIR/latest.md"

echo
echo "Results written to $RESULTS_DIR/latest.md"
echo
cat "$TABLE_FILE"

if [[ "$UPDATE_README" -eq 1 ]]; then
  README="$REPO_ROOT/README.md"
  grep -q '<!-- benchmarks:start -->' "$README" || die "README markers not found"
  awk -v table="$TABLE_FILE" '
    /<!-- benchmarks:start -->/ {
      print; print ""
      while ((getline line < table) > 0) print line
      print ""; skip = 1; next
    }
    /<!-- benchmarks:end -->/ { skip = 0 }
    !skip
  ' "$README" > "$README.tmp" && mv "$README.tmp" "$README"
  if command -v pnpm >/dev/null && [[ -f "$REPO_ROOT/package.json" ]]; then
    (cd "$REPO_ROOT" && pnpm exec prettier --write README.md >/dev/null) || true
  fi
  echo "README.md updated between benchmark markers."
fi
