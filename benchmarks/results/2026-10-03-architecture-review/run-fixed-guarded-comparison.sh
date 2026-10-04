#!/usr/bin/env bash
set -euo pipefail
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS="/private/tmp/asyar-comparison-harness/benchmarks"

# Override either bundle from the environment, e.g. to measure the production
# build in /Applications instead of a dev-identity bundle:
#   ASYAR_FIXED_APP=/Applications/asyar.app bash run-fixed-guarded-comparison.sh ...
# NOTE: a production bundle has a different CFBundleIdentifier (org.asyar.app vs
# org.asyar.dev) and therefore a different app-data dir, so the two phases load
# different amounts of indexed data. The per-phase footer records the item count.
MAIN="${ASYAR_MAIN_APP:-/private/tmp/asyar-benchmark-apps/main/Asyar Dev.app}"
FIXED="${ASYAR_FIXED_APP:-/private/tmp/asyar-benchmark-apps/fixed-guarded/Asyar Dev.app}"

# Which phases to run. The `main` phase always uses the dev-identity baseline
# bundle, so overriding only ASYAR_FIXED_APP still launches Asyar Dev first —
# set ASYAR_ONLY=fixed-guarded to measure just the overridden bundle.
#   ASYAR_ONLY=fixed-guarded ASYAR_FIXED_APP=/Applications/asyar.app bash ... ...
PHASES="${ASYAR_ONLY:-main fixed-guarded}"

for phase in $PHASES; do
  case "$phase" in
    main | fixed-guarded) ;;
    *)
      echo "ASYAR_ONLY must be 'main', 'fixed-guarded', or both (space separated); got '$phase'." >&2
      exit 2
      ;;
  esac
done
for phase in $PHASES; do
  [[ "$phase" == main && ! -d "$MAIN" ]] && {
    echo "Main bundle not found: $MAIN" >&2
    exit 1
  }
  [[ "$phase" == fixed-guarded && ! -d "$FIXED" ]] && {
    echo "Fixed bundle not found: $FIXED" >&2
    exit 1
  }
done

plist() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || echo unknown; }

# Graceful quit only — a hard kill leaves macOS believing the app crashed, which
# raises the "unexpectedly quit while reopening windows" modal on the next
# launch. That dialog steals focus and the launcher window never appears, so the
# cold-start probe times out and the whole phase is wasted.
quit_bundle() { # $1 = .app path, $2 = bundle identifier
  pgrep -f "$1/Contents/MacOS/" >/dev/null 2>&1 || return 0
  osascript -e "quit app id \"$2\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "$1/Contents/MacOS/" >/dev/null 2>&1 || return 0
    sleep 0.5
  done
  echo "WARNING: $2 did not quit gracefully; quit it by hand rather than killing it." >&2
  return 1
}

RUN="$OUT/comparisons/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RUN"

for revision in $PHASES; do
  # Only claim a source SHA for the bundles this script actually knows the
  # provenance of. An overridden bundle was built by something else, and
  # asserting the baseline/fixed SHA for it puts a false provenance claim in a
  # report that may well get published.
  if [[ "$revision" == main ]]; then
    app="$MAIN"
    if [[ "$app" == *"/asyar-benchmark-apps/main/"* ]]; then
      sha=9145d66c145e9f58f824945606d0df43266dbb25
    else
      sha="not derived from git — bundle supplied via ASYAR_MAIN_APP (see Bundle line below)"
    fi
  else
    app="$FIXED"
    if [[ "$app" == *"/asyar-benchmark-apps/fixed-guarded/"* ]]; then
      sha="$(cat "$OUT/fixed-guarded/source-head.txt") plus compiled-changes.patch"
    else
      sha="not derived from git — bundle supplied via ASYAR_FIXED_APP (see Bundle line below)"
    fi
  fi

  identity="$(plist "$app" CFBundleIdentifier)"
  version="$(plist "$app" CFBundleShortVersionString)"
  name="$(plist "$app" CFBundleName)"
  echo "== phase '$revision': $name $version ($identity) — $app"

  # Suppress window restoration so a previous abnormal exit cannot pop the
  # reopen-windows modal mid-measurement.
  defaults write "$identity" NSQuitAlwaysKeepsWindows -bool false 2>/dev/null || true
  rm -rf "$HOME/Library/Saved Application State/$identity.savedState" 2>/dev/null || true

  # Both bundles share the binary name, so quit every Asyar before each phase —
  # a stray copy also defeats bench.sh's PID-by-path tracking.
  quit_bundle "$MAIN" "$(plist "$MAIN" CFBundleIdentifier)" || true
  quit_bundle "$FIXED" "$(plist "$FIXED" CFBundleIdentifier)" || true

  items="$(sqlite3 "$HOME/Library/Application Support/$identity/asyar_data.db" 'SELECT COUNT(*) FROM search_items;' 2>/dev/null || echo '?')"
  extra=""
  if [[ "$revision" == fixed-guarded && "$app" == *"/asyar-benchmark-apps/fixed-guarded/"* ]]; then
    extra='Release symbol stripping disabled; sizes differ from normal releases. See fixed-guarded/compiled-changes.patch for the exact diff. '
  fi

  bash "$HARNESS/bench.sh" --yes --asyar-app "$app" "$@"

  # bench.sh --yes exits via `die` on a failed probe without writing latest.md;
  # refuse to fabricate a result-shaped file from the footer alone.
  if [[ ! -s "$HARNESS/results/latest.md" ]]; then
    echo "ERROR: phase '$revision' produced no latest.md — treating as FAILED, not writing a report." >&2
    quit_bundle "$app" "$identity" || true
    exit 1
  fi

  mkdir -p "$RUN/$revision"
  ditto "$HARNESS/results" "$RUN/$revision"
  printf '\nSource: `%s`\nBundle: `%s` (version %s)\nIdentity/profile/keychain: `%s`; app-data `~/Library/Application Support/%s` held %s search_items before this run.\nCompiler: Rust 1.97.0. %sBuilt through the normal guarded `pnpm tauri build` path — no --ignore-version-mismatches, no bypass.\n' \
    "$sha" "$app" "$version" "$identity" "$identity" "$items" "$extra" >>"$RUN/$revision/latest.md"
done

echo "Saved fresh reports to $RUN"
