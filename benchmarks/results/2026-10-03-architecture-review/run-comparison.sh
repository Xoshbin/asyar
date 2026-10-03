#!/usr/bin/env bash
set -euo pipefail
OUT="/Users/khoshbin/develop/Asyar-Project/benchmarks/results/2026-10-03-architecture-review"
HARNESS="/private/tmp/asyar-comparison-harness/benchmarks"
MAIN="/private/tmp/asyar-benchmark-apps/main/Asyar Dev.app"
BRANCH="/private/tmp/asyar-benchmark-apps/branch/Asyar Dev.app"
[[ -d "$MAIN" && -d "$BRANCH" ]] || { echo "Both prepared release bundles are required." >&2; exit 1; }
echo "This will quit/relaunch the benchmarked apps and send synthetic keys for about 15 minutes."
echo "Keep the keyboard and mouse idle. Default hotkeys: Option+Space."
for revision in main branch; do
  if [[ "$revision" == main ]]; then app="$MAIN"; sha=9145d66c145e9f58f824945606d0df43266dbb25; else app="$BRANCH"; sha=3e1a94084a48cca8cecb3967bfa703c847088720; fi
  bash "$HARNESS/bench.sh" --yes --asyar-app "$app" "$@"
  mkdir -p "$OUT/$revision"
  ditto "$HARNESS/results" "$OUT/$revision"
  printf '
Source commit: `%s`
Release settings: pinned Rust 1.97.0; symbol stripping disabled to bypass macOS 27 LINKEDIT loader failure.
' "$sha" >> "$OUT/$revision/latest.md"
done
echo "Saved both reports to $OUT/main/latest.md and $OUT/branch/latest.md"
