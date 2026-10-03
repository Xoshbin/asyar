# Architecture review and benchmark preparation — 2026-10-03

Verdict: **correct direction, do not merge this head yet.**

Reviewed `arch/principles-and-zero-ipc` at `3e1a94084a48cca8cecb3967bfa703c847088720` against local `main` and `origin/main`, both `9145d66c145e9f58f824945606d0df43266dbb25`. No remote refresh was performed. Scope: 19 commits, 361 changed files.

## What is improving

- Data affinity is a better rule than requiring every filter to cross IPC. `rankItems` now filters UI-resident arrays locally while native application/file ranking stays in Rust.
- `asyar-search`, `asyar-calculator`, `asyar-storage`, and `asyar-platform` establish useful reusable boundaries. Storage no longer depends on Tauri; host adapters translate its errors.
- Bootstrap phases make initialization order more reviewable. Search persistence now shares DataStore and its configured SQLite pool.
- Provider hooks and auth subscriptions remove several direct dependency cycles. Typed IPC rejection distinguishes failure from legitimate nullable values.
- Separating presentation reset from daemon restoration is the right lifecycle model.

## Merge blockers and incomplete work

1. **P1: worker result actions lose precedence.** `searchOrchestrator.svelte.ts:180` executes `#directActions` before `#resultActions`. `extensionSearchAggregator.ts` adds a navigation closure to every Tier 2 result, including results with `actionId`. Enter therefore navigates instead of executing the extension worker action. Reproduced in a temporary test using the real result shape: navigation called once; expected worker dispatch skipped. Existing tests mock actionId without the accompanying navigation closure and miss this case.

2. **P1: cloud sync cannot restart after logout/login.** `cloudSyncService.svelte.ts:86` subscribes to auth changes, but the logout callback calls `dispose()`, which removes that same subscription at line 197. The next login has no subscriber to restart sync; authService no longer explicitly initializes it. Reproduced in a temporary test: listener count becomes zero after logout. Separate operational stop from application-lifetime subscriptions.

3. **P1: off-main-thread worker support is not complete.** `workerHost.svelte.ts` constructs a blob module Worker; `tauri.conf.json:70` has no worker-src/child-src and script-src does not allow blob. CSP worker rules therefore fall back to script-src. This is a policy-level incompatibility, not a measured packaged-runtime result. See [MDN worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src). Failures return to hidden iframes in `WorkerIframes.svelte`, violating the strict compute-isolation invariant. Bootstrap also hardcodes `dist/worker.js` rather than consuming manifest background.main, and `sendSearchRequestToExtension` still only selects an iframe, so a successfully mounted real Worker has no search-request route. Require packaged worker startup, search, RPC, permissions, and hide/show lifecycle proof before claiming isolation.

4. **P1: legacy search migration retires its source despite errors.** `search_engine/mod.rs:145-205` ignores legacy open/read/favorite-insert failures, then renames the source unconditionally, deletes an existing backup, and attempts removal if rename fails. A failed migration can be marked complete or lose its source. Retire the legacy file only after verified successful import, preserve backups, and add failure/retry tests. This finding is based on code inspection; the existing test covers only the successful path.

5. **P2: built-in primitive conversion still uses the old transport pattern.** Built-ins still enter extension aggregation, their closures are put into `#directActions`, serializable rows cross `mergedSearch`, then closures are reattached. Renaming the side table did not remove it. The shared mutable map also lacks the previous invocation-local isolation against overlapping queries. This falls short of the stated first-class built-in invariant.

6. **P2: CI skips extracted crate unit tests.** Cargo default-members is only the host. Local and GitHub CI use cargo test and cargo clippy --all-targets without --workspace. Tests moved into library crates no longer run through those commands. Use explicit workspace coverage for tests and lint.

## Verification

- Full `pnpm check:ci` attempted: formatting, design compliance, workspace frontend tests, Rust formatting, and host Clippy passed. Sandboxed Rust tests failed on restricted sockets/filesystem/native fixtures.
- Unsandboxed `cargo test --workspace`: **3,793 passed**, 10 ignored, zero failed, including extracted crates and integration suites.
- Frontend: launcher **3,845 passed**; SDK **753 passed**; configured extension workspace tests passed.
- `cargo test export_bindings -- --ignored` passed; launcher and SDK generated bindings have no diff.
- `git diff --check` passed. No source fixes or Git writes were performed.
- Two temporary review reproductions fail as expected; existing tests in those files pass (18 action tests and 43 sync tests).
- Linux/Windows runtime behavior and current remote required checks were not verified.

## Benchmark status and manual run

The README compares Asyar 0.1.1-38 against Raycast 1.104.23 and Beta 0.69.0.0, measured July 17. Those numbers cannot establish this branch's performance today.

Exact-commit source archives and locked dependencies were prepared under /private/tmp. Both comparison builds use release optimizations, Asyar Dev identity/profile/keychain, and the same pinned compiler. Symbol stripping is disabled for both because macOS 27 rejects generated release proc-macro dylibs with a misaligned LINKEDIT string pool. Consequently app disk sizes are diagnostic and are not directly comparable to normally stripped releases.

The execution process lacks macOS Accessibility permission. No fresh latency/CPU/memory comparison has been measured, and no performance improvement is claimed.

Run from a Terminal with Accessibility permission:

```bash
bash /Users/khoshbin/develop/Asyar-Project/benchmarks/results/2026-10-03-architecture-review/run-comparison.sh
```

Optional matching hotkeys can be appended, for example `--raycast-hotkey cmd+space`. Leave the machine plugged in, close heavy apps, and avoid keyboard/mouse input for roughly 15 minutes. The same unchanged harness runs main first, then branch, each against installed Raycast stable and Beta. Outputs are preserved separately in main/latest.md and branch/latest.md, including raw samples.

Both Asyar bundles share the existing isolated org.asyar.dev profile sequentially. These are realistic local-profile comparisons, not fresh/default-profile published numbers. Database migrations, caches, extension configuration, run order, and machine activity can affect results. Repeat in controlled conditions before attributing small differences to architecture. The harness measures window visibility and resize as proxies; it does not prove complete rendering or exercise all zero-IPC feature views. A single 15-sample p99 is not robust statistical evidence.

Merge only after fixing the reproduced regressions, protecting migration failure paths, demonstrating real worker runtime operation, and covering the extracted crates in CI. Benchmark results can show performance changes; they cannot override correctness blockers.

## Continuation at 571edac8

The findings above describe the original reviewed head and remain preserved as historical evidence. Worker loading now consumes `background.main`, packaged CSP permits the module Worker bootstrap, SDK search/command/preferences messages work in worker scope, and built-in providers use typed data and dispatch without the extension closure table. Sample workers use manifest identity and headless canvas export. The three inherited provider regressions pass.

Current evidence and remaining blockers: [fixed build report](fixed/README.md). Full CI passed; native WebKit loading passed. A separate signed diagnostic bundle exists. Guarded release compatibility, packaged interactive worker lifecycle, fresh benchmarks, and the additional Svelte type-check backlog remain unresolved. Current verdict: **DO NOT MERGE**.
