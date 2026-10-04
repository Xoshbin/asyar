# Fixed branch build and evidence

HEAD: `571edac84fc1682d0bc46a851a6dd73caaa0ae06`, plus the unstaged source patch in `compiled-changes.patch`. Baseline main and pre-fix branch bundles are preserved. The signed fixed app was copied separately to `/private/tmp/asyar-benchmark-apps/fixed/Asyar Dev.app` after successful bundling.

Build uses pinned Rust 1.97.0, `CARGO_PROFILE_RELEASE_STRIP=none`, Dev identifier/profile/keychain `org.asyar.dev`, release optimization, and the existing Developer ID signing identity. Unstripped disk sizes are not normal release sizes.

The standard Tauri build guard rejected these reported package versions: Rust Tauri 2.12.1 versus JS API 2.11.0, and Rust log plugin 2.9.0 versus JS plugin 2.8.0. The installed API package and workspace lock actually contain 2.12.1; the API discrepancy is unexplained. This diagnostic build explicitly uses `--ignore-version-mismatches`. Normal guarded release compatibility remains unverified.

Native WebKit evidence: `webkit-worker-proof.swift` creates an actual module Worker using a blob bootstrap, the `asyar-extension:` scheme, production-equivalent worker/script CSP, and a relative dependency import. The unrestricted run returned `{"role":"worker","dom":"undefined","answer":42}`. Sandboxed execution could not access WebKit storage/services. This proves native WebKit loading, not the packaged launcher's entire runtime.

Agent Accessibility check returned `false`, without prompting or changing permissions. No fresh benchmark has been measured. From trusted Terminal with Accessibility, after closing builds/tests and keeping input idle:

```bash
bash /Users/khoshbin/develop/Asyar-Project/benchmarks/results/2026-10-03-architecture-review/run-fixed-comparison.sh
```

The unchanged harness measures main and fixed sequentially against installed Raycast stable and Beta, saving separate timestamped reports. Existing `run-comparison.sh` still targets the pre-fix branch; do not use it as evidence for the fixed implementation. Profile/cache/run-order caveats in the original review still apply.

Packaged worker acceptance steps are in `../runtime-fixture/README.md`. Until those checks and the guarded-build discrepancy are resolved, **DO NOT MERGE**.

## Verification completed

- Full unrestricted `pnpm check:ci` passed: 3,868 launcher tests, 757 SDK tests, 3,797 Rust workspace tests, formatting/design checks, and workspace Clippy. The sandboxed run had 78 native filesystem/socket failures; the unrestricted run had zero failures.
- After migrating the remaining sample worker bootstraps and Color Picker canvas, `pnpm check:ci:frontend` passed again: 3,868 launcher and 758 SDK tests; Color Picker 158 tests. Rust/config sources were unchanged after the full matrix.
- SDK and CLI TypeScript builds, Browser extension build, binding export and generated-binding diff checks, shell syntax, and `git diff --check` passed.
- An additional launcher Svelte type check failed with 219 errors and 13 warnings in 60 files. The existing ExtensionManager interface mismatches also affect a touched file; this task did not resolve the repository-wide type backlog. The full mandated matrix does not include this extra check.
- Standard guarded bundle failed; the explicit diagnostic bypass bundle succeeded and was signed. No notarization credentials were supplied. Binary SHA-256 is recorded separately. Native WebKit proof also passed with immediate bootstrap blob URL revocation.
- Packaged Computer Use failed because Accessibility/Screen Recording permissions were pending, followed by a timeout. No packaged interactive acceptance or fresh performance measurements are claimed.

The production launcher/SDK changes compiled into the bundle are recorded in `compiled-changes.patch`. Later sample-extension-only migration changes are included in the final patch but are delivered as separate extension packages, not embedded in the launcher binary. New regression tests and the runtime fixture remain separate untracked workspace files. Full CI/build logs are in `verification/`.
