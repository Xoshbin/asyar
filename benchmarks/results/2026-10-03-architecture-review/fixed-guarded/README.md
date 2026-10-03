# Fully-fixed, normally-guarded build

HEAD: `1e807ce8303e1883adb77fc640510ec5f4e376f7`, plus the unstaged source patch in `compiled-changes.patch` (includes the inherited uncommitted changes present at session start plus three runtime-lifecycle fixes made this session). The signed app was copied to `/private/tmp/asyar-benchmark-apps/fixed-guarded/Asyar Dev.app`.

Unlike `../fixed/`, this build went through the **normal, unbypassed** `pnpm tauri build` path (`--config src-tauri/tauri.dev.conf.json` for the local dev bundle ID only — no `--ignore-version-mismatches`). The version guard passed cleanly; see the top-level session report for root cause. Build uses pinned Rust 1.97.0, `CARGO_PROFILE_RELEASE_STRIP=none` (macOS 27 proc-macro dylib workaround, unrelated to the guard), `org.asyar.dev` identity/profile/keychain, release optimization, and the existing Developer ID signing identity. Unstripped disk sizes are not normal release sizes.

## What changed since `fixed/`

Three real packaged-runtime defects were found via manual interactive testing against the runtime fixture and fixed:

1. **Installer rejected any `background.main` filename other than `worker.html`** (`installer.rs`) — stale validation left over from the old worker-iframe architecture; now validates the actual declared path.
2. **View→worker RPC silently dropped** (`extensionStateService.ts`) — `state_rpc_request`/`state_rpc_abort` delivery was hardcoded to post into a `<iframe data-role="worker">` DOM node that no longer exists under the headless-Worker architecture; now checks `workerHost.hasWorker()` first, matching the already-correct pattern in `extensionDispatcher.svelte.ts`.
3. **Cross-window events (Settings → main window) never arrived** (`extensionEventSubscriptions.ts`) — listened via Tauri's raw `listen()`, which the custom long-poll event bridge stops feeding (via `app.emit`) once any window's poller connects (practically immediately after boot). Switched to the bridge-aware `appListen()` wrapper. This affected both live preference updates and extension enable/disable reload for installed (non-built-in) extensions.

All three were confirmed fixed via live manual testing against the packaged app (see conversation record): worker status RPC, live preference propagation without remount, and disable/enable/uninstall/reinstall lifecycle all now behave correctly for a real Tier-2 extension.

## Verification

- `pnpm check:ci:rust`: fmt, clippy `-D warnings`, full `cargo test --workspace` — all passed.
- `pnpm -r --if-present test:run`: 3,871 launcher tests (+3 for the new regression test), 758 SDK tests, all extension-package suites — zero failures.
- `svelte-check`: 208 errors / 13 warnings / 55 files, identical in count to the pre-session branch measurement and to `main`'s 209 (branch still nets one fewer than main). Zero errors introduced by this session's changes — the single line-level diff reflects the same pre-existing mock-typing laxness now reported against the corrected import.
- `git diff --check` and bindings export diff: both clean.

## Benchmarking

Not run from the agent process — `AXIsProcessTrusted()` returns `false` here, same limitation as `../fixed/`. Run from a trusted Terminal with Accessibility permission:

```bash
bash /Users/khoshbin/develop/Asyar-Project/benchmarks/results/2026-10-03-architecture-review/run-fixed-guarded-comparison.sh
```

This targets `/private/tmp/asyar-benchmark-apps/fixed-guarded/Asyar Dev.app` against the preserved `main` bundle — do not use the original `run-fixed-comparison.sh`, which still targets the diagnostic guard-bypass build in `../fixed/`.
