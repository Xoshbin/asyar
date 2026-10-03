#!/usr/bin/env bash
set -euo pipefail
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS="/private/tmp/asyar-comparison-harness/benchmarks"
MAIN="/private/tmp/asyar-benchmark-apps/main/Asyar Dev.app"
FIXED="/private/tmp/asyar-benchmark-apps/fixed/Asyar Dev.app"
[[ -d "$MAIN" && -d "$FIXED" ]] || { echo "Main and fixed bundles are required." >&2; exit 1; }
RUN="$OUT/comparisons/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RUN"
for revision in main fixed; do
  if [[ "$revision" == main ]]; then app="$MAIN"; sha=9145d66c145e9f58f824945606d0df43266dbb25; else app="$FIXED"; sha="$(cat "$OUT/fixed/source-head.txt") plus compiled-changes.patch"; fi
  bash "$HARNESS/bench.sh" --yes --asyar-app "$app" "$@"
  mkdir -p "$RUN/$revision"
  ditto "$HARNESS/results" "$RUN/$revision"
  printf '\nSource: `%s`\nCompiler: Rust 1.97.0. Dev identity/profile/keychain: org.asyar.dev. Release symbol stripping disabled; sizes differ from normal releases. Fixed build bypasses Tauri version guard; see fixed/README.md.\n' "$sha" >> "$RUN/$revision/latest.md"
done
echo "Saved fresh reports to $RUN"
